import assert from "node:assert/strict";
import test from "node:test";
import { loadPrivateProfile } from "./profile.js";
import { calculateMatch } from "./matching.js";

const functionalOffer = {
  title: "Analista Funcional",
  company: "Empresa de prueba",
  description: "Must have: análisis de requerimientos, documentación funcional, SQL y PostgreSQL. Two years of functional analysis experience. English B2. Hybrid in Córdoba, Argentina.",
  sourceUrl: "",
  location: "Córdoba, Argentina",
  workMode: "Híbrido",
  postedAt: "",
};

test("Java backend matching counts missing professional development years honestly", async () => {
  const profile = await loadPrivateProfile();
  const result = calculateMatch(profile, {
    title: "Java Backend Developer Jr.",
    company: "Empresa de prueba",
    description: "Required: Java, Spring Boot, REST APIs, PostgreSQL, Docker. 1 year professional Java development required. English B2. Remote, residents of Argentina accepted.",
    sourceUrl: "",
    location: "Remote, Argentina",
    workMode: "Remoto",
    postedAt: "",
  });
  assert.ok(result.requirements.some((item) => item.name === "Java" && item.required === true));
  assert.equal(result.missingSkills.length, 0);
  assert.ok(result.realScore < 90, "an unrelated functional analyst role must not count as professional Java experience");
  assert.match(result.factors.find((factor) => factor.name === "Professional experience")?.explanation ?? "", /not verified|No hay experiencia profesional de desarrollo verificada/i);
});

test("Functional analyst matching recognizes the candidate's documented experience", async () => {
  const profile = await loadPrivateProfile();
  const result = calculateMatch(profile, functionalOffer);
  assert.ok(result.realScore >= 90, `expected a strong match, received ${result.realScore}`);
  assert.ok(result.matchedSkills.includes("Functional analysis"));
  assert.ok(result.matchedSkills.includes("Requirements analysis"));
  assert.ok(result.matchedSkills.includes("PostgreSQL"));
  assert.equal(result.atsCoverageScore, 100);
});

test("unspecified remote hiring regions are not treated as confirmed Argentina eligibility", async () => {
  const profile = await loadPrivateProfile();
  const result = calculateMatch(profile, {
    ...functionalOffer,
    title: "Backend Developer",
    description: "Remote role. Required: Node.js.",
    location: "Remote",
  });
  const location = result.factors.find((factor) => factor.name === "Location and work mode");
  assert.equal(location?.score, 75);
  assert.match(location?.explanation ?? "", /does not confirm|no confirma/i);
});
