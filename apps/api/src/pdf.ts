import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { orderedSkills, tailoredSummary } from "./matching.js";
import type { CandidateProfile, JobOfferInput, MatchResult } from "./types.js";

export interface GeneratedPdf {
  buffer: Buffer;
  extractedText: string;
  sha256: string;
}

function formatPeriod(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(match[2]) - 1] ?? ""} ${match[1]}`.trim();
}

function safeNamePart(value: string): string {
  const safe = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return safe || "Position";
}

export function cvFileName(profile: CandidateProfile, offer: JobOfferInput): string {
  const [firstName = "Candidate", ...lastNames] = profile.fullName.trim().split(/\s+/);
  const name = [firstName, ...lastNames].map(safeNamePart).join("_");
  return `${name}_${safeNamePart(offer.company || "Company")}_${safeNamePart(offer.title)}_ATS.pdf`;
}

function writeSectionHeading(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.35);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#18324b").text(title.toUpperCase());
  doc.moveDown(0.12);
  doc.font("Helvetica").fontSize(8.6).fillColor("#202a35");
}

function renderCv(doc: PDFKit.PDFDocument, profile: CandidateProfile, offer: JobOfferInput, match: MatchResult) {
  const contact = [
    profile.location,
    profile.contactEmail,
    profile.contactPhone,
    profile.links.linkedin,
    profile.links.github,
  ].filter(Boolean).join(" | ");

  doc.font("Helvetica-Bold").fontSize(19).fillColor("#14263a").text(profile.fullName || "Candidate");
  doc.moveDown(0.08);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#275f82").text(offer.title);
  if (contact) {
    doc.moveDown(0.16);
    doc.font("Helvetica").fontSize(8.2).fillColor("#354352").text(contact, { lineGap: 1 });
  }

  writeSectionHeading(doc, "Professional Summary");
  doc.text(tailoredSummary(profile, offer), { lineGap: 1.1 });

  const sortedSkills = orderedSkills(profile, offer);
  const categories = [...new Set(sortedSkills.map((skill) => skill.category))];
  if (sortedSkills.length > 0) {
    writeSectionHeading(doc, "Technical Skills");
    for (const category of categories) {
      const names = sortedSkills.filter((skill) => skill.category === category).map((skill) => skill.name);
      doc.font("Helvetica-Bold").text(`${category}: `, { continued: true });
      doc.font("Helvetica").text(names.join(", "), { lineGap: 0.4 });
    }
  }

  if (profile.experience.length > 0) {
    writeSectionHeading(doc, "Professional Experience");
    const experience = [...profile.experience].sort((left, right) => right.startDate.localeCompare(left.startDate));
    for (const job of experience) {
      const dates = [formatPeriod(job.startDate), formatPeriod(job.endDate)].filter(Boolean).join(" - ");
      doc.font("Helvetica-Bold").text(`${job.title}${job.company ? ` | ${job.company}` : ""}${dates ? ` | ${dates}` : ""}`);
      doc.font("Helvetica");
      if (job.description) doc.text(job.description, { indent: 8, lineGap: 0.5 });
      for (const highlight of job.highlights) {
        doc.text(`- ${highlight}`, { indent: 8, lineGap: 0.5 });
      }
      doc.moveDown(0.1);
    }
  }

  if (profile.projects.length > 0) {
    writeSectionHeading(doc, "Projects");
    for (const project of profile.projects) {
      doc.font("Helvetica-Bold").text(project.name);
      doc.font("Helvetica");
      if (project.description) doc.text(project.description, { indent: 8, lineGap: 0.5 });
      const links = [project.repositoryUrl, project.demoUrl].filter(Boolean);
      if (links.length > 0) doc.text(links.join(" | "), { indent: 8, lineGap: 0.5 });
      const verifiedTechnologies = project.technologies.filter((technology) =>
        profile.skills.some((skill) => skill.name.toLowerCase() === technology.toLowerCase()),
      );
      if (verifiedTechnologies.length > 0) doc.text(`Technologies: ${verifiedTechnologies.join(", ")}`, { indent: 8, lineGap: 0.5 });
      doc.moveDown(0.1);
    }
  }

  if (profile.education.length > 0) {
    writeSectionHeading(doc, "Education");
    for (const education of profile.education) {
      const details = [education.degree, education.status].filter(Boolean).join(" | ");
      doc.font("Helvetica-Bold").text(education.institution || details);
      if (education.institution && details) doc.font("Helvetica").text(details, { indent: 8 });
    }
  }

  if (profile.englishLevel) {
    writeSectionHeading(doc, "Languages");
    doc.text(`English: ${profile.englishLevel}`);
  }

  Object.assign(doc.info, {
    Title: `${profile.fullName} - ${offer.company || "Company"} - ${offer.title} ATS CV`,
    Author: profile.fullName || "Candidate",
    Subject: `ATS CV generated for ${offer.title}; estimated match ${match.realScore}/100`,
    Creator: "Job Search Agent",
  });
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n").replace(/\s+/g, " ").trim();
  } finally {
    await loadingTask.destroy();
  }
}

export async function generateCvPdf(
  profile: CandidateProfile,
  offer: JobOfferInput,
  match: MatchResult,
): Promise<GeneratedPdf> {
  const chunks: Buffer[] = [];
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margins: { top: 34, right: 42, bottom: 34, left: 42 }, compress: true });
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    renderCv(document, profile, offer, match);
    document.end();
  });
  if (buffer.length < 100 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Generated file is not a valid PDF.");
  }
  const extractedText = await extractPdfText(buffer);
  if (!extractedText.includes(profile.fullName) || !extractedText.includes(offer.title)) {
    throw new Error("The generated PDF does not contain the expected candidate and position text.");
  }
  const { createHash } = await import("node:crypto");
  return { buffer, extractedText, sha256: createHash("sha256").update(buffer).digest("hex") };
}

export function newPdfId(): string {
  return randomUUID();
}
