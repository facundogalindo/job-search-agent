import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateMatch } from "./matching.js";
import { extractPdfText, generateCvPdf, cvFileName } from "./pdf.js";
import { loadPrivateProfile } from "./profile.js";

test("builds a valid, extractable, role-specific PDF using verified profile details", async () => {
  const profile = await loadPrivateProfile();
  const offer = {
    title: "Analista Funcional",
    company: "Empresa de prueba",
    description: "Must have: análisis de requerimientos, documentación funcional, SQL y PostgreSQL. Two years of functional analysis experience. English B2. Hybrid in Córdoba, Argentina.",
    sourceUrl: "",
    location: "Córdoba, Argentina",
    workMode: "Híbrido",
    postedAt: "",
  };
  const match = calculateMatch(profile, offer);
  const generated = await generateCvPdf(profile, offer, match);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "job-search-agent-pdf-"));
  const filePath = path.join(temporaryDirectory, cvFileName(profile, offer));
  try {
    await writeFile(filePath, generated.buffer);
    const savedFile = await readFile(filePath);
    assert.equal(savedFile.subarray(0, 5).toString("ascii"), "%PDF-");
    const extracted = await extractPdfText(savedFile);
    assert.match(extracted, /Facundo Galindo/);
    assert.match(extracted, /Analista Funcional/);
    assert.match(extracted, /Accion Point/);
    assert.match(extracted, /Apr 2024/);
    assert.match(extracted, /PostgreSQL/);
    assert.doesNotMatch(extracted, /Java Developer at Accion Point/i);
    assert.match(generated.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
