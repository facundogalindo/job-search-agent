import { z } from "zod";

const optionalText = z.string().trim().max(1000).default("");
const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .default("")
  .refine((value) => value === "" || URL.canParse(value), "Must be a valid URL");

export const ProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  headline: z.string().trim().max(240).default(""),
  location: z.string().trim().max(160).default(""),
  contactEmail: z.string().trim().max(254).default(""),
  contactPhone: z.string().trim().max(60).default(""),
  englishLevel: z.string().trim().max(80).default(""),
  education: z.array(z.object({
    institution: z.string().trim().max(240).default(""),
    degree: z.string().trim().max(240).default(""),
    status: z.string().trim().max(120).default(""),
  })).max(20),
  experience: z.array(z.object({
    company: z.string().trim().max(240).default(""),
    title: z.string().trim().max(240).default(""),
    startDate: z.string().trim().max(20).default(""),
    endDate: z.string().trim().max(20).default(""),
    description: optionalText,
    highlights: z.array(z.string().trim().max(500)).max(30),
  })).max(30),
  links: z.object({ linkedin: optionalUrl, github: optionalUrl }),
  skills: z.array(z.object({
    category: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(120),
    level: z.string().trim().max(120).default("Not specified"),
    context: optionalText,
    evidence: optionalText,
    validationStatus: z.string().trim().max(80).default("candidate_confirmed"),
  })).max(100),
  projects: z.array(z.object({
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().max(2000).default(""),
    repositoryUrl: optionalUrl,
    demoUrl: optionalUrl,
    technologies: z.array(z.string().trim().max(120)).max(40),
  })).max(50),
});

export const OfferInputSchema = z.object({
  title: z.string().trim().max(240).default(""),
  company: z.string().trim().max(240).default(""),
  description: z.string().trim().min(20).max(30000),
  sourceUrl: optionalUrl,
  location: z.string().trim().max(240).default(""),
  workMode: z.string().trim().max(80).default("Unknown"),
  postedAt: z.string().trim().max(40).default(""),
});

export const SourceInputSchema = z.object({
  provider: z.enum(["greenhouse", "lever", "ashby"]),
  companyName: z.string().trim().min(1).max(160),
  boardToken: z.string().trim().min(1).max(100).regex(/^[a-z0-9._-]+$/i),
  region: z.enum(["global", "eu"]).default("global"),
  enabled: z.boolean().default(true),
});

export const ApplicationStatusSchema = z.object({
  status: z.enum(["PENDING", "SENT", "INTERVIEW", "REJECTED"]),
});

export type ProfileInput = z.infer<typeof ProfileSchema>;
export type OfferInput = z.infer<typeof OfferInputSchema>;
