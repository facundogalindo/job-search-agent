import type { CandidateProfile, DetectedRequirement, JobOfferInput, MatchFactor, MatchResult } from "./types.js";

interface Technology {
  name: string;
  aliases: string[];
}

const TECHNOLOGIES: Technology[] = [
  { name: "Java", aliases: ["java"] },
  { name: "Spring Boot", aliases: ["spring boot", "springboot"] },
  { name: "Spring Data JPA", aliases: ["spring data jpa", "jpa"] },
  { name: "Node.js", aliases: ["node.js", "node js", "nodejs"] },
  { name: "Express.js", aliases: ["express.js", "express js", "expressjs"] },
  { name: "Python", aliases: ["python"] },
  { name: "FastAPI", aliases: ["fastapi", "fast api"] },
  { name: "REST APIs", aliases: ["rest api", "rest apis", "restful api", "api rest"] },
  { name: "Layered architecture", aliases: ["layered architecture", "arquitectura por capas"] },
  { name: "JWT authentication", aliases: ["jwt", "json web token", "autenticacion jwt"] },
  { name: "React", aliases: ["react"] },
  { name: "JavaScript", aliases: ["javascript", "js"] },
  { name: "TypeScript", aliases: ["typescript", "ts"] },
  { name: "HTML", aliases: ["html"] },
  { name: "CSS", aliases: ["css"] },
  { name: "PostgreSQL", aliases: ["postgresql", "postgres", "postgre sql"] },
  { name: "SQL", aliases: ["sql"] },
  { name: "Relational data modeling", aliases: ["relational data modeling", "modelado relacional"] },
  { name: "Git", aliases: ["git"] },
  { name: "GitHub", aliases: ["github"] },
  { name: "Postman", aliases: ["postman"] },
  { name: "DBeaver", aliases: ["dbeaver"] },
  { name: "Jira", aliases: ["jira"] },
  { name: "Docker", aliases: ["docker"] },
  { name: "AWS", aliases: ["aws", "amazon web services"] },
  { name: "Requirements analysis", aliases: ["requirements analysis", "business requirements", "analisis de requerimientos", "analisis de requisitos"] },
  { name: "Functional analysis", aliases: ["functional analysis", "functional analyst", "analisis funcional", "analista funcional"] },
  { name: "Business analysis", aliases: ["business analysis", "business analyst", "analista de negocio"] },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function includesPhrase(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedPhrase = ` ${normalize(phrase)} `;
  return normalizedText.includes(normalizedPhrase);
}

function classifyRequirement(description: string, technology: Technology): boolean | null {
  const lines = description.split(/[\n\r.!?;]+/);
  const matchingLine = lines.find((line) => technology.aliases.some((alias) => includesPhrase(line, alias)));
  if (!matchingLine) return null;
  if (/\b(required|must have|mandatory|requisite|requisitos? obligatorios?|excluyente|indispensable|requerido)\b/i.test(matchingLine)) {
    return true;
  }
  if (/\b(nice to have|preferred|desirable|deseable|preferible|plus|optional|valorable)\b/i.test(matchingLine)) {
    return false;
  }
  return null;
}

export function detectRequirements(description: string): DetectedRequirement[] {
  return TECHNOLOGIES
    .filter((technology) => technology.aliases.some((alias) => includesPhrase(description, alias)))
    .map((technology) => ({ name: technology.name, required: classifyRequirement(description, technology) }));
}

function profileHasSkill(profile: CandidateProfile, name: string): boolean {
  const technology = TECHNOLOGIES.find((item) => item.name === name);
  const aliases = technology?.aliases ?? [name];
  return profile.skills.some((skill) => aliases.some((alias) => includesPhrase(skill.name, alias)))
    || profile.projects.some((project) => project.technologies.some((skill) => aliases.some((alias) => includesPhrase(skill, alias))))
    || (/analysis|analyst|requerimiento|requirements/.test(normalize(name))
      && aliases.some((alias) => includesPhrase(profileText(profile), alias)));
}

function profileText(profile: CandidateProfile): string {
  return [
    profile.headline,
    ...profile.experience.flatMap((entry) => [entry.title, entry.description, ...entry.highlights]),
    ...profile.education.flatMap((entry) => [entry.degree, entry.institution]),
    ...profile.skills.map((skill) => skill.name),
    ...profile.projects.flatMap((project) => [project.name, ...project.technologies]),
  ].join(" ");
}

function yearsRequired(description: string): number | null {
  const matches = [...description.matchAll(/(\d+)\s*\+?\s*(?:years?|a[nñ]os?)\b/gi)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1] ?? 0)));
}

function monthsBetween(start: string, end: string): number {
  const startMatch = /^(\d{4})-(\d{2})$/.exec(start);
  const endMatch = /^(\d{4})-(\d{2})$/.exec(end);
  if (!startMatch || !endMatch) return 0;
  return Math.max(0, (Number(endMatch[1]) - Number(startMatch[1])) * 12 + Number(endMatch[2]) - Number(startMatch[2]));
}

function professionalExperienceScore(profile: CandidateProfile, offer: JobOfferInput): { score: number; explanation: string } {
  const text = normalize(`${offer.title} ${offer.description}`);
  const functionalRole = /analista funcional|functional analyst|business analyst|analista de sistemas|requirements analyst|analista de requerimientos/.test(text);
  const requiredYears = yearsRequired(offer.description);
  const candidateMonths = profile.experience.reduce((total, entry) => total + monthsBetween(entry.startDate, entry.endDate), 0);
  const hasFunctionalExperience = profile.experience.some((entry) => /functional analyst|analista funcional|business analyst/i.test(entry.title));

  if (functionalRole && hasFunctionalExperience) {
    const years = candidateMonths / 12;
    if (requiredYears === null) return { score: 95, explanation: "El perfil incluye experiencia profesional como Functional Analyst." };
    const score = Math.min(100, Math.round((years / requiredYears) * 100));
    return { score, explanation: `La experiencia profesional registrada cubre aproximadamente ${years.toFixed(0)} año(s); el aviso pide ${requiredYears}.` };
  }

  if (requiredYears !== null) {
    return {
      score: 20,
      explanation: `No hay experiencia profesional de desarrollo verificada en el perfil; el aviso pide ${requiredYears} año(s).`,
    };
  }

  if (/junior|jr\b|trainee|intern|internship|pasant[ií]a/.test(text)) {
    return { score: 72, explanation: "El puesto se presenta como inicial; la experiencia profesional disponible es de análisis funcional." };
  }
  return { score: 55, explanation: "El perfil acredita experiencia funcional; no informa años de experiencia profesional en desarrollo." };
}

function educationScore(profile: CandidateProfile, description: string): { score: number; explanation: string } {
  const text = normalize(description);
  if (!/degree|bachelor|licenciatura|ingenieria|engineering|computer science|systems|sistemas/.test(text)) {
    return { score: 85, explanation: "El aviso no especifica una formación obligatoria." };
  }
  const candidateEducation = normalize(profile.education.map((entry) => `${entry.degree} ${entry.status}`).join(" "));
  const related = /engineering|ingenieria|systems|sistemas|computer science|informatica/.test(candidateEducation);
  const completedRequired = !/advanced student|estudiante avanzado|student|en curso|in progress/.test(candidateEducation);
  if (!related) return { score: 25, explanation: "La formación registrada no coincide claramente con el área indicada." };
  if (/graduated|graduate|recibido|egresado|completed|bachelor/.test(text) && !completedRequired) {
    return { score: 55, explanation: "La carrera es afín y está en curso; el aviso parece pedir título completo." };
  }
  return { score: 95, explanation: "La carrera registrada es afín con los estudios solicitados." };
}

function languageScore(profile: CandidateProfile, description: string): { score: number; explanation: string } {
  const text = normalize(description);
  if (!/english|ingles|b2|c1|fluent|advanced english/.test(text)) {
    return { score: 85, explanation: "El aviso no especifica nivel de inglés." };
  }
  const level = normalize(profile.englishLevel);
  if (/native|c2/.test(text)) return { score: /native|c2/.test(level) ? 100 : 35, explanation: `El nivel registrado es ${profile.englishLevel || "no informado"}; el requisito parece nativo/C2.` };
  if (/c1|fluent|advanced english/.test(text)) return { score: /c1|c2|fluent|advanced/.test(level) ? 100 : 55, explanation: `El nivel registrado es ${profile.englishLevel || "no informado"}; el aviso pide inglés avanzado.` };
  return { score: /b2|c1|c2|fluent|advanced/.test(level) ? 100 : 55, explanation: `El nivel registrado es ${profile.englishLevel || "no informado"}.` };
}

function locationScore(profile: CandidateProfile, offer: JobOfferInput): { score: number; explanation: string } {
  const location = normalize(`${offer.location} ${offer.description}`);
  const candidateLocation = normalize(profile.location);
  if (/remote|remoto|remota|home office|teletrabajo/.test(location)) {
    if (/argentina|latam|latin america|anywhere|cualquier lugar/.test(location)) {
      return { score: 100, explanation: "La modalidad remota es compatible con la ubicación registrada." };
    }
    return { score: 75, explanation: "El aviso indica modalidad remota, pero no confirma si acepta residentes en Argentina." };
  }
  if (/cordoba|c[oó]rdoba/.test(location) && /cordoba/.test(candidateLocation)) {
    return { score: 100, explanation: "La ubicación indicada coincide con Córdoba." };
  }
  if (!offer.location && !/cordoba|c[oó]rdoba|remote|remoto/.test(location)) {
    return { score: 75, explanation: "El aviso no indica una ubicación clara." };
  }
  if (/argentina/.test(location) && /cordoba/.test(candidateLocation)) {
    return { score: 90, explanation: "La vacante está en Argentina y el candidato está en Córdoba." };
  }
  return { score: 35, explanation: "No se pudo confirmar que la ubicación o modalidad sea compatible." };
}

function roleAlignmentScore(profile: CandidateProfile, offer: JobOfferInput): { score: number; explanation: string } {
  const title = normalize(offer.title);
  const historyTitles = normalize(profile.experience.map((entry) => entry.title).join(" "));
  if (/analista funcional|functional analyst|business analyst|analista de sistemas|requirements analyst/.test(title)
    && /analista|analyst/.test(historyTitles)) {
    return { score: 100, explanation: "El cargo objetivo se alinea con la experiencia profesional como analista." };
  }
  const technical = profile.skills.filter((skill) => /backend|frontend|database|databases/i.test(skill.category)).length;
  if (/developer|engineer|desarrollador|software|backend|back end|java|node|python/.test(title) && technical > 0) {
    return { score: 72, explanation: "El perfil declara conocimientos técnicos pertinentes; la experiencia profesional de desarrollo no está verificada." };
  }
  return { score: 50, explanation: "La relación entre el título del puesto y la experiencia registrada es parcial." };
}

export function calculateMatch(profile: CandidateProfile, offer: JobOfferInput): MatchResult {
  const requirements = detectRequirements(offer.description);
  const matchedSkills = requirements.filter((requirement) => profileHasSkill(profile, requirement.name)).map((requirement) => requirement.name);
  const missingSkills = requirements.filter((requirement) => !profileHasSkill(profile, requirement.name)).map((requirement) => requirement.name);
  const required = requirements.filter((requirement) => requirement.required === true);
  const desired = requirements.filter((requirement) => requirement.required === false);
  const requiredMatches = required.filter((requirement) => profileHasSkill(profile, requirement.name)).length;
  const desiredMatches = desired.filter((requirement) => profileHasSkill(profile, requirement.name)).length;
  const requiredTechScore = required.length === 0 ? 80 : Math.round((requiredMatches / required.length) * 100);
  const desiredTechScore = desired.length === 0 ? 100 : Math.round((desiredMatches / desired.length) * 100);
  const experience = professionalExperienceScore(profile, offer);
  const education = educationScore(profile, offer.description);
  const language = languageScore(profile, offer.description);
  const location = locationScore(profile, offer);
  const role = roleAlignmentScore(profile, offer);
  const factors: MatchFactor[] = [
    { name: "Mandatory technology requirements", weight: 35, score: requiredTechScore, explanation: required.length ? `${requiredMatches} of ${required.length} detected mandatory technologies are supported by the profile.` : "No mandatory technologies were clearly marked in the description." },
    { name: "Desired technology requirements", weight: 10, score: desiredTechScore, explanation: desired.length ? `${desiredMatches} of ${desired.length} detected desirable technologies are supported by the profile.` : "No desirable technologies were clearly marked in the description." },
    { name: "Professional experience", weight: 20, score: experience.score, explanation: experience.explanation },
    { name: "Education", weight: 10, score: education.score, explanation: education.explanation },
    { name: "Language", weight: 5, score: language.score, explanation: language.explanation },
    { name: "Location and work mode", weight: 10, score: location.score, explanation: location.explanation },
    { name: "Role alignment", weight: 10, score: role.score, explanation: role.explanation },
  ];
  const realScore = Math.round(factors.reduce((total, factor) => total + factor.weight * factor.score / 100, 0));
  const technologyCoverage = requirements.length === 0
    ? 72
    : Math.round((matchedSkills.length / requirements.length) * 100);
  const atsCoverageScore = Math.round(technologyCoverage * 0.9 + 100 * 0.1);
  return { realScore, atsCoverageScore, requirements, matchedSkills, missingSkills, factors };
}

export function orderedSkills(profile: CandidateProfile, offer: JobOfferInput): CandidateProfile["skills"] {
  const detected = detectRequirements(offer.description).map((requirement) => normalize(requirement.name));
  const familyRank = (category: string) => {
    const normalized = normalize(category);
    const functional = /funcional|functional|analyst|analysis/.test(normalize(offer.title));
    if (functional) {
      if (/business|analysis|tools/.test(normalized)) return 0;
      if (/database/.test(normalized)) return 1;
      return 2;
    }
    if (/backend/.test(normalized)) return 0;
    if (/database/.test(normalized)) return 1;
    if (/frontend/.test(normalized)) return 2;
    return 3;
  };
  return [...profile.skills].sort((left, right) => {
    const leftDetected = detected.some((term) => includesPhrase(left.name, term));
    const rightDetected = detected.some((term) => includesPhrase(right.name, term));
    return Number(rightDetected) - Number(leftDetected) || familyRank(left.category) - familyRank(right.category) || left.name.localeCompare(right.name);
  });
}

export function tailoredSummary(profile: CandidateProfile, offer: JobOfferInput): string {
  const functionalRole = /analista funcional|functional analyst|business analyst|analista de sistemas|requirements analyst/i.test(offer.title);
  const work = profile.experience[0];
  const education = profile.education[0];
  const educationText = education ? `${education.status} ${education.degree}`.trim() : "Candidate with a configurable professional profile";
  if (functionalRole && work) {
    const profileSkillNames = new Set(profile.skills.map((skill) => normalize(skill.name)));
    const technical = calculateMatch(profile, offer).matchedSkills
      .filter((name) => profileSkillNames.has(normalize(name)))
      .slice(0, 5)
      .join(", ");
    return `${work.title} with experience in business requirements, functional documentation, validation criteria, incident analysis, and collaboration with development teams. ${educationText}.${technical ? ` Technical knowledge includes ${technical}.` : ""}`;
  }
  const relevantSkills = orderedSkills(profile, offer).slice(0, 6).map((skill) => skill.name).join(", ");
  const background = work ? `Professional experience as ${work.title};` : "Professional experience as recorded in the profile;";
  return `${educationText}. ${background} technical knowledge includes ${relevantSkills || "the skills listed below"}. Professional development experience is not attributed to the functional analyst position.`;
}
