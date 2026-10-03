-- Contour core schema: tenancy, manifests, preferences, views, proposals,
-- approvals, decisions, usage, billing ledger, OAuth grants.
--
-- Security model
--  * RLS is enabled on every table. End users (role `authenticated`) may only
--    SELECT their own rows while holding an active membership, and may only
--    UPDATE their own preferences (USING + WITH CHECK).
--  * All mutations of views/proposals/credits/OAuth state go through the
--    server broker (service role) which applies explicit subject/tenant/app/
--    surface filters, and through the SECURITY INVOKER transactional functions
--    below whose EXECUTE privilege is revoked from anon/authenticated.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tenancy
create table public.tenants (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null
);

create table public.apps (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  agent_access_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id text not null references public.tenants(id),
  subject_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null references public.apps(id),
  role text not null check (role in ('member', 'operator')),
  role_version integer not null default 1,
  data_access boolean not null default true,
  status text not null default 'active' check (status in ('active', 'suspended')),
  display_name text not null,
  primary key (tenant_id, subject_id, app_id)
);
create index memberships_subject_idx on public.memberships(subject_id);

create table public.surface_manifests (
  app_id text not null references public.apps(id),
  surface_id text not null,
  manifest_version text not null,
  policy_version text not null,
  manifest_hash text not null,
  manifest jsonb not null,
  deployed_at timestamptz not null default now(),
  primary key (app_id, surface_id, manifest_version, policy_version)
);

-- --------------------------------------------------------- user state
create table public.user_preferences (
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  surface_id text not null,
  expertise text check (expertise in ('beginner', 'expert')),
  density text check (density in ('comfortable', 'compact')),
  help text not null default 'auto' check (help in ('auto', 'show', 'hide')),
  pins jsonb not null default '[]'::jsonb check (jsonb_typeof(pins) = 'array' and jsonb_array_length(pins) <= 12),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, app_id, subject_id, surface_id),
  foreign key (tenant_id, subject_id, app_id) references public.memberships(tenant_id, subject_id, app_id) on delete cascade
);

create table public.user_views (
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  surface_id text not null,
  revision integer not null check (revision >= 0),
  parent_revision integer,
  manifest_version text not null,
  policy_version text not null,
  config jsonb not null,
  config_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, app_id, subject_id, surface_id),
  foreign key (tenant_id, subject_id, app_id) references public.memberships(tenant_id, subject_id, app_id) on delete cascade
);

create table public.view_history (
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  surface_id text not null,
  revision integer not null,
  parent_revision integer,
  source text not null check (source in ('default', 'proposal', 'undo', 'reset')),
  proposal_id uuid,
  manifest_version text not null,
  policy_version text not null,
  config jsonb not null,
  config_hash text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, app_id, subject_id, surface_id, revision)
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  surface_id text not null,
  client_id text not null,
  base_revision integer not null,
  manifest_version text not null,
  policy_version text not null,
  role_version integer not null,
  config jsonb not null,
  config_hash text not null,
  candidate_id text not null,
  status text not null check (status in ('READY', 'APPLIED', 'REJECTED', 'EXPIRED', 'STALE', 'INVALID')),
  status_reason text,
  task text not null,
  expertise text not null,
  preferences jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  rationale text not null default '',
  decision_id uuid not null,
  job_id uuid not null unique,
  request_id text not null check (length(request_id) between 8 and 128),
  request_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_revision integer,
  unique (tenant_id, app_id, subject_id, surface_id, request_id)
);
create index proposals_owner_idx on public.proposals(tenant_id, app_id, subject_id, surface_id, created_at desc);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.proposals(id),
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null,
  surface_id text not null,
  config_hash text not null,
  base_revision integer not null,
  proposal_expires_at timestamptz not null,
  approved_at timestamptz not null default now(),
  idempotency_key text not null,
  channel text not null check (channel = 'host')
);

create table public.idempotency_keys (
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null,
  surface_id text not null,
  operation text not null,
  key text not null check (length(key) between 8 and 128),
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, app_id, subject_id, surface_id, operation, key)
);

-- ------------------------------------------------------- observability
create table public.decision_events (
  id uuid primary key,
  job_id uuid not null,
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  surface_id text not null,
  client_id text not null,
  channel text not null,
  manifest_version text not null,
  policy_version text not null,
  model_version text,
  candidate_ids text[] not null default '{}',
  candidate_hashes jsonb not null default '{}'::jsonb,
  selected_id text,
  distribution jsonb,
  confidence double precision,
  confidence_floor double precision,
  inputs jsonb not null,
  assumptions jsonb not null default '[]'::jsonb,
  validation text not null,
  validation_rules jsonb not null default '[]'::jsonb,
  outcome text not null,
  outcome_reason text,
  provider_status text not null,
  provider_latency_ms integer,
  total_latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  provider_cost numeric(12, 8),
  currency text,
  rationale text,
  proposal_id uuid,
  created_at timestamptz not null default now()
);
create index decision_events_owner_idx on public.decision_events(tenant_id, app_id, subject_id, created_at desc);
create index decision_events_app_idx on public.decision_events(tenant_id, app_id, created_at desc);

create table public.usage_events (
  job_id uuid primary key,
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  model_version text,
  provider_usage jsonb not null default '{}'::jsonb,
  provider_cost numeric(12, 8),
  currency text,
  status text not null,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  app_id text not null,
  subject_id uuid,
  surface_id text,
  kind text not null,
  ref text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_app_idx on public.audit_events(tenant_id, app_id, created_at desc);

-- --------------------------------------------------------------- billing
create table public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'granted', 'canceled', 'rejected')),
  credits integer not null default 1 check (credits = 1),
  amount integer not null,
  currency text not null,
  price_id text not null,
  stripe_session_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  granted_at timestamptz,
  foreign key (tenant_id, subject_id, app_id) references public.memberships(tenant_id, subject_id, app_id) on delete cascade
);

create table public.stripe_events (
  event_id text primary key,
  type text not null,
  livemode boolean not null,
  order_id uuid,
  result text not null,
  received_at timestamptz not null default now()
);

create table public.credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null unique references public.billing_orders(id),
  status text not null default 'available' check (status in ('available', 'reserved', 'consumed')),
  job_id uuid unique,
  reserved_at timestamptz,
  consumed_at timestamptz,
  proposal_id uuid,
  created_at timestamptz not null default now()
);
create index credits_owner_idx on public.credits(tenant_id, app_id, subject_id, status);

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  credit_id uuid not null references public.credits(id),
  tenant_id text not null,
  app_id text not null,
  subject_id uuid not null,
  kind text not null check (kind in ('grant', 'reserve', 'consume', 'release')),
  job_id uuid,
  order_id uuid,
  stripe_event_id text,
  created_at timestamptz not null default now()
);
create unique index credit_ledger_consume_once on public.credit_ledger(credit_id) where kind = 'consume';
create unique index credit_ledger_grant_once on public.credit_ledger(credit_id) where kind = 'grant';

-- ------------------------------------------------------------ OAuth / MCP
create table public.oauth_clients (
  client_id text primary key check (length(client_id) between 8 and 512),
  kind text not null check (kind in ('dcr', 'cimd', 'preregistered')),
  client_name text not null,
  redirect_uris text[] not null check (array_length(redirect_uris, 1) between 1 and 10),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  subject_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  app_id text not null,
  scopes text[] not null,
  surfaces text[] not null,
  resource text not null,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references auth.users(id) on delete cascade,
  tenant_id text not null,
  app_id text not null,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  scopes text[] not null,
  surfaces text[] not null,
  grant_revision integer not null default 1,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, tenant_id, app_id, client_id)
);

create table public.oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references public.oauth_grants(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  resource text not null,
  scopes text[] not null,
  grant_revision integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by text,
  created_at timestamptz not null default now()
);
create index oauth_tokens_grant_idx on public.oauth_tokens(grant_id);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

-- ------------------------------------------------- synthetic business data
create table public.demo_revenue_daily (
  tenant_id text not null references public.tenants(id),
  day date not null,
  net_amount numeric(12, 2) not null,
  currency text not null,
  primary key (tenant_id, day)
);

create table public.demo_metrics (
  tenant_id text not null references public.tenants(id),
  metric_id text not null,
  label text not null,
  definition text not null,
  value numeric not null,
  previous_value numeric not null,
  unit text not null,
  metric_set text not null check (metric_set in ('core', 'extended')),
  primary key (tenant_id, metric_id)
);

create table public.demo_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id),
  assignee_id uuid references auth.users(id) on delete set null,
  title text not null,
  context text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'done')),
  restricted boolean not null default false
);

create table public.demo_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id),
  actor text not null,
  description text not null,
  occurred_at timestamptz not null
);

create table public.demo_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id),
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null,
  detail text not null,
  raised_at timestamptz not null,
  acknowledged boolean not null default false
);

-- -------------------------------------------------------------------- RLS
alter table public.tenants enable row level security;
alter table public.apps enable row level security;
alter table public.memberships enable row level security;
alter table public.surface_manifests enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_views enable row level security;
alter table public.view_history enable row level security;
alter table public.proposals enable row level security;
alter table public.approvals enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.decision_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.billing_orders enable row level security;
alter table public.stripe_events enable row level security;
alter table public.credits enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.rate_limits enable row level security;
alter table public.demo_revenue_daily enable row level security;
alter table public.demo_metrics enable row level security;
alter table public.demo_tasks enable row level security;
alter table public.demo_activity enable row level security;
alter table public.demo_alerts enable row level security;

-- Membership helper. SECURITY DEFINER so policies can consult memberships
-- without granting users broad read access; fixed search_path; only answers
-- for the calling user (auth.uid()).
create or replace function public.contour_is_member(p_tenant text, p_app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.app_id = p_app
      and m.subject_id = (select auth.uid()) and m.status = 'active'
  );
$$;
revoke all on function public.contour_is_member(text, text) from public, anon;
grant execute on function public.contour_is_member(text, text) to authenticated;

create policy memberships_self_read on public.memberships
  for select to authenticated using (subject_id = (select auth.uid()));

create policy prefs_owner_read on public.user_preferences
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));
create policy prefs_owner_update on public.user_preferences
  for update to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id))
  with check (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));

create policy views_owner_read on public.user_views
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));
create policy history_owner_read on public.view_history
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));
create policy proposals_owner_read on public.proposals
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));
create policy decisions_owner_read on public.decision_events
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));
create policy credits_owner_read on public.credits
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));
create policy orders_owner_read on public.billing_orders
  for select to authenticated
  using (subject_id = (select auth.uid()) and public.contour_is_member(tenant_id, app_id));

-- Least-privilege grants: authenticated users get SELECT on owner-scoped
-- tables (RLS still applies) and UPDATE on preferences only. Everything else
-- is service-role only.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.memberships, public.user_preferences, public.user_views, public.view_history,
  public.proposals, public.decision_events, public.credits, public.billing_orders to authenticated;
grant update (expertise, density, help, pins, updated_at) on public.user_preferences to authenticated;

-- ===================================================== transactional RPCs
-- All functions below are SECURITY INVOKER and executable only by the
-- service role. They return jsonb {ok, code, ...} rather than raising for
-- business outcomes so that status transitions (e.g. STALE) persist.

-- Reserve one available credit for an adaptation job. Releases stale
-- reservations (older than 10 minutes, no proposal) first.
create or replace function public.contour_reserve_credit(
  p_tenant text, p_app text, p_subject uuid, p_job uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_credit public.credits;
begin
  with stale as (
    update public.credits c set status = 'available', job_id = null, reserved_at = null
    where c.tenant_id = p_tenant and c.app_id = p_app and c.subject_id = p_subject
      and c.status = 'reserved' and c.reserved_at < now() - interval '10 minutes'
    returning c.*
  )
  insert into public.credit_ledger(credit_id, tenant_id, app_id, subject_id, kind, job_id)
  select s.id, s.tenant_id, s.app_id, s.subject_id, 'release', null from stale s;

  -- Idempotent: an existing reservation for this job is returned as-is.
  select * into v_credit from public.credits where job_id = p_job;
  if found then
    return jsonb_build_object('ok', true, 'creditId', v_credit.id, 'status', v_credit.status);
  end if;

  select * into v_credit from public.credits c
  where c.tenant_id = p_tenant and c.app_id = p_app and c.subject_id = p_subject and c.status = 'available'
  order by c.created_at
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_REQUIRED');
  end if;

  update public.credits set status = 'reserved', job_id = p_job, reserved_at = now() where id = v_credit.id;
  insert into public.credit_ledger(credit_id, tenant_id, app_id, subject_id, kind, job_id)
  values (v_credit.id, p_tenant, p_app, p_subject, 'reserve', p_job);
  return jsonb_build_object('ok', true, 'creditId', v_credit.id, 'status', 'reserved');
end;
$$;

create or replace function public.contour_release_credit(p_job uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_credit public.credits;
begin
  select * into v_credit from public.credits where job_id = p_job for update;
  if not found or v_credit.status <> 'reserved' then
    return jsonb_build_object('ok', true, 'released', false);
  end if;
  update public.credits set status = 'available', job_id = null, reserved_at = null where id = v_credit.id;
  insert into public.credit_ledger(credit_id, tenant_id, app_id, subject_id, kind, job_id)
  values (v_credit.id, v_credit.tenant_id, v_credit.app_id, v_credit.subject_id, 'release', p_job);
  return jsonb_build_object('ok', true, 'released', true);
end;
$$;

-- Persist a READY proposal and consume the job's reserved credit in one
-- transaction. Idempotent per (owner, request_id): identical payload returns
-- the existing proposal, a different payload is rejected.
create or replace function public.contour_create_proposal(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_existing public.proposals;
  v_credit public.credits;
  v_id uuid;
  v_job uuid := (p->>'job_id')::uuid;
  v_subject uuid := (p->>'subject_id')::uuid;
begin
  select * into v_existing from public.proposals
  where tenant_id = p->>'tenant_id' and app_id = p->>'app_id' and subject_id = v_subject
    and surface_id = p->>'surface_id' and request_id = p->>'request_id';
  if found then
    if v_existing.request_hash = p->>'request_hash' then
      return jsonb_build_object('ok', true, 'replayed', true, 'proposalId', v_existing.id, 'jobId', v_existing.job_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  select * into v_credit from public.credits where job_id = v_job for update;
  if not found or v_credit.status <> 'reserved'
     or v_credit.subject_id <> v_subject or v_credit.tenant_id <> p->>'tenant_id' or v_credit.app_id <> p->>'app_id' then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_REQUIRED');
  end if;

  insert into public.proposals(
    tenant_id, app_id, subject_id, surface_id, client_id, base_revision, manifest_version, policy_version,
    role_version, config, config_hash, candidate_id, status, task, expertise, preferences, changes, rationale,
    decision_id, job_id, request_id, request_hash, expires_at
  ) values (
    p->>'tenant_id', p->>'app_id', v_subject, p->>'surface_id', p->>'client_id', (p->>'base_revision')::int,
    p->>'manifest_version', p->>'policy_version', (p->>'role_version')::int, p->'config', p->>'config_hash',
    p->>'candidate_id', 'READY', p->>'task', p->>'expertise', coalesce(p->'preferences', '{}'::jsonb),
    coalesce(p->'changes', '[]'::jsonb), coalesce(p->>'rationale', ''), (p->>'decision_id')::uuid, v_job,
    p->>'request_id', p->>'request_hash', (p->>'expires_at')::timestamptz
  ) returning id into v_id;

  update public.credits set status = 'consumed', consumed_at = now(), proposal_id = v_id where id = v_credit.id;
  insert into public.credit_ledger(credit_id, tenant_id, app_id, subject_id, kind, job_id)
  values (v_credit.id, v_credit.tenant_id, v_credit.app_id, v_credit.subject_id, 'consume', v_job);

  insert into public.audit_events(tenant_id, app_id, subject_id, surface_id, kind, ref, detail)
  values (p->>'tenant_id', p->>'app_id', v_subject, p->>'surface_id', 'proposal_created', v_id::text,
          jsonb_build_object('jobId', v_job, 'clientId', p->>'client_id', 'candidateId', p->>'candidate_id'));
  return jsonb_build_object('ok', true, 'replayed', false, 'proposalId', v_id, 'jobId', v_job, 'creditId', v_credit.id);
end;
$$;

-- Internal: lock (creating if needed) the owner's active view row.
create or replace function public.contour_lock_view(
  p_tenant text, p_app text, p_subject uuid, p_surface text,
  p_default_config jsonb, p_default_hash text, p_manifest_version text, p_policy_version text
) returns public.user_views
language plpgsql
set search_path = ''
as $$
declare
  v_view public.user_views;
begin
  insert into public.user_views(tenant_id, app_id, subject_id, surface_id, revision, parent_revision,
    manifest_version, policy_version, config, config_hash)
  values (p_tenant, p_app, p_subject, p_surface, 0, null, p_manifest_version, p_policy_version, p_default_config, p_default_hash)
  on conflict do nothing;
  insert into public.view_history(tenant_id, app_id, subject_id, surface_id, revision, parent_revision, source,
    manifest_version, policy_version, config, config_hash)
  values (p_tenant, p_app, p_subject, p_surface, 0, null, 'default', p_manifest_version, p_policy_version, p_default_config, p_default_hash)
  on conflict do nothing;
  select * into v_view from public.user_views
  where tenant_id = p_tenant and app_id = p_app and subject_id = p_subject and surface_id = p_surface
  for update;
  return v_view;
end;
$$;

-- Approve + apply a stored proposal atomically (host-only MVP flow).
create or replace function public.contour_apply_proposal(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant text := p->>'tenant_id';
  v_app text := p->>'app_id';
  v_subject uuid := (p->>'subject_id')::uuid;
  v_surface text := p->>'surface_id';
  v_key text := p->>'idempotency_key';
  v_req_hash text := p->>'request_hash';
  v_idem public.idempotency_keys;
  v_prop public.proposals;
  v_member public.memberships;
  v_view public.user_views;
  v_new_rev integer;
  v_result jsonb;
begin
  select * into v_idem from public.idempotency_keys
  where tenant_id = v_tenant and app_id = v_app and subject_id = v_subject and surface_id = v_surface
    and operation = 'apply' and key = v_key;
  if found then
    if v_idem.request_hash = v_req_hash then
      return v_idem.response || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  select * into v_prop from public.proposals where id = (p->>'proposal_id')::uuid for update;
  -- Wrong owner is indistinguishable from not found.
  if not found or v_prop.tenant_id <> v_tenant or v_prop.app_id <> v_app
     or v_prop.subject_id <> v_subject or v_prop.surface_id <> v_surface then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_prop.status <> 'READY' then
    return jsonb_build_object('ok', false, 'code', 'PROPOSAL_NOT_READY', 'status', v_prop.status);
  end if;
  if v_prop.expires_at <= now() then
    update public.proposals set status = 'EXPIRED', status_reason = 'expired before approval' where id = v_prop.id;
    return jsonb_build_object('ok', false, 'code', 'EXPIRED_PROPOSAL');
  end if;
  if v_prop.config_hash <> p->>'config_hash' then
    return jsonb_build_object('ok', false, 'code', 'HASH_MISMATCH');
  end if;

  select * into v_member from public.memberships
  where tenant_id = v_tenant and app_id = v_app and subject_id = v_subject;
  if not found or v_member.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if v_prop.manifest_version <> p->>'manifest_version' or v_prop.policy_version <> p->>'policy_version'
     or v_prop.role_version <> v_member.role_version then
    update public.proposals set status = 'INVALID', status_reason = 'manifest, policy or role changed' where id = v_prop.id;
    return jsonb_build_object('ok', false, 'code', 'INCOMPATIBLE_MANIFEST');
  end if;

  v_view := public.contour_lock_view(v_tenant, v_app, v_subject, v_surface, p->'default_config', p->>'default_hash',
                                     p->>'manifest_version', p->>'policy_version');
  if v_view.revision <> v_prop.base_revision then
    update public.proposals set status = 'STALE', status_reason = 'base revision changed' where id = v_prop.id;
    return jsonb_build_object('ok', false, 'code', 'STALE_REVISION', 'currentRevision', v_view.revision);
  end if;

  v_new_rev := v_view.revision + 1;
  update public.user_views set revision = v_new_rev, parent_revision = v_view.revision, config = v_prop.config,
    config_hash = v_prop.config_hash, manifest_version = v_prop.manifest_version, policy_version = v_prop.policy_version,
    updated_at = now()
  where tenant_id = v_tenant and app_id = v_app and subject_id = v_subject and surface_id = v_surface;
  insert into public.view_history(tenant_id, app_id, subject_id, surface_id, revision, parent_revision, source,
    proposal_id, manifest_version, policy_version, config, config_hash)
  values (v_tenant, v_app, v_subject, v_surface, v_new_rev, v_view.revision, 'proposal', v_prop.id,
    v_prop.manifest_version, v_prop.policy_version, v_prop.config, v_prop.config_hash);
  insert into public.approvals(proposal_id, tenant_id, app_id, subject_id, surface_id, config_hash, base_revision,
    proposal_expires_at, idempotency_key, channel)
  values (v_prop.id, v_tenant, v_app, v_subject, v_surface, v_prop.config_hash, v_prop.base_revision,
    v_prop.expires_at, v_key, 'host');
  update public.proposals set status = 'APPLIED', applied_at = now(), applied_revision = v_new_rev where id = v_prop.id;
  insert into public.audit_events(tenant_id, app_id, subject_id, surface_id, kind, ref, detail)
  values (v_tenant, v_app, v_subject, v_surface, 'view_committed', v_prop.id::text,
    jsonb_build_object('revision', v_new_rev, 'jobId', v_prop.job_id, 'configHash', v_prop.config_hash));

  delete from public.view_history h
  where h.tenant_id = v_tenant and h.app_id = v_app and h.subject_id = v_subject and h.surface_id = v_surface
    and h.revision <= v_new_rev - coalesce((p->>'history_limit')::int, 20);

  v_result := jsonb_build_object('ok', true, 'revision', v_new_rev, 'proposalId', v_prop.id, 'configHash', v_prop.config_hash);
  insert into public.idempotency_keys(tenant_id, app_id, subject_id, surface_id, operation, key, request_hash, response)
  values (v_tenant, v_app, v_subject, v_surface, 'apply', v_key, v_req_hash, v_result);
  return v_result;
end;
$$;

-- Commit a server-computed snapshot (undo/reset) with compare-and-swap.
create or replace function public.contour_commit_snapshot(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant text := p->>'tenant_id';
  v_app text := p->>'app_id';
  v_subject uuid := (p->>'subject_id')::uuid;
  v_surface text := p->>'surface_id';
  v_op text := p->>'operation';
  v_key text := p->>'idempotency_key';
  v_req_hash text := p->>'request_hash';
  v_idem public.idempotency_keys;
  v_member public.memberships;
  v_view public.user_views;
  v_new_rev integer;
  v_result jsonb;
begin
  if v_op not in ('undo', 'reset') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  select * into v_idem from public.idempotency_keys
  where tenant_id = v_tenant and app_id = v_app and subject_id = v_subject and surface_id = v_surface
    and operation = v_op and key = v_key;
  if found then
    if v_idem.request_hash = v_req_hash then
      return v_idem.response || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  select * into v_member from public.memberships
  where tenant_id = v_tenant and app_id = v_app and subject_id = v_subject;
  if not found or v_member.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  v_view := public.contour_lock_view(v_tenant, v_app, v_subject, v_surface, p->'default_config', p->>'default_hash',
                                     p->>'manifest_version', p->>'policy_version');
  if v_view.revision <> (p->>'expected_revision')::int then
    return jsonb_build_object('ok', false, 'code', 'STALE_REVISION', 'currentRevision', v_view.revision);
  end if;

  v_new_rev := v_view.revision + 1;
  update public.user_views set revision = v_new_rev, parent_revision = (p->>'parent_revision')::int,
    config = p->'config', config_hash = p->>'config_hash', manifest_version = p->>'manifest_version',
    policy_version = p->>'policy_version', updated_at = now()
  where tenant_id = v_tenant and app_id = v_app and subject_id = v_subject and surface_id = v_surface;
  insert into public.view_history(tenant_id, app_id, subject_id, surface_id, revision, parent_revision, source,
    manifest_version, policy_version, config, config_hash)
  values (v_tenant, v_app, v_subject, v_surface, v_new_rev, (p->>'parent_revision')::int, v_op,
    p->>'manifest_version', p->>'policy_version', p->'config', p->>'config_hash');
  insert into public.audit_events(tenant_id, app_id, subject_id, surface_id, kind, ref, detail)
  values (v_tenant, v_app, v_subject, v_surface, 'view_' || v_op, v_new_rev::text,
    jsonb_build_object('revision', v_new_rev, 'restoredFrom', p->>'restored_from', 'configHash', p->>'config_hash'));
  delete from public.view_history h
  where h.tenant_id = v_tenant and h.app_id = v_app and h.subject_id = v_subject and h.surface_id = v_surface
    and h.revision <= v_new_rev - coalesce((p->>'history_limit')::int, 20);

  v_result := jsonb_build_object('ok', true, 'revision', v_new_rev, 'configHash', p->>'config_hash');
  insert into public.idempotency_keys(tenant_id, app_id, subject_id, surface_id, operation, key, request_hash, response)
  values (v_tenant, v_app, v_subject, v_surface, v_op, v_key, v_req_hash, v_result);
  return v_result;
end;
$$;

-- Grant exactly one credit for a verified, paid Checkout Session. Dedupes
-- Stripe event IDs and the order/session grant.
create or replace function public.contour_grant_credit(p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.billing_orders;
  v_credit_id uuid;
  v_inserted integer;
begin
  insert into public.stripe_events(event_id, type, livemode, order_id, result)
  values (p->>'event_id', p->>'event_type', (p->>'livemode')::boolean, (p->>'order_id')::uuid, 'processing')
  on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'result', 'duplicate_event');
  end if;

  select * into v_order from public.billing_orders where id = (p->>'order_id')::uuid for update;
  if not found then
    update public.stripe_events set result = 'unknown_order' where event_id = p->>'event_id';
    return jsonb_build_object('ok', false, 'result', 'unknown_order');
  end if;
  if v_order.stripe_session_id is distinct from p->>'session_id'
     or v_order.tenant_id <> p->>'tenant_id' or v_order.subject_id::text <> p->>'subject_id' or v_order.app_id <> p->>'app_id'
     or v_order.amount <> (p->>'amount')::int or v_order.currency <> p->>'currency' then
    update public.stripe_events set result = 'order_mismatch' where event_id = p->>'event_id';
    return jsonb_build_object('ok', false, 'result', 'order_mismatch');
  end if;
  if v_order.status = 'granted' then
    update public.stripe_events set result = 'already_granted' where event_id = p->>'event_id';
    return jsonb_build_object('ok', true, 'result', 'already_granted');
  end if;
  if v_order.status <> 'pending' then
    update public.stripe_events set result = 'order_not_pending' where event_id = p->>'event_id';
    return jsonb_build_object('ok', false, 'result', 'order_not_pending');
  end if;

  insert into public.credits(tenant_id, app_id, subject_id, order_id)
  values (v_order.tenant_id, v_order.app_id, v_order.subject_id, v_order.id)
  returning id into v_credit_id;
  insert into public.credit_ledger(credit_id, tenant_id, app_id, subject_id, kind, order_id, stripe_event_id)
  values (v_credit_id, v_order.tenant_id, v_order.app_id, v_order.subject_id, 'grant', v_order.id, p->>'event_id');
  update public.billing_orders set status = 'granted', granted_at = now(), stripe_payment_intent = p->>'payment_intent'
  where id = v_order.id;
  update public.stripe_events set result = 'granted' where event_id = p->>'event_id';
  insert into public.audit_events(tenant_id, app_id, subject_id, kind, ref, detail)
  values (v_order.tenant_id, v_order.app_id, v_order.subject_id, 'credit_granted', v_order.id::text,
    jsonb_build_object('creditId', v_credit_id, 'eventId', p->>'event_id'));
  return jsonb_build_object('ok', true, 'result', 'granted', 'creditId', v_credit_id);
end;
$$;

-- Fixed-window rate limiter.
create or replace function public.contour_rate_limit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits(bucket, window_start, count) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

-- Atomically redeem an OAuth authorization code (single use).
create or replace function public.contour_redeem_code(p_code_hash text) returns public.oauth_codes
language plpgsql
set search_path = ''
as $$
declare
  v_code public.oauth_codes;
begin
  update public.oauth_codes set used_at = now()
  where code_hash = p_code_hash and used_at is null and expires_at > now()
  returning * into v_code;
  return v_code;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'contour_reserve_credit(text,text,uuid,uuid)', 'contour_release_credit(uuid)', 'contour_create_proposal(jsonb)',
    'contour_lock_view(text,text,uuid,text,jsonb,text,text,text)', 'contour_apply_proposal(jsonb)',
    'contour_commit_snapshot(jsonb)', 'contour_grant_credit(jsonb)', 'contour_rate_limit(text,integer,integer)',
    'contour_redeem_code(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
