-- Live proposal progress is readable only through the authenticated host broker.
create table if not exists public.contour_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  surface_id text not null,
  client_id text not null,
  status text not null check (status in ('working', 'ready', 'kept', 'asked', 'failed')),
  task text not null,
  expertise text not null,
  proposal_id uuid,
  changed_components text[] not null default '{}',
  message text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contour_jobs_owner_idx
  on public.contour_jobs(tenant_id, app_id, subject_id, surface_id, started_at desc);
alter table public.contour_jobs enable row level security;
revoke all on public.contour_jobs from public, anon, authenticated;
grant all on public.contour_jobs to service_role;
