create index job_offers_source_owner_idx
  on public.job_offers (source_id, user_id)
  where source_id is not null;
create index job_offers_automation_run_idx
  on public.job_offers (automation_run_id)
  where automation_run_id is not null;
