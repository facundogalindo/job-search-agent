import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "./app.js";
import { sourceFingerprint } from "./offers.js";

test("rejects unauthenticated profile, offer processing, and private CV requests", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const root = `http://127.0.0.1:${address.port}`;
  try {
    const responses = await Promise.all([
      fetch(`${root}/api/profile`),
      fetch(`${root}/api/offers`),
      fetch(`${root}/api/offers/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      fetch(`${root}/api/cvs/not-a-user-cv/download`),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("canonical source URLs prevent duplicates when tracking parameters differ", () => {
  const first = {
    title: "Backend Developer",
    company: "Acme",
    description: "First copy of a job description.",
    sourceUrl: "https://jobs.example.test/backend?utm_source=linkedin&ref=feed#details",
    location: "Remote",
    workMode: "Remoto",
    postedAt: "",
  };
  const repeat = {
    ...first,
    description: "Updated copy of the same job description.",
    sourceUrl: "https://jobs.example.test/backend?ref=feed&utm_campaign=post",
  };
  assert.equal(sourceFingerprint(first), sourceFingerprint(repeat));
  assert.notEqual(sourceFingerprint(first), sourceFingerprint({ ...first, sourceUrl: "https://jobs.example.test/another-role" }));
});
