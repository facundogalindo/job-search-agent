import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSourceJobs, type PublicJob, type SourceConfig } from "./connectors.js";
import { assessListing, recencyRank } from "./job-filter.js";
import { calculateMatch } from "./matching.js";
import { processOffer, sourceFingerprint } from "./offers.js";
import { getOrCreateProfile } from "./profile.js";
import type { CandidateProfile, JobOfferInput } from "./types.js";

export const VERIFIED_SOURCES = [
  { provider: "greenhouse", company_name: "Vercel", board_token: "vercel", region: "global" },
  { provider: "greenhouse", company_name: "Power Digital", board_token: "powerdigitalmarketing", region: "global" },
  { provider: "greenhouse", company_name: "Sezzle", board_token: "sezzle", region: "global" },
  { provider: "lever", company_name: "Coderio", board_token: "coderio", region: "global" },
  { provider: "lever", company_name: "Redbee", board_token: "redbee", region: "global" },
  { provider: "lever", company_name: "Mutt Data", board_token: "muttdata", region: "global" },
  { provider: "ashby", company_name: "Breakmark", board_token: "breakmark", region: "global" },
  { provider: "ashby", company_name: "Webflow", board_token: "webflow", region: "global" },
  { provider: "ashby", company_name: "Span", board_token: "span.app", region: "global" },
  { provider: "ashby", company_name: "Replit", board_token: "replit", region: "global" },
  { provider: "ashby", company_name: "Supabase", board_token: "supabase", region: "global" },
] as const;

export interface SearchRunResult {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  sourcesChecked: number;
  sourcesFailed: number;
  jobsFetched: number;
  jobsNew: number;
  jobsUpdated: number;
  jobsRelevant: number;
  jobsDiscarded: number;
  cvsGenerated: number;
  duplicateCount: number;
  discardReasons: Record<string, number>;
  errors: string[];
}

export type SourceFetcher = (source: SourceConfig) => Promise<PublicJob[]>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function toOffer(job: PublicJob): JobOfferInput {
  return {
    title: job.title,
    company: job.company,
    description: job.description,
    sourceUrl: job.sourceUrl,
    location: job.location,
    workMode: job.workMode,
    postedAt: job.publishedAt,
  };
}

async function recordEvent(client: SupabaseClient, userId: string, offerId: string, type: string, payload: Record<string, unknown>) {
  const { error } = await client.from("application_events").insert({
    user_id: userId, job_offer_id: offerId, event_type: type, payload,
  });
  if (error) throw error;
}

async function saveDiscarded(
  client: SupabaseClient,
  userId: string,
  job: PublicJob,
  source: SourceConfig,
  runId: string,
  reason: string,
): Promise<boolean> {
  const offer = toOffer(job);
  const sourceHash = sourceFingerprint(offer);
  const now = new Date().toISOString();
  let { data: existing, error: lookupError } = await client.from("job_offers").select("id,status,discard_reason")
    .eq("user_id", userId).eq("source_hash", sourceHash).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) {
    const byExternalId = await client.from("job_offers").select("id,status,discard_reason")
      .eq("user_id", userId).eq("source_id", source.id).eq("external_id", job.externalId).maybeSingle();
    if (byExternalId.error) throw byExternalId.error;
    existing = byExternalId.data;
  }
  if (existing) {
    const update: Record<string, unknown> = {
      source_id: source.id, external_id: job.externalId, origin: "connector", last_seen_at: now,
      last_verified_at: now, automation_run_id: runId, updated_at: now,
      title: offer.title, company: offer.company, description: offer.description, source_url: offer.sourceUrl || null,
      location: offer.location, work_mode: offer.workMode, source_hash: sourceHash,
    };
    if (existing.status !== "CV_READY") {
      update.status = "DISCARDED";
      update.discard_reason = reason;
    }
    const { error } = await client.from("job_offers").update(update).eq("id", existing.id).eq("user_id", userId);
    if (error) throw error;
    if (existing.discard_reason !== reason) {
      await recordEvent(client, userId, String(existing.id), "OFFER_DISCARDED", { reason, sourceId: source.id, automationRunId: runId });
    }
    return false;
  }

  const { data, error } = await client.from("job_offers").insert({
    user_id: userId, title: offer.title, company: offer.company, description: offer.description,
    source_url: offer.sourceUrl || null, location: offer.location, work_mode: offer.workMode,
    posted_at: offer.postedAt && Number.isFinite(Date.parse(offer.postedAt)) ? new Date(offer.postedAt).toISOString() : null,
    source_hash: sourceHash, status: "DISCARDED", origin: "connector", source_id: source.id,
    external_id: job.externalId, last_seen_at: now, last_verified_at: now,
    discard_reason: reason, automation_run_id: runId,
  }).select("id").single();
  if (error) throw error;
  await recordEvent(client, userId, String(data.id), "OFFER_DISCARDED", { reason, sourceId: source.id, automationRunId: runId });
  return true;
}

async function ensureSeedSources(client: SupabaseClient, userId: string) {
  const rows = VERIFIED_SOURCES.map((source) => ({
    user_id: userId, provider: source.provider, company_name: source.company_name,
    board_token: source.board_token, region: source.region, enabled: true,
  }));
  const { error } = await client.from("job_sources").upsert(rows, { onConflict: "user_id,provider,board_token,region", ignoreDuplicates: true });
  if (error) throw error;
}

export async function listSources(client: SupabaseClient, userId: string) {
  await ensureSeedSources(client, userId);
  const { data, error } = await client.from("job_sources").select("*").eq("user_id", userId).order("company_name");
  if (error) throw error;
  return data ?? [];
}

export async function runSearch(
  client: SupabaseClient,
  userId: string,
  options: { trigger?: "manual" | "scheduled"; fetchSource?: SourceFetcher; threshold?: number } = {},
): Promise<SearchRunResult> {
  await ensureSeedSources(client, userId);
  const { data: sourceRows, error: sourcesError } = await client.from("job_sources").select("*")
    .eq("user_id", userId).eq("enabled", true).order("company_name");
  if (sourcesError) throw sourcesError;
  const sources: SourceConfig[] = (sourceRows ?? []).map((row) => ({
    id: String(row.id),
    provider: row.provider as SourceConfig["provider"],
    companyName: String(row.company_name),
    boardToken: String(row.board_token),
    region: row.region as SourceConfig["region"],
  }));
  const { data: runRow, error: runError } = await client.from("automation_runs").insert({
    user_id: userId, trigger: options.trigger ?? "manual", status: "RUNNING",
  }).select("id").single();
  if (runError) throw runError;
  const runId = String(runRow.id);
  const result: SearchRunResult = {
    runId, status: "FAILED", sourcesChecked: sources.length, sourcesFailed: 0, jobsFetched: 0,
    jobsNew: 0, jobsUpdated: 0, jobsRelevant: 0, jobsDiscarded: 0, cvsGenerated: 0, duplicateCount: 0,
    discardReasons: {}, errors: [],
  };
  const sourceSummaries: Array<Record<string, unknown>> = [];
  const processingErrors: Array<{ offer: string; error: string }> = [];
  const configuredThreshold = options.threshold ?? Number(process.env.JOB_MATCH_THRESHOLD ?? 55);
  const threshold = Number.isFinite(configuredThreshold) ? Math.min(100, Math.max(0, Math.round(configuredThreshold))) : 55;
  const fetchJobs = options.fetchSource ?? fetchSourceJobs;
  try {
    const profile: CandidateProfile = await getOrCreateProfile(client, userId);
    if (!profile.fullName.trim()) throw new Error("Add your name to the candidate profile before searching for jobs.");

    const downloaded = await Promise.all(sources.map(async (source) => {
      try {
        const jobs = await fetchJobs(source);
        const checkedAt = new Date().toISOString();
        const { error } = await client.from("job_sources").update({
          last_checked_at: checkedAt, last_status: "OK", last_error: null, updated_at: checkedAt,
        }).eq("id", source.id).eq("user_id", userId);
        if (error) throw error;
        return { source, jobs, error: "" };
      } catch (error) {
        const message = errorText(error).slice(0, 1000);
        result.sourcesFailed++;
        result.errors.push(`${source.companyName}: ${message}`);
        const { error: updateError } = await client.from("job_sources").update({
          last_checked_at: new Date().toISOString(), last_status: "ERROR", last_error: message, updated_at: new Date().toISOString(),
        }).eq("id", source.id).eq("user_id", userId);
        if (updateError) result.errors.push(`${source.companyName}: could not save source status (${errorText(updateError)})`);
        return { source, jobs: [] as PublicJob[], error: message };
      }
    }));

    for (const batch of downloaded) {
      sourceSummaries.push({ sourceId: batch.source.id, provider: batch.source.provider, company: batch.source.companyName, fetched: batch.jobs.length, error: batch.error || undefined });
      result.jobsFetched += batch.jobs.length;
    }
    const ordered = downloaded.flatMap((batch) => batch.jobs.map((job) => ({ job, source: batch.source })))
      .sort((left, right) => recencyRank(left.job.publishedAt) - recencyRank(right.job.publishedAt));

    for (const { job, source } of ordered) {
      const assessment = assessListing(job);
      const reasonKey = assessment.reason || "";
      if (!assessment.relevant && assessment.roleFit === "out_of_scope") {
        result.discardReasons["Título fuera del perfil objetivo"] = (result.discardReasons["Título fuera del perfil objetivo"] ?? 0) + 1;
        continue;
      }

      try {
        if (!assessment.relevant) {
          const inserted = await saveDiscarded(client, userId, job, source, runId, assessment.reason);
          result.jobsDiscarded += 1;
          result.discardReasons[reasonKey] = (result.discardReasons[reasonKey] ?? 0) + 1;
          if (inserted) result.jobsNew++;
          continue;
        }

        const match = calculateMatch(profile, toOffer(job));
        if (match.realScore < threshold) {
          const reason = `Compatibilidad ${match.realScore}/100 por debajo del mínimo configurado (${threshold}/100).`;
          const inserted = await saveDiscarded(client, userId, job, source, runId, reason);
          result.jobsDiscarded++;
          result.discardReasons[reason] = (result.discardReasons[reason] ?? 0) + 1;
          if (inserted) result.jobsNew++;
          continue;
        }

        const processed = await processOffer(client, userId, toOffer(job), {
          origin: "connector", sourceId: source.id, externalId: job.externalId, automationRunId: runId,
        });
        result.jobsRelevant++;
        if (processed.duplicate) result.duplicateCount++;
        else if (processed.created) result.jobsNew++;
        else result.jobsUpdated++;
        if (!processed.duplicate) result.cvsGenerated++;
      } catch (error) {
        const message = errorText(error).slice(0, 1000);
        processingErrors.push({ offer: `${job.company} — ${job.title}`, error: message });
        result.errors.push(`${job.company} — ${job.title}: ${message}`);
      }
    }

    if (sources.length === 0) result.errors.push("No hay fuentes habilitadas para consultar.");
    result.status = sources.length === 0 || result.sourcesFailed === sources.length && sources.length > 0
      ? "FAILED"
      : result.sourcesFailed > 0 || processingErrors.length > 0 ? "PARTIAL" : "SUCCEEDED";
    const { error: finishError } = await client.from("automation_runs").update({
      status: result.status, finished_at: new Date().toISOString(), sources_checked: result.sourcesChecked,
      sources_failed: result.sourcesFailed, jobs_fetched: result.jobsFetched, jobs_new: result.jobsNew,
      jobs_relevant: result.jobsRelevant, jobs_discarded: result.jobsDiscarded, cvs_generated: result.cvsGenerated,
      details: {
        sources: sourceSummaries,
        filters: {
          roles: ["backend junior/trainee/intern", "functional analyst", "business analyst", "IT internships"],
          geography: ["Córdoba on-site/hybrid", "Argentina remote", "LATAM remote if Argentina is eligible"],
          minimumMatch: threshold,
          discardReasons: result.discardReasons,
          duplicateCount: result.duplicateCount,
          updatedCount: result.jobsUpdated,
          processingErrors,
        },
      },
    }).eq("id", runId).eq("user_id", userId);
    if (finishError) throw finishError;
    return result;
  } catch (error) {
    result.errors.push(errorText(error));
    result.status = "FAILED";
    await client.from("automation_runs").update({
      status: "FAILED", finished_at: new Date().toISOString(), sources_checked: result.sourcesChecked,
      sources_failed: result.sourcesFailed, jobs_fetched: result.jobsFetched, jobs_new: result.jobsNew,
      jobs_relevant: result.jobsRelevant, jobs_discarded: result.jobsDiscarded, cvs_generated: result.cvsGenerated,
      details: { sources: sourceSummaries, errors: result.errors, discardReasons: result.discardReasons },
    }).eq("id", runId).eq("user_id", userId);
    return result;
  }
}
