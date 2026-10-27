import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateProfile, JobOfferInput, MatchResult } from "./types.js";
import { calculateMatch } from "./matching.js";
import { cvFileName, generateCvPdf } from "./pdf.js";
import { getOrCreateProfile } from "./profile.js";

const CV_BUCKET = "candidate-cvs";

function normalizeIdentity(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function sourceFingerprint(offer: JobOfferInput): string {
  let identity: string;
  if (offer.sourceUrl) {
    const url = new URL(offer.sourceUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|trk|trackingid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    identity = `url:${url.toString().replace(/\/$/, "")}`;
  } else {
    identity = [offer.title, offer.company, offer.description].map(normalizeIdentity).join("|");
  }
  return createHash("sha256").update(identity).digest("hex");
}

function asInput(row: Record<string, unknown>): JobOfferInput {
  return {
    title: String(row.title ?? ""),
    company: String(row.company ?? ""),
    description: String(row.description ?? ""),
    sourceUrl: String(row.source_url ?? ""),
    location: String(row.location ?? ""),
    workMode: String(row.work_mode ?? "Unknown"),
    postedAt: String(row.posted_at ?? ""),
  };
}

function eventRow(userId: string, offerId: string, eventType: string, payload: Record<string, unknown>) {
  return { user_id: userId, job_offer_id: offerId, event_type: eventType, payload };
}

async function recordEvent(client: SupabaseClient, userId: string, offerId: string, eventType: string, payload: Record<string, unknown>) {
  const { error } = await client.from("application_events").insert(eventRow(userId, offerId, eventType, payload));
  if (error) throw error;
}

function matchExplanation(match: MatchResult) {
  return {
    requirements: match.requirements,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    factors: match.factors,
  };
}

async function currentResult(client: SupabaseClient, offerId: string) {
  const [{ data: match }, { data: cvs }] = await Promise.all([
    client.from("match_results").select("*").eq("job_offer_id", offerId).maybeSingle(),
    client.from("cv_versions").select("id,version,file_name,status,generated_at,match_score,ats_coverage_score")
      .eq("job_offer_id", offerId).eq("status", "READY").order("version", { ascending: false }),
  ]);
  return {
    match: match ? {
      realScore: match.real_score,
      atsCoverageScore: match.ats_coverage_score,
      ...match.explanation,
    } : null,
    cvVersions: (cvs ?? []).map((cv) => ({
      id: cv.id,
      version: cv.version,
      fileName: cv.file_name,
      generatedAt: cv.generated_at,
      matchScore: cv.match_score,
      atsCoverageScore: cv.ats_coverage_score,
    })),
  };
}

export interface ProcessOfferResult {
  offerId: string;
  duplicate: boolean;
  created: boolean;
  status: string;
  match: ReturnType<typeof matchExplanation> & { realScore: number; atsCoverageScore: number };
  cv: { id: string; version: number; fileName: string; sha256: string };
}

export interface ProcessOfferMetadata {
  origin?: "manual" | "connector";
  sourceId?: string;
  externalId?: string;
  automationRunId?: string;
}

export async function processOffer(
  client: SupabaseClient,
  userId: string,
  offer: JobOfferInput,
  metadata: ProcessOfferMetadata = {},
): Promise<ProcessOfferResult> {
  const sourceHash = sourceFingerprint(offer);
  let { data: existing, error: lookupError } = await client
    .from("job_offers")
    .select("*")
    .eq("user_id", userId)
    .eq("source_hash", sourceHash)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (!existing && metadata.origin === "connector" && metadata.sourceId && metadata.externalId) {
    const externalLookup = await client.from("job_offers").select("*")
      .eq("user_id", userId).eq("source_id", metadata.sourceId).eq("external_id", metadata.externalId).maybeSingle();
    if (externalLookup.error) throw externalLookup.error;
    existing = externalLookup.data;
  }

  let contentChanged = false;
  if (existing) {
    if (metadata.origin === "connector") {
      const now = new Date().toISOString();
      contentChanged = existing.title !== offer.title || existing.company !== offer.company || existing.description !== offer.description;
      const { error: seenError } = await client.from("job_offers").update({
        source_id: metadata.sourceId ?? existing.source_id,
        external_id: metadata.externalId ?? existing.external_id,
        origin: "connector",
        title: offer.title,
        company: offer.company,
        description: offer.description,
        source_url: offer.sourceUrl || null,
        location: offer.location,
        work_mode: offer.workMode,
        posted_at: offer.postedAt && Number.isFinite(Date.parse(offer.postedAt)) ? new Date(offer.postedAt).toISOString() : null,
        source_hash: sourceHash,
        last_seen_at: now,
        last_verified_at: now,
        automation_run_id: metadata.automationRunId ?? null,
        discard_reason: null,
        updated_at: now,
      }).eq("id", existing.id).eq("user_id", userId);
      if (seenError) throw seenError;
      if (contentChanged) {
        await recordEvent(client, userId, String(existing.id), "OFFER_UPDATED", { sourceId: metadata.sourceId, automationRunId: metadata.automationRunId ?? null });
      }
    }
    const previous = await currentResult(client, String(existing.id));
    const readyCv = previous.cvVersions[0];
    if (readyCv && previous.match && !contentChanged) {
      return {
        offerId: String(existing.id),
        duplicate: true,
        created: false,
        status: String(existing.status),
        match: previous.match as ProcessOfferResult["match"],
        cv: { id: readyCv.id, version: readyCv.version, fileName: readyCv.fileName, sha256: "" },
      };
    }
  }

  let offerId = existing ? String(existing.id) : "";
  let insertedOffer = Boolean(existing);
  let cvId = "";
  let stage = "offer";
  try {
    if (!existing) {
      const parsedPostedAt = offer.postedAt && Number.isFinite(Date.parse(offer.postedAt))
        ? new Date(offer.postedAt).toISOString()
        : null;
      const { data, error } = await client.from("job_offers").insert({
        user_id: userId,
        title: offer.title,
        company: offer.company,
        description: offer.description,
        source_url: offer.sourceUrl || null,
        location: offer.location,
        work_mode: offer.workMode,
        posted_at: parsedPostedAt,
        source_hash: sourceHash,
        status: "DETECTED",
        origin: metadata.origin ?? "manual",
        source_id: metadata.sourceId ?? null,
        external_id: metadata.externalId ?? null,
        last_seen_at: metadata.origin === "connector" ? new Date().toISOString() : null,
        last_verified_at: metadata.origin === "connector" ? new Date().toISOString() : null,
        automation_run_id: metadata.automationRunId ?? null,
      }).select("id").single();
      if (error) throw error;
      offerId = String(data.id);
      insertedOffer = true;
      await recordEvent(client, userId, offerId, "OFFER_IMPORTED", {
        source: metadata.origin ?? "manual",
        hasSourceUrl: Boolean(offer.sourceUrl),
        ...(metadata.sourceId ? { sourceId: metadata.sourceId } : {}),
        ...(metadata.automationRunId ? { automationRunId: metadata.automationRunId } : {}),
      });
    }

    stage = "matching";
    const profile: CandidateProfile = await getOrCreateProfile(client, userId);
    if (!profile.fullName.trim()) throw new Error("Add your name to the candidate profile before processing an offer.");
    const match = calculateMatch(profile, offer);
    const { error: matchError } = await client.from("match_results").upsert({
      user_id: userId,
      job_offer_id: offerId,
      real_score: match.realScore,
      ats_coverage_score: match.atsCoverageScore,
      explanation: matchExplanation(match),
    }, { onConflict: "job_offer_id" });
    if (matchError) throw matchError;
    const { error: statusError } = await client.from("job_offers").update({ status: "ANALYZED", updated_at: new Date().toISOString() }).eq("id", offerId).eq("user_id", userId);
    if (statusError) throw statusError;
    if (!existing) await recordEvent(client, userId, offerId, "OFFER_ANALYZED", { realScore: match.realScore, atsCoverageScore: match.atsCoverageScore });

    stage = "pdf_generation";
    const generated = await generateCvPdf(profile, offer, match);
    const { data: versionRows, error: versionsError } = await client
      .from("cv_versions")
      .select("version")
      .eq("job_offer_id", offerId)
      .order("version", { ascending: false })
      .limit(1);
    if (versionsError) throw versionsError;
    const version = Number(versionRows?.[0]?.version ?? 0) + 1;
    cvId = randomUUID();
    const fileName = cvFileName(profile, offer);
    const storagePath = `${userId}/${offerId}/${randomUUID()}.pdf`;
    const snapshot = {
      fullName: profile.fullName,
      title: offer.title,
      company: offer.company,
      location: profile.location,
      summary: generated.extractedText.slice(0, 12000),
    };
    const { error: cvInsertError } = await client.from("cv_versions").insert({
      id: cvId,
      user_id: userId,
      job_offer_id: offerId,
      version,
      file_name: fileName,
      storage_path: storagePath,
      sha256: generated.sha256,
      status: "GENERATING",
      match_score: match.realScore,
      ats_coverage_score: match.atsCoverageScore,
      content_snapshot: snapshot,
    });
    if (cvInsertError) throw cvInsertError;

    stage = "storage_upload";
    const { error: uploadError } = await client.storage.from(CV_BUCKET).upload(storagePath, generated.buffer, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    stage = "finalize";
    const { error: readyError } = await client.from("cv_versions").update({ status: "READY" }).eq("id", cvId).eq("user_id", userId);
    if (readyError) throw readyError;
    const { error: finalStatusError } = await client.from("job_offers").update({ status: "CV_READY", updated_at: new Date().toISOString() }).eq("id", offerId).eq("user_id", userId);
    if (finalStatusError) throw finalStatusError;
    await recordEvent(client, userId, offerId, "CV_GENERATED", {
      cvVersionId: cvId,
      version,
      fileName,
      sha256: generated.sha256,
      matchScore: match.realScore,
      atsCoverageScore: match.atsCoverageScore,
      pageTextValidated: true,
    });
    return {
      offerId,
      duplicate: false,
      created: !existing,
      status: "CV_READY",
      match: { ...matchExplanation(match), realScore: match.realScore, atsCoverageScore: match.atsCoverageScore },
      cv: { id: cvId, version, fileName, sha256: generated.sha256 },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    console.error(JSON.stringify({ event: "offer_processing_failed", stage, error: message }));
    if (cvId) {
      await client.from("cv_versions").update({ status: "FAILED" }).eq("id", cvId).eq("user_id", userId);
    }
    if (offerId) {
      await client.from("job_offers").update({ status: "PROCESSING_ERROR", updated_at: new Date().toISOString() }).eq("id", offerId).eq("user_id", userId);
      try {
        await recordEvent(client, userId, offerId, "PROCESSING_FAILED", { stage });
      } catch {
        // Preserve the original processing error if the audit insert also fails.
      }
    }
    const failure = new Error(message);
    Object.assign(failure, { stage, offerId: offerId || undefined, insertedOffer });
    throw failure;
  }
}
