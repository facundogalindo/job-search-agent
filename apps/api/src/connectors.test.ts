import assert from "node:assert/strict";
import test from "node:test";
import { fetchSourceJobs, type SourceConfig } from "./connectors.js";

const base: SourceConfig = { id: "source-1", provider: "greenhouse", companyName: "Example", boardToken: "example", region: "global" };

test("Greenhouse connector uses its public jobs endpoint and extracts plain text", async () => {
  let endpoint = "";
  const jobs = await fetchSourceJobs(base, async (input) => {
    endpoint = String(input);
    return new Response(JSON.stringify({ jobs: [{
      id: 42, title: "Backend Developer Jr.", absolute_url: "https://boards.greenhouse.io/example/jobs/42",
      location: { name: "Córdoba, Argentina" }, content: "<p>Java &amp; Spring Boot</p>", first_published: "2026-10-25T10:00:00Z",
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.match(endpoint, /boards-api\.greenhouse\.io\/v1\/boards\/example\/jobs\?content=true/);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.externalId, "42");
  assert.equal(jobs[0]!.description, "Java & Spring Boot");
  assert.equal(jobs[0]!.location, "Córdoba, Argentina");
});

test("Lever connector selects its EU endpoint and normalizes remote Argentina postings", async () => {
  let endpoint = "";
  const jobs = await fetchSourceJobs({ ...base, provider: "lever", region: "eu", companyName: "Example EU" }, async (input) => {
    endpoint = String(input);
    return new Response(JSON.stringify([{
      id: "lever-1", text: "Analista Funcional", hostedUrl: "https://jobs.lever.co/example/lever-1",
      categories: { location: "Remote - Argentina" }, workplaceType: "remote",
      descriptionPlain: "SQL and requirements analysis", createdAt: Date.parse("2026-10-24T09:00:00Z"),
    }]), { status: 200 });
  });
  assert.match(endpoint, /^https:\/\/api\.eu\.lever\.co\/v0\/postings\/example\?mode=json$/);
  assert.equal(jobs[0]!.provider, "lever");
  assert.equal(jobs[0]!.publishedAt, "2026-10-24T09:00:00.000Z");
  assert.equal(jobs[0]!.workMode, "remote");
});

test("Ashby connector ignores unlisted jobs and maps public posting fields", async () => {
  const jobs = await fetchSourceJobs({ ...base, provider: "ashby" }, async () => new Response(JSON.stringify({ jobs: [
    { id: "listed", title: "Software Developer Intern", jobUrl: "https://jobs.ashbyhq.com/example/listed", location: "Remote - LATAM", workplaceType: "Remote", isRemote: true, isListed: true, descriptionPlain: "Node.js" },
    { id: "hidden", title: "Backend Developer Jr.", jobUrl: "https://jobs.ashbyhq.com/example/hidden", isListed: false },
  ] }), { status: 200 }));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.externalId, "listed");
  assert.equal(jobs[0]!.workMode, "Remote");
  assert.equal(jobs[0]!.location, "Remote - LATAM");
});

test("connectors reject malformed board tokens and non-HTTPS job links", async () => {
  await assert.rejects(fetchSourceJobs({ ...base, boardToken: "../other" }, async () => new Response("{}")), /Board token/);
  const jobs = await fetchSourceJobs(base, async () => new Response(JSON.stringify({ jobs: [
    { id: 1, title: "Backend Developer Jr.", absolute_url: "http://unsafe.example/job", location: { name: "Córdoba" }, content: "Java" },
  ] }), { status: 200 }));
  assert.equal(jobs.length, 0);
});
