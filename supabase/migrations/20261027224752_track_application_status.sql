alter table public.job_offers
  add column application_status text not null default 'PENDING'
    check (application_status in ('PENDING', 'SENT', 'INTERVIEW', 'REJECTED'));

create index job_offers_user_application_status_idx
  on public.job_offers (user_id, application_status, created_at desc)
  where status <> 'DISCARDED';
