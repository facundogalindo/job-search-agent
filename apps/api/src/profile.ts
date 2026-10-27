import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfileSchema, type ProfileInput } from "./schemas.js";
import type { CandidateProfile } from "./types.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function profileFilePath(): string {
  const configured = process.env.PRIVATE_PROFILE_PATH ?? ".private/profile.json";
  return path.isAbsolute(configured) ? configured : path.resolve(ROOT_DIR, configured);
}

export async function loadPrivateProfile(): Promise<ProfileInput> {
  try {
    const contents = await readFile(profileFilePath(), "utf8");
    return ProfileSchema.parse(JSON.parse(contents));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ProfileSchema.parse({
        fullName: "Candidate",
        headline: "",
        location: "",
        contactEmail: "",
        contactPhone: "",
        englishLevel: "",
        education: [],
        experience: [],
        links: { linkedin: "", github: "" },
        skills: [],
        projects: [],
      });
    }
    throw error;
  }
}

function toProfileRow(userId: string, profile: ProfileInput) {
  return {
    user_id: userId,
    full_name: profile.fullName,
    headline: profile.headline,
    location: profile.location,
    contact_email: profile.contactEmail || null,
    contact_phone: profile.contactPhone || null,
    english_level: profile.englishLevel,
    education: profile.education,
    experience: profile.experience,
    links: profile.links,
    updated_at: new Date().toISOString(),
  };
}

async function replaceProfileChildren(client: SupabaseClient, userId: string, profile: ProfileInput) {
  const skillDelete = await client.from("candidate_skills").delete().eq("user_id", userId);
  if (skillDelete.error) throw skillDelete.error;
  if (profile.skills.length > 0) {
    const skillInsert = await client.from("candidate_skills").insert(profile.skills.map((skill) => ({
      user_id: userId,
      category: skill.category,
      name: skill.name,
      level: skill.level,
      context: skill.context,
      evidence: skill.evidence,
      validation_status: skill.validationStatus,
      updated_at: new Date().toISOString(),
    })));
    if (skillInsert.error) throw skillInsert.error;
  }

  const projectDelete = await client.from("candidate_projects").delete().eq("user_id", userId);
  if (projectDelete.error) throw projectDelete.error;
  if (profile.projects.length > 0) {
    const projectInsert = await client.from("candidate_projects").insert(profile.projects.map((project) => ({
      user_id: userId,
      name: project.name,
      description: project.description,
      repository_url: project.repositoryUrl || null,
      demo_url: project.demoUrl || null,
      technologies: project.technologies,
      updated_at: new Date().toISOString(),
    })));
    if (projectInsert.error) throw projectInsert.error;
  }
}

function normalizeProfile(
  base: Record<string, unknown>,
  skills: Record<string, unknown>[],
  projects: Record<string, unknown>[],
): CandidateProfile {
  const education = Array.isArray(base.education) ? base.education : [];
  const experience = Array.isArray(base.experience) ? base.experience : [];
  const links = typeof base.links === "object" && base.links !== null
    ? base.links as { linkedin?: string; github?: string }
    : {};
  return {
    fullName: String(base.full_name ?? ""),
    headline: String(base.headline ?? ""),
    location: String(base.location ?? ""),
    contactEmail: String(base.contact_email ?? ""),
    contactPhone: String(base.contact_phone ?? ""),
    englishLevel: String(base.english_level ?? ""),
    education: education as CandidateProfile["education"],
    experience: experience as CandidateProfile["experience"],
    links: { linkedin: links.linkedin ?? "", github: links.github ?? "" },
    skills: skills.map((skill) => ({
      category: String(skill.category ?? "Other"),
      name: String(skill.name ?? ""),
      level: String(skill.level ?? "Not specified"),
      context: String(skill.context ?? ""),
      evidence: String(skill.evidence ?? ""),
      validationStatus: String(skill.validation_status ?? "candidate_confirmed"),
    })),
    projects: projects.map((project) => ({
      name: String(project.name ?? ""),
      description: String(project.description ?? ""),
      repositoryUrl: String(project.repository_url ?? ""),
      demoUrl: String(project.demo_url ?? ""),
      technologies: Array.isArray(project.technologies) ? project.technologies.map(String) : [],
    })),
  };
}

export async function getOrCreateProfile(client: SupabaseClient, userId: string): Promise<CandidateProfile> {
  const { data: existing, error: selectError } = await client
    .from("candidate_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (selectError) throw selectError;

  let base = existing as Record<string, unknown> | null;
  if (!base) {
    const initial = await loadPrivateProfile();
    const { data, error } = await client
      .from("candidate_profiles")
      .insert(toProfileRow(userId, initial))
      .select("*")
      .single();
    if (error) throw error;
    base = data as Record<string, unknown>;
    await replaceProfileChildren(client, userId, initial);
  }

  const [{ data: skillRows, error: skillError }, { data: projectRows, error: projectError }] = await Promise.all([
    client.from("candidate_skills").select("*").eq("user_id", userId).order("category").order("name"),
    client.from("candidate_projects").select("*").eq("user_id", userId).order("name"),
  ]);
  if (skillError) throw skillError;
  if (projectError) throw projectError;
  return normalizeProfile(base, (skillRows ?? []) as Record<string, unknown>[], (projectRows ?? []) as Record<string, unknown>[]);
}

export async function saveProfile(client: SupabaseClient, userId: string, input: unknown): Promise<CandidateProfile> {
  const profile = ProfileSchema.parse(input);
  const { data, error } = await client
    .from("candidate_profiles")
    .upsert(toProfileRow(userId, profile), { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  await replaceProfileChildren(client, userId, profile);

  const [{ data: skillRows, error: skillError }, { data: projectRows, error: projectError }] = await Promise.all([
    client.from("candidate_skills").select("*").eq("user_id", userId).order("category").order("name"),
    client.from("candidate_projects").select("*").eq("user_id", userId).order("name"),
  ]);
  if (skillError) throw skillError;
  if (projectError) throw projectError;
  return normalizeProfile(data as Record<string, unknown>, (skillRows ?? []) as Record<string, unknown>[], (projectRows ?? []) as Record<string, unknown>[]);
}
