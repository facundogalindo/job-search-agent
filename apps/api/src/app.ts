import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "./auth.js";
import { processOffer } from "./offers.js";
import { getOrCreateProfile, saveProfile } from "./profile.js";
import { ApplicationStatusSchema, OfferInputSchema, ProfileSchema, SourceInputSchema } from "./schemas.js";
import { listSources, runSearch } from "./search.js";

const CV_BUCKET = "candidate-cvs";

function authenticated(req: Request): AuthenticatedRequest {
  return req as AuthenticatedRequest;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function formatOffer(row: Record<string, unknown>, match: Record<string, unknown> | null, cvs: Record<string, unknown>[]) {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    description: row.description,
    sourceUrl: row.source_url,
    location: row.location,
    workMode: row.work_mode,
    postedAt: row.posted_at,
    status: row.status,
    applicationStatus: row.application_status ?? "PENDING",
    discardReason: row.discard_reason ?? null,
    origin: row.origin ?? "manual",
    sourceName: row.source_name ?? null,
    createdAt: row.created_at,
    match: match ? {
      realScore: match.real_score,
      atsCoverageScore: match.ats_coverage_score,
      ...(typeof match.explanation === "object" && match.explanation !== null ? match.explanation : {}),
    } : null,
    cvVersions: cvs.map((cv) => ({
      id: cv.id,
      version: cv.version,
      fileName: cv.file_name,
      generatedAt: cv.generated_at,
      matchScore: cv.match_score,
      atsCoverageScore: cv.ats_coverage_score,
    })),
  };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  const allowedOrigins = new Set([
    process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) });
  });

  app.get("/api/profile", requireAuth, async (req, res) => {
    const request = authenticated(req);
    try {
      const profile = await getOrCreateProfile(request.supabase, request.userId);
      res.json({ profile });
    } catch (error) {
      console.error(JSON.stringify({ event: "profile_load_failed", error: errorText(error) }));
      res.status(502).json({ error: "Could not load the candidate profile from Supabase." });
    }
  });

  app.put("/api/profile", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "The profile contains invalid fields.", details: z.treeifyError(parsed.error) });
      return;
    }
    try {
      const profile = await saveProfile(request.supabase, request.userId, parsed.data);
      res.json({ profile });
    } catch (error) {
      console.error(JSON.stringify({ event: "profile_save_failed", error: errorText(error) }));
      res.status(502).json({ error: "Could not save the candidate profile to Supabase." });
    }
  });

  app.get("/api/offers", requireAuth, async (req, res) => {
    const request = authenticated(req);
    let offerQuery = request.supabase.from("job_offers").select("*").eq("user_id", request.userId)
      .order("created_at", { ascending: false }).limit(200);
    if (req.query.includeDiscarded !== "true") offerQuery = offerQuery.neq("status", "DISCARDED");
    const { data: offers, error: offerError } = await offerQuery;
    if (offerError) {
      res.status(502).json({ error: "Could not load offers from Supabase." });
      return;
    }
    const ids = (offers ?? []).map((offer) => String(offer.id));
    if (ids.length === 0) {
      res.json({ offers: [] });
      return;
    }
    const [matches, cvs, sources] = await Promise.all([
      request.supabase.from("match_results").select("job_offer_id,real_score,ats_coverage_score,explanation").eq("user_id", request.userId).in("job_offer_id", ids),
      request.supabase.from("cv_versions").select("id,job_offer_id,version,file_name,generated_at,match_score,ats_coverage_score,status")
        .eq("user_id", request.userId).eq("status", "READY").in("job_offer_id", ids).order("version", { ascending: false }),
      request.supabase.from("job_sources").select("id,company_name").eq("user_id", request.userId),
    ]);
    if (matches.error || cvs.error || sources.error) {
      res.status(502).json({ error: "Could not load offer analysis from Supabase." });
      return;
    }
    const matchByOffer = new Map((matches.data ?? []).map((row) => [String(row.job_offer_id), row as unknown as Record<string, unknown>]));
    const sourceById = new Map((sources.data ?? []).map((row) => [String(row.id), String(row.company_name)]));
    const cvsByOffer = new Map<string, Record<string, unknown>[]>();
    for (const cv of cvs.data ?? []) {
      const key = String(cv.job_offer_id);
      const list = cvsByOffer.get(key) ?? [];
      list.push(cv as unknown as Record<string, unknown>);
      cvsByOffer.set(key, list);
    }
    res.json({
      offers: (offers ?? []).map((row) => formatOffer(
        { ...(row as unknown as Record<string, unknown>), source_name: row.source_id ? sourceById.get(String(row.source_id)) ?? null : null },
        matchByOffer.get(String(row.id)) ?? null,
        cvsByOffer.get(String(row.id)) ?? [],
      )),
    });
  });

  app.get("/api/sources", requireAuth, async (req, res) => {
    const request = authenticated(req);
    try {
      const sources = await listSources(request.supabase, request.userId);
      res.json({ sources });
    } catch (error) {
      console.error(JSON.stringify({ event: "sources_load_failed", error: errorText(error) }));
      res.status(502).json({ error: "Could not load the public job board catalog." });
    }
  });

  app.post("/api/sources", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const parsed = SourceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Check the source provider, company name, board token, and region." });
      return;
    }
    const input = parsed.data;
    const { data, error } = await request.supabase.from("job_sources").insert({
      user_id: request.userId, provider: input.provider, company_name: input.companyName,
      board_token: input.boardToken, region: input.region, enabled: input.enabled,
    }).select("*").single();
    if (error) {
      res.status(error.code === "23505" ? 409 : 502).json({ error: error.code === "23505" ? "That board is already in the catalog." : "Could not add the source." });
      return;
    }
    res.status(201).json({ source: data });
  });

  app.put("/api/sources/:sourceId", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const parsed = SourceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Check the source provider, company name, board token, and region." });
      return;
    }
    const input = parsed.data;
    const { data, error } = await request.supabase.from("job_sources").update({
      provider: input.provider, company_name: input.companyName, board_token: input.boardToken,
      region: input.region, enabled: input.enabled, updated_at: new Date().toISOString(),
    }).eq("id", req.params.sourceId).eq("user_id", request.userId).select("*").maybeSingle();
    if (error || !data) {
      res.status(error ? 502 : 404).json({ error: "Could not update that job board source." });
      return;
    }
    res.json({ source: data });
  });

  app.delete("/api/sources/:sourceId", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const { data, error } = await request.supabase.from("job_sources").delete().eq("id", req.params.sourceId)
      .eq("user_id", request.userId).select("id").maybeSingle();
    if (error || !data) {
      res.status(error ? 502 : 404).json({ error: "Could not remove that job board source." });
      return;
    }
    res.status(204).end();
  });

  app.post("/api/search", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const result = await runSearch(request.supabase, request.userId, { trigger: "manual" });
    res.json(result);
  });

  app.get("/api/automation-runs", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const { data, error } = await request.supabase.from("automation_runs").select("*").eq("user_id", request.userId)
      .order("started_at", { ascending: false }).limit(30);
    if (error) {
      res.status(502).json({ error: "Could not load automation history." });
      return;
    }
    res.json({ runs: data ?? [] });
  });

  app.post("/api/offers/:offerId/application", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const parsed = ApplicationStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a valid application status." });
      return;
    }
    const { data: offer, error } = await request.supabase.from("job_offers").update({
      application_status: parsed.data.status, updated_at: new Date().toISOString(),
    }).eq("id", req.params.offerId).eq("user_id", request.userId).select("id").maybeSingle();
    if (error || !offer) {
      res.status(error ? 502 : 404).json({ error: "Could not update the application status." });
      return;
    }
    const { error: eventError } = await request.supabase.from("application_events").insert({
      user_id: request.userId, job_offer_id: offer.id, event_type: "APPLICATION_STATUS_CHANGED",
      payload: { status: parsed.data.status },
    });
    if (eventError) {
      res.status(502).json({ error: "The status changed, but its history event could not be saved." });
      return;
    }
    res.json({ offerId: offer.id, applicationStatus: parsed.data.status });
  });

  app.post("/api/offers/process", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const parsed = OfferInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Add a title and a job description of at least 20 characters; check any URL." });
      return;
    }
    try {
      const inferredTitle = parsed.data.description.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 2 && line.length <= 240) ?? "";
      const offer = { ...parsed.data, title: parsed.data.title || inferredTitle };
      if (offer.title.length < 2) {
        res.status(400).json({ error: "Add a position title or start the pasted description with the job title." });
        return;
      }
      const result = await processOffer(request.supabase, request.userId, offer);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const stage = error && typeof error === "object" && "stage" in error ? String(error.stage) : "processing";
      const message = errorText(error);
      console.error(JSON.stringify({ event: "offer_processing_failed", stage, error: message }));
      const userMessage = message.includes("Add your name")
        ? "Add your name to the candidate profile before processing an offer."
        : `The offer could not be completed during ${stage}. Check the offer and Supabase setup, then try again.`;
      res.status(message.includes("Add your name") ? 400 : 502).json({ error: userMessage });
    }
  });

  app.get("/api/offers/:offerId/events", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const offerId = req.params.offerId;
    const { data, error } = await request.supabase.from("application_events").select("id,event_type,payload,created_at")
      .eq("user_id", request.userId).eq("job_offer_id", offerId).order("created_at", { ascending: true });
    if (error) {
      res.status(502).json({ error: "Could not load the offer history." });
      return;
    }
    res.json({ events: (data ?? []).map((row) => ({
      id: row.id,
      type: row.event_type,
      payload: row.payload,
      createdAt: row.created_at,
    })) });
  });

  app.get("/api/cvs/:cvId/download", requireAuth, async (req, res) => {
    const request = authenticated(req);
    const { data: cv, error: cvError } = await request.supabase.from("cv_versions").select("file_name,storage_path,status")
      .eq("id", req.params.cvId).eq("user_id", request.userId).eq("status", "READY").maybeSingle();
    if (cvError || !cv || !cv.storage_path) {
      res.status(404).json({ error: "That CV is not available." });
      return;
    }
    const { data: file, error: downloadError } = await request.supabase.storage.from(CV_BUCKET).download(String(cv.storage_path));
    if (downloadError || !file) {
      res.status(502).json({ error: "The CV could not be downloaded from private storage." });
      return;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", bytes.byteLength);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(String(cv.file_name))}`);
    res.send(bytes);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: (error?: unknown) => void) => {
    console.error(JSON.stringify({ event: "api_error", error: errorText(error) }));
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}
