import type { Session } from "@supabase/supabase-js";

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

export interface MatchFactor {
  name: string;
  weight: number;
  score: number;
  explanation: string;
}

export interface MatchData {
  realScore: number;
  atsCoverageScore: number;
  requirements: { name: string; required: boolean | null }[];
  matchedSkills: string[];
  missingSkills: string[];
  factors: MatchFactor[];
}

export interface CvVersion {
  id: string;
  version: number;
  fileName: string;
  generatedAt: string;
  matchScore: number;
  atsCoverageScore: number;
}

export interface JobOffer {
  id: string;
  title: string;
  company: string;
  description: string;
  sourceUrl: string | null;
  location: string;
  workMode: string;
  postedAt: string | null;
  status: string;
  applicationStatus: "PENDING" | "SENT" | "INTERVIEW" | "REJECTED";
  discardReason: string | null;
  origin: "manual" | "connector";
  sourceName: string | null;
  createdAt: string;
  match: MatchData | null;
  cvVersions: CvVersion[];
}

export interface JobSource {
  id: string;
  provider: "greenhouse" | "lever" | "ashby";
  company_name: string;
  board_token: string;
  region: "global" | "eu";
  enabled: boolean;
  last_checked_at: string | null;
  last_status: "NEVER_CHECKED" | "OK" | "ERROR";
  last_error: string | null;
}

export interface AutomationRun {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  trigger: "manual" | "scheduled";
  started_at: string;
  finished_at: string | null;
  jobs_fetched: number;
  jobs_new: number;
  jobs_relevant: number;
  jobs_discarded: number;
  cvs_generated: number;
  sources_failed: number;
  details: Record<string, unknown>;
}

export interface SearchResult {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  sourcesChecked: number;
  sourcesFailed: number;
  jobsFetched: number;
  jobsNew: number;
  jobsRelevant: number;
  jobsDiscarded: number;
  cvsGenerated: number;
  duplicateCount: number;
  discardReasons: Record<string, number>;
  errors: string[];
}

export interface ApplicationEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type { Session };
