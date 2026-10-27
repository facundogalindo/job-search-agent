import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicJob, SourceConfig } from "./connectors.js";
import { runSearch } from "./search.js";

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown; op: "eq" | "in" };

class FakeQuery {
  private operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | Row[] = {};
  private filters: Filter[] = [];
  private ordering: Array<{ column: string; ascending: boolean }> = [];
  private conflict = "";
  private limitCount = Number.MAX_SAFE_INTEGER;

  constructor(private readonly tables: Record<string, Row[]>, private readonly table: string) {}
  select(_columns?: string) { return this; }
  insert(payload: Row | Row[]) { this.operation = "insert"; this.payload = payload; return this; }
  upsert(payload: Row | Row[], options?: { onConflict?: string }) { this.operation = "upsert"; this.payload = payload; this.conflict = options?.onConflict ?? ""; return this; }
  update(payload: Row) { this.operation = "update"; this.payload = payload; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(column: string, value: unknown) { this.filters.push({ column, value, op: "eq" }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column, value, op: "in" }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.ordering.push({ column, ascending: options?.ascending ?? true }); return this; }
  limit(count: number) { this.limitCount = count; return this; }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return this.execute(false).then(resolve, reject); }

  private async execute(single: boolean): Promise<{ data: unknown; error: null }> {
    const table = this.tables[this.table] ?? (this.tables[this.table] = []);
    const payloads = (Array.isArray(this.payload) ? this.payload : [this.payload]);
    let touched: Row[] = [];
    if (this.operation === "insert") {
      touched = payloads.map((row) => ({ ...row, id: row.id ?? `${this.table}-${table.length + 1}` }));
      table.push(...touched);
    } else if (this.operation === "upsert") {
      const keys = this.conflict.split(",").filter(Boolean);
      for (const row of payloads) {
        const existing = keys.length ? table.find((current) => keys.every((key) => current[key] === row[key])) : undefined;
        if (existing) Object.assign(existing, row);
        else {
          const inserted = { ...row, id: row.id ?? `${this.table}-${table.length + 1}` };
          table.push(inserted);
          touched.push(inserted);
        }
      }
    } else if (this.operation === "update") {
      touched = table.filter((row) => this.matches(row));
      for (const row of touched) Object.assign(row, this.payload as Row);
    } else if (this.operation === "delete") {
      touched = table.filter((row) => this.matches(row));
      this.tables[this.table] = table.filter((row) => !this.matches(row));
    } else {
      touched = table.filter((row) => this.matches(row));
      for (const order of this.ordering) {
        touched.sort((a, b) => String(a[order.column] ?? "").localeCompare(String(b[order.column] ?? "") ) * (order.ascending ? 1 : -1));
      }
      touched = touched.slice(0, this.limitCount);
    }
    return { data: single ? touched[0] ?? null : touched, error: null };
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter.op === "eq"
      ? row[filter.column] === filter.value
      : (filter.value as unknown[]).includes(row[filter.column]));
  }
}

function fakeSupabase() {
  const profileId = "user-1";
  const tables: Record<string, Row[]> = {
    candidate_profiles: [{ user_id: profileId, full_name: "Test Candidate", headline: "Analista funcional", location: "Córdoba, Argentina", contact_email: null, contact_phone: null, english_level: "B2", education: [], experience: [], links: {} }],
    candidate_skills: [{ user_id: profileId, category: "Technical", name: "SQL", level: "Intermediate", context: "", evidence: "", validation_status: "candidate_confirmed" }],
    candidate_projects: [],
    job_offers: [], match_results: [], cv_versions: [], application_events: [], automation_runs: [], job_sources: [],
  };
  const uploads: Array<{ path: string; bytes: number }> = [];
  const client = {
    from: (table: string) => new FakeQuery(tables, table),
    storage: { from: (_bucket: string) => ({ upload: async (path: string, file: Buffer) => { uploads.push({ path, bytes: file.byteLength }); return { data: { path }, error: null }; } }) },
  };
  return { client: client as unknown as SupabaseClient, tables, uploads, profileId };
}

test("search pipeline fetches a source, persists one offer, matches it, generates a private PDF, and deduplicates the next run", async () => {
  const fake = fakeSupabase();
  const job: PublicJob = {
    provider: "lever", externalId: "posting-1", title: "Analista Funcional Jr.", company: "Example Tech",
    description: "Relevar requerimientos, documentar procesos y usar SQL. Requiere 1 a 2 años de experiencia. Modalidad híbrida en Córdoba, Argentina.",
    sourceUrl: "https://jobs.lever.co/example/posting-1", location: "Córdoba, Argentina", workMode: "Hybrid", publishedAt: "2026-10-26T12:00:00Z",
  };
  const fetcher = async (source: SourceConfig) => source.companyName === "Sezzle" ? [job] : [];

  const first = await runSearch(fake.client, fake.profileId, { fetchSource: fetcher, threshold: 0 });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.jobsFetched, 1);
  assert.equal(first.jobsNew, 1);
  assert.equal(first.jobsRelevant, 1);
  assert.equal(first.cvsGenerated, 1);
  assert.equal(fake.tables.job_offers!.length, 1);
  assert.equal(fake.tables.match_results!.length, 1);
  assert.equal(fake.tables.cv_versions![0]?.status, "READY");
  assert.ok((fake.tables.cv_versions![0]?.sha256 as string).match(/^[a-f0-9]{64}$/));
  assert.equal(fake.uploads.length, 1);
  assert.ok((fake.uploads[0]?.bytes ?? 0) > 1000);
  assert.equal(fake.tables.application_events!.some((event) => event.event_type === "CV_GENERATED"), true);

  const second = await runSearch(fake.client, fake.profileId, { fetchSource: fetcher, threshold: 0 });
  assert.equal(second.status, "SUCCEEDED");
  assert.equal(second.jobsNew, 0);
  assert.equal(second.duplicateCount, 1);
  assert.equal(second.cvsGenerated, 0);
  assert.equal(fake.tables.job_offers!.length, 1);
  assert.equal(fake.tables.cv_versions!.length, 1);
  assert.equal(fake.tables.automation_runs!.length, 2);
});
