export type Provider = "greenhouse" | "lever" | "ashby";

export interface SourceConfig {
  id: string;
  provider: Provider;
  companyName: string;
  boardToken: string;
  region: "global" | "eu";
}

export interface PublicJob {
  provider: Provider;
  externalId: string;
  title: string;
  company: string;
  description: string;
  sourceUrl: string;
  location: string;
  workMode: string;
  publishedAt: string;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function cleanHtml(value: unknown): string {
  const html = string(value);
  if (!html) return "";
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|br|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "�";
    })
    .replace(/\r/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\t ]{2,}/g, " ")
    .trim();
}

function safeUrl(value: unknown): string {
  const candidate = string(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function leverTimestamp(value: unknown): string {
  if (!value) return "";
  const candidate = typeof value === "number" || /^\d+$/.test(string(value))
    ? new Date(Number(value))
    : new Date(string(value));
  return Number.isFinite(candidate.getTime()) ? candidate.toISOString() : "";
}

function greenhouseJob(source: SourceConfig, value: unknown): PublicJob | null {
  const job = record(value);
  const location = record(job.location);
  const id = string(job.id);
  const title = string(job.title);
  const url = safeUrl(job.absolute_url);
  if (!id || !title || !url) return null;
  return {
    provider: "greenhouse", externalId: id, title, company: source.companyName,
    description: cleanHtml(job.content), sourceUrl: url,
    location: string(location.name), workMode: string(job.workplace_type) || "Unknown",
    publishedAt: string(job.first_published) || string(job.updated_at),
  };
}

function leverJob(source: SourceConfig, value: unknown): PublicJob | null {
  const job = record(value);
  const categories = record(job.categories);
  const id = string(job.id);
  const title = string(job.text);
  const url = safeUrl(job.hostedUrl ?? job.applyUrl);
  if (!id || !title || !url) return null;
  return {
    provider: "lever", externalId: id, title, company: source.companyName,
    description: cleanHtml(job.descriptionPlain || job.description || job.lists), sourceUrl: url,
    location: string(categories.location), workMode: string(job.workplaceType) || "Unknown",
    publishedAt: leverTimestamp(job.createdAt),
  };
}

function ashbyJob(source: SourceConfig, value: unknown): PublicJob | null {
  const job = record(value);
  const id = string(job.id) || safeUrl(job.jobUrl);
  const title = string(job.title);
  const url = safeUrl(job.jobUrl ?? job.applyUrl);
  if (!id || !title || !url || job.isListed === false) return null;
  const remote = job.isRemote === true || /remote/i.test(string(job.workplaceType));
  return {
    provider: "ashby", externalId: id, title, company: source.companyName,
    description: cleanHtml(job.descriptionPlain || job.descriptionHtml), sourceUrl: url,
    location: string(job.location), workMode: string(job.workplaceType) || (remote ? "Remote" : "Unknown"),
    publishedAt: string(job.publishedAt),
  };
}

export async function fetchSourceJobs(source: SourceConfig, fetcher: typeof fetch = fetch): Promise<PublicJob[]> {
  const token = source.boardToken.trim();
  if (!/^[a-z0-9._-]{1,100}$/i.test(token)) throw new Error("Board token must contain only letters, numbers, dots, dashes, and underscores.");
  const endpoint = source.provider === "greenhouse"
    ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`
    : source.provider === "lever"
      ? `https://api${source.region === "eu" ? ".eu" : ""}.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
  const response = await fetcher(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${source.provider} returned HTTP ${response.status}.`);

  const payload: unknown = await response.json();
  const rows = source.provider === "greenhouse"
    ? record(payload).jobs
    : source.provider === "lever"
      ? payload
      : record(payload).jobs;
  if (!Array.isArray(rows)) throw new Error(`${source.provider} returned an unexpected response format.`);
  const normalize = source.provider === "greenhouse" ? greenhouseJob : source.provider === "lever" ? leverJob : ashbyJob;
  return rows.map((row) => normalize(source, row)).filter((job): job is PublicJob => Boolean(job));
}

export function htmlToText(value: unknown): string {
  return cleanHtml(value);
}
