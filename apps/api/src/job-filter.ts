import type { PublicJob } from "./connectors.js";

export type RoleFit = "backend_junior" | "functional_analyst" | "it_internship" | "out_of_scope";
export interface ListingAssessment {
  relevant: boolean;
  roleFit: RoleFit;
  reason: string;
  experienceNote: string;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function experienceBounds(text: string): { min: number; max: number } | null {
  const normalized = normalize(text);
  const range = normalized.match(/\b(\d+)\s*(?:-|to|a)\s*(\d+)\s*\+?\s*(?:years?|anos?)\b/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = normalized.match(/\b(\d+)\s*\+\s*(?:years?|anos?)\b/);
  if (plus) return { min: Number(plus[1]), max: Number.POSITIVE_INFINITY };
  const years = normalized.match(/\b(?:at least |minimum of |minimo de )?(\d+)\s*(?:years?|anos?)(?: of experience| de experiencia)?\b/);
  if (years) return { min: Number(years[1]), max: Number(years[1]) };
  if (/no experience|sin experiencia|0 years|0 anos|new grad|recent graduate/.test(normalized)) return { min: 0, max: 0 };
  return null;
}

function isBackendTitle(title: string): boolean {
  return /\b(back[ -]?end|java|spring boot|node(?:\.js)?|software engineer|software developer|ingeniero de software|desarrollador(?:a)? (?:backend|de software|java|node|spring)|programador(?:a)? (?:backend|de software|java)|programmer (?:java|backend))\b/.test(title);
}

function isFunctionalTitle(title: string): boolean {
  return /\b(analista(?: tecnico)? funcional|technical functional analyst|functional analyst|business analyst|systems analyst|system analyst|requirements analyst|analista de sistemas)\b/.test(title);
}

function isItInternshipTitle(title: string): boolean {
  return /\b(intern(?:ship)?|pasant(?:e|ia|ias)?|practicas? profesionales)\b/.test(title)
    && /\b(it|software|technology|tecnologia|developer|desarrollador|engineer|ingenieria|systems|sistemas|computer|data)\b/.test(title);
}

function isSenior(title: string, description: string): boolean {
  const seniorInTitle = /\b(senior|sr\.?|lead|principal|staff|manager|director|architect|arquitecto|tech lead|head of)\b/.test(title);
  const years = experienceBounds(description);
  return seniorInTitle || Boolean(years && years.max > 2);
}

function locationFit(job: PublicJob): { eligible: boolean; reason: string } {
  const place = normalize(`${job.location} ${job.workMode}`);
  const text = normalize(`${job.location} ${job.workMode} ${job.description.slice(0, 9000)}`);
  if (/\b(cordoba|cordoba capital)\b/.test(place)) return { eligible: true, reason: "" };

  const hasArgentina = /\b(argentina|argentinian|argentine|buenos aires|cordoba,? ar)\b/.test(text);
  const hasLatam = /\b(latam|latin america|latinoamerica|south america|america latina)\b/.test(text);
  const remote = /\b(remote|remoto|work from home|teletrabajo|fully distributed)\b/.test(place) || /\b(remote|remoto|work from home|teletrabajo|fully distributed)\b/.test(text);
  if (remote && (hasArgentina || hasLatam)) return { eligible: true, reason: "" };
  if (remote) return { eligible: false, reason: "La oferta dice remoto, pero no confirma elegibilidad desde Argentina o LATAM." };
  if (/\b(argentina|argentine|argentinian)\b/.test(place)) {
    return { eligible: false, reason: "La ubicación indica Argentina, pero no confirma modalidad remota ni Córdoba para asistir." };
  }
  if (hasLatam && /\bhybrid|hibrid|on[- ]?site|presencial|office\b/.test(place)) {
    return { eligible: false, reason: "La modalidad presencial/híbrida no confirma una sede en Córdoba." };
  }
  return { eligible: false, reason: "La publicación no confirma Córdoba o trabajo remoto desde Argentina/LATAM." };
}

export function assessListing(job: PublicJob): ListingAssessment {
  const title = normalize(job.title);
  const description = normalize(job.description);
  const roleFit: RoleFit = isFunctionalTitle(title)
    ? "functional_analyst"
    : isBackendTitle(title) ? "backend_junior" : isItInternshipTitle(title) ? "it_internship" : "out_of_scope";

  if (roleFit === "out_of_scope") {
    return { relevant: false, roleFit, reason: "El título no coincide con backend junior/trainee ni análisis funcional.", experienceNote: "" };
  }
  if (isSenior(title, description)) {
    return { relevant: false, roleFit, reason: "La publicación pide seniority o más de 2 años de experiencia.", experienceNote: "" };
  }

  let experienceNote = "";
  if (roleFit === "backend_junior") {
    const entryCue = /\b(junior|jr\.?|trainee|intern|internship|entry[ -]?level|graduate|early career|pasantia|sin experiencia|associate|level i|engineer i|developer i)\b/.test(title)
      || /\b(0\s*(?:-|to|a)\s*2\s*(?:years?|anos?)|up to 2 years|1\s*(?:-|to|a)\s*2\s*(?:years?|anos?)|no experience|sin experiencia)\b/.test(description);
    if (!entryCue) {
      return { relevant: false, roleFit, reason: "Backend sin señal de nivel junior, trainee, pasantía o hasta 2 años." , experienceNote: "" };
    }
  } else {
    const years = experienceBounds(description);
    if (years && years.max > 2) {
      return { relevant: false, roleFit, reason: "Análisis funcional con requisito de más de 2 años." , experienceNote: "" };
    }
    if (!years) experienceNote = "El aviso no especifica años de experiencia; confirmar antes de postular.";
  }

  const geography = locationFit(job);
  if (!geography.eligible) return { relevant: false, roleFit, reason: geography.reason, experienceNote };
  return { relevant: true, roleFit, reason: "", experienceNote };
}

export function recencyRank(publishedAt: string): number {
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return Number.MAX_SAFE_INTEGER;
  return Date.now() - timestamp;
}
