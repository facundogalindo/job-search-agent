export interface EducationEntry {
  institution: string;
  degree: string;
  status: string;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
  highlights: string[];
}

export interface ProfileSkill {
  category: string;
  name: string;
  level: string;
  context: string;
  evidence: string;
  validationStatus: string;
}

export interface ProjectEntry {
  name: string;
  description: string;
  repositoryUrl: string;
  demoUrl: string;
  technologies: string[];
}

export interface CandidateProfile {
  fullName: string;
  headline: string;
  location: string;
  contactEmail: string;
  contactPhone: string;
  englishLevel: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  links: { linkedin: string; github: string };
  skills: ProfileSkill[];
  projects: ProjectEntry[];
}

export interface JobOfferInput {
  title: string;
  company: string;
  description: string;
  sourceUrl: string;
  location: string;
  workMode: string;
  postedAt: string;
}

export interface JobOffer extends JobOfferInput {
  id: string;
  status: string;
  createdAt: string;
}

export interface DetectedRequirement {
  name: string;
  required: boolean | null;
}

export interface MatchFactor {
  name: string;
  weight: number;
  score: number;
  explanation: string;
}

export interface MatchResult {
  realScore: number;
  atsCoverageScore: number;
  requirements: DetectedRequirement[];
  matchedSkills: string[];
  missingSkills: string[];
  factors: MatchFactor[];
}
