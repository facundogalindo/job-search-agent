-- Phase 1 schema for the personal Job Search Agent.
-- This migration is additive and keeps all candidate/job data scoped to auth.uid().

create table public.candidate_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  headline text not null default '',
  location text not null default '',
  contact_email text,
  contact_phone text,
  english_level text not null default '',
  education jsonb not null default '[]'::jsonb check (jsonb_typeof(education) = 'array'),
  experience jsonb not null default '[]'::jsonb check (jsonb_typeof(experience) = 'array'),
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.candidate_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  name text not null,
  level text not null default 'Not specified',
  context text not null default '',
  evidence text not null default '',
  validation_status text not null default 'candidate_confirmed',
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index candidate_skills_user_id_idx on public.candidate_skills (user_id);

create table public.candidate_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  repository_url text,
  demo_url text,
  technologies text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index candidate_projects_user_id_idx on public.candidate_projects (user_id);

create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  company text not null default '',
  description text not null,
  source_url text,
  location text not null default '',
  work_mode text not null default 'Unknown',
  posted_at timestamptz,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'DETECTED'
    check (status in ('DETECTED', 'ANALYZED', 'CV_READY', 'PROCESSING_ERROR', 'DISCARDED', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_hash),
  unique (id, user_id)
);

create index job_offers_user_created_idx on public.job_offers (user_id, created_at desc);

create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_offer_id uuid not null,
  real_score integer not null check (real_score between 0 and 100),
  ats_coverage_score integer not null check (ats_coverage_score between 0 and 100),
  explanation jsonb not null default '{}'::jsonb check (jsonb_typeof(explanation) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_offer_id),
  foreign key (job_offer_id, user_id)
    references public.job_offers (id, user_id) on delete cascade
);

create index match_results_user_id_idx on public.match_results (user_id);

create table public.cv_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_offer_id uuid not null,
  version integer not null check (version > 0),
  file_name text not null,
  storage_path text,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'GENERATING' check (status in ('GENERATING', 'READY', 'FAILED')),
  match_score integer not null check (match_score between 0 and 100),
  ats_coverage_score integer not null check (ats_coverage_score between 0 and 100),
  content_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(content_snapshot) = 'object'),
  generated_at timestamptz not null default now(),
  unique (job_offer_id, version),
  unique (storage_path),
  foreign key (job_offer_id, user_id)
    references public.job_offers (id, user_id) on delete cascade
);

create index cv_versions_user_offer_idx on public.cv_versions (user_id, job_offer_id, version desc);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_offer_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (job_offer_id, user_id)
    references public.job_offers (id, user_id) on delete cascade
);

create index application_events_user_offer_created_idx
  on public.application_events (user_id, job_offer_id, created_at desc);

alter table public.candidate_profiles enable row level security;
alter table public.candidate_skills enable row level security;
alter table public.candidate_projects enable row level security;
alter table public.job_offers enable row level security;
alter table public.match_results enable row level security;
alter table public.cv_versions enable row level security;
alter table public.application_events enable row level security;

create policy candidate_profiles_owner_all on public.candidate_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy candidate_skills_owner_all on public.candidate_skills
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy candidate_projects_owner_all on public.candidate_projects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy job_offers_owner_all on public.job_offers
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy match_results_owner_all on public.match_results
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy cv_versions_owner_all on public.cv_versions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy application_events_owner_all on public.application_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.candidate_profiles, public.candidate_skills, public.candidate_projects,
  public.job_offers, public.match_results, public.cv_versions, public.application_events from anon;

grant select, insert, update, delete on table public.candidate_profiles, public.candidate_skills,
  public.candidate_projects, public.job_offers, public.match_results, public.cv_versions,
  public.application_events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidate-cvs', 'candidate-cvs', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy candidate_cvs_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'candidate-cvs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy candidate_cvs_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'candidate-cvs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
