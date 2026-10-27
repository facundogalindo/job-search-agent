-- Add indexes for the composite foreign keys that join job records to their owner.
create index match_results_offer_owner_idx on public.match_results (job_offer_id, user_id);
create index cv_versions_offer_owner_idx on public.cv_versions (job_offer_id, user_id);
create index application_events_offer_owner_idx on public.application_events (job_offer_id, user_id);

-- The unique (user_id, name) indexes already support owner filtering for projects.
drop index if exists public.candidate_projects_user_id_idx;

-- Skills are listed by category and name in the profile editor.
drop index if exists public.candidate_skills_user_id_idx;
create index candidate_skills_user_category_name_idx
  on public.candidate_skills (user_id, category, name);
