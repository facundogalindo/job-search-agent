import assert from "node:assert/strict";
import test from "node:test";
import { assessListing } from "./job-filter.js";
import type { PublicJob } from "./connectors.js";

function job(overrides: Partial<PublicJob>): PublicJob {
  return {
    provider: "greenhouse", externalId: "1", title: "Backend Developer Jr.", company: "Example",
    description: "Java, Spring Boot, REST. 1-2 years experience. Remote, residents of Argentina accepted.",
    sourceUrl: "https://jobs.example/1", location: "Remote, Argentina", workMode: "Remote", publishedAt: "",
    ...overrides,
  };
}

test("accepts junior backend opportunities explicitly open to Argentina", () => {
  const result = assessListing(job({}));
  assert.equal(result.relevant, true);
  assert.equal(result.roleFit, "backend_junior");
});

test("accepts functional analyst roles up to two years in Córdoba", () => {
  const result = assessListing(job({
    title: "Analista Técnico Funcional",
    description: "SQL, requisitos y documentación. Se requieren 1 a 2 años de experiencia.",
    location: "Córdoba, Argentina", workMode: "Hybrid",
  }));
  assert.equal(result.relevant, true);
  assert.equal(result.roleFit, "functional_analyst");
});

test("accepts IT internships when the title identifies a technical internship", () => {
  const result = assessListing(job({ title: "IT Internship", description: "Internship for residents of Argentina. SQL and Java are helpful." }));
  assert.equal(result.relevant, true);
  assert.equal(result.roleFit, "it_internship");
});

test("discards seniority and excessive experience", () => {
  const senior = assessListing(job({ title: "Senior Backend Developer", description: "Remote Argentina" }));
  const years = assessListing(job({ title: "Analista Funcional", description: "3-5 years of experience. Córdoba." }));
  assert.equal(senior.relevant, false);
  assert.match(senior.reason, /seniority/i);
  assert.equal(years.relevant, false);
});

test("does not assume that unrestricted remote roles accept Argentine residents", () => {
  const result = assessListing(job({
    title: "Node.js Developer Trainee", description: "Remote anywhere in the world.", location: "Remote", workMode: "Remote",
  }));
  assert.equal(result.relevant, false);
  assert.match(result.reason, /no confirma elegibilidad/i);
});

test("excludes unrelated titles and backend roles with no junior signal", () => {
  const unrelated = assessListing(job({ title: "Senior Product Designer" }));
  const unqualified = assessListing(job({ title: "Backend Engineer" , description: "Remote Argentina. Java and REST." }));
  assert.equal(unrelated.roleFit, "out_of_scope");
  assert.equal(unqualified.relevant, false);
  assert.match(unqualified.reason, /sin señal/i);
});
