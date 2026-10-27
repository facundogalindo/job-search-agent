create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('greenhouse', 'lever', 'ashby')),
  company_name text not null,
  board_token text not null,
  region text not null default 'global' check (region in ('global', 'eu')),
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_status text not null default 'NEVER_CHECKED' check (last_status in ('NEVER_CHECKED', 'OK', 'ERROR')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, board_token, region),
  unique (id, user_id)
);

create index job_sources_user_enabled_idx on public.job_sources (user_id, enabled);
alter table public.job_sources enable row level security;
create policy job_sources_owner_all on public.job_sources for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on table public.job_sources to authenticated;
revoke all on table public.job_sources from anon;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_checked integer not null default 0 check (sources_checked >= 0),
  sources_failed integer not null default 0 check (sources_failed >= 0),
  jobs_fetched integer not null default 0 check (jobs_fetched >= 0),
  jobs_new integer not null default 0 check (jobs_new >= 0),
  jobs_relevant integer not null default 0 check (jobs_relevant >= 0),
  jobs_discarded integer not null default 0 check (jobs_discarded >= 0),
  cvs_generated integer not null default 0 check (cvs_generated >= 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index automation_runs_user_started_idx on public.automation_runs (user_id, started_at desc);
alter table public.automation_runs enable row level security;
create policy automation_runs_owner_all on public.automation_runs for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update on table public.automation_runs to authenticated;
revoke all on table public.automation_runs from anon;

alter table public.job_offers
  add column source_id uuid,
  add column external_id text,
  add column origin text not null default 'manual' check (origin in ('manual', 'connector')),
  add column last_seen_at timestamptz,
  add column last_verified_at timestamptz,
  add column discard_reason text,
  add column automation_run_id uuid references public.automation_runs (id) on delete set null;

alter table public.job_offers
  add constraint job_offers_source_owner_fk foreign key (source_id, user_id)
    references public.job_sources (id, user_id) on delete set null (source_id);

create unique index job_offers_source_external_unique
  on public.job_offers (user_id, source_id, external_id)
  where source_id is not null and external_id is not null;
create index job_offers_source_seen_idx on public.job_offers (user_id, last_seen_at desc);
create index job_offers_discarded_idx on public.job_offers (user_id, created_at desc) where status = 'DISCARDED';
