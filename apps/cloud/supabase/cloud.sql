-- Cloud registry and encrypted project grants only. Cloud's consumer OAuth
-- authorization server tables are supplied separately by the SDK task.
begin;

create schema if not exists cloud;
create table if not exists cloud.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null,
  company text not null,
  description text not null default '',
  base_url text not null,
  mcp_resource text,
  as_issuer text,
  token_endpoint text,
  authorization_endpoint text,
  revocation_endpoint text,
  surfaces text[] not null default '{}',
  verify_nonce text not null,
  verified_at timestamptz,
  status text not null default 'pending' check (status in ('pending','verified','disabled')),
  created_at timestamptz not null default now()
);
-- Idempotent for databases where the brief's registry was already created.
alter table cloud.projects add column if not exists token_endpoint text;
alter table cloud.projects add column if not exists authorization_endpoint text;
alter table cloud.projects add column if not exists revocation_endpoint text;
alter table cloud.projects add column if not exists registration_endpoint text;
alter table cloud.projects add column if not exists dcr_client_id text;

create table if not exists cloud.links (
  contour_user uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references cloud.projects(id) on delete cascade,
  status text not null check (status in ('active','needs_reconnect','revoked')),
  scopes text[] not null,
  refresh_ct text not null,
  access_ct text,
  access_expires_at timestamptz,
  key_id text not null,
  subject_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contour_user, project_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'cloud.links'::regclass and conname = 'links_scopes_check'
  ) then
    alter table cloud.links add constraint links_scopes_check
      check (scopes <@ array['view:read','data:read','view:propose']::text[]);
  end if;
end;
$$;

create table if not exists cloud.link_states (
  state_hash text primary key,
  contour_user uuid not null,
  project_id uuid not null,
  verifier_ct text not null,
  key_id text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
-- Browser linking is bound to the exact Supabase Auth session, including
-- when the same consumer signs out and signs back in during the redirect.
alter table cloud.link_states add column if not exists session_id text;

create table if not exists cloud.audit_events (
  id bigint generated always as identity primary key,
  contour_user uuid,
  project_id uuid,
  kind text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
-- Consumer activity and SDK authorization-server audit records share this table.
alter table cloud.audit_events add column if not exists tenant_id text;
alter table cloud.audit_events add column if not exists app_id text;
alter table cloud.audit_events add column if not exists subject_id uuid;
alter table cloud.audit_events add column if not exists surface_id text;
alter table cloud.audit_events add column if not exists ref text;

alter table cloud.projects enable row level security;
alter table cloud.links enable row level security;
alter table cloud.link_states enable row level security;
alter table cloud.audit_events enable row level security;
revoke all on all tables in schema cloud from public, anon, authenticated;
grant usage on schema cloud to service_role;
grant all on cloud.projects, cloud.links, cloud.link_states, cloud.audit_events to service_role;
grant usage, select on sequence cloud.audit_events_id_seq to service_role;

-- UPDATE locks the candidate row and rechecks used_at after a concurrent claim.
-- Expiration uses the database clock, never a timestamp supplied by the caller.
create or replace function cloud.consume_link_state(p_state_hash text, p_contour_user uuid)
returns table (project_id uuid, verifier_ct text, key_id text)
language sql
security invoker
set search_path = ''
as $$
  update cloud.link_states as states
  set used_at = now()
  where states.state_hash = p_state_hash
    and states.contour_user = p_contour_user
    and states.session_id is null
    and states.used_at is null
    and states.expires_at > now()
  returning states.project_id, states.verifier_ct, states.key_id;
$$;
create or replace function cloud.consume_session_link_state(p_state_hash text, p_contour_user uuid, p_session_id text)
returns table (project_id uuid, verifier_ct text, key_id text)
language sql
security invoker
set search_path = ''
as $$
  update cloud.link_states as states
  set used_at = now()
  where states.state_hash = p_state_hash
    and states.contour_user = p_contour_user
    and states.session_id = p_session_id
    and p_session_id <> ''
    and states.used_at is null
    and states.expires_at > now()
  returning states.project_id, states.verifier_ct, states.key_id;
$$;
revoke all on all functions in schema cloud from public, anon, authenticated;
grant execute on function cloud.consume_link_state(text, uuid) to service_role;
grant execute on function cloud.consume_session_link_state(text, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
