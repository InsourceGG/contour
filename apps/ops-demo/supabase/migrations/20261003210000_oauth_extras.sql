-- OAuth extras (additive only).
--  * Bind authorization codes to the grant + grant revision they were issued
--    under, so a code minted before a revoke/re-consent cannot be redeemed.
--  * Defence in depth: OAuth rows can never carry `view:commit` (or any scope
--    outside the agent set), regardless of application code.
--  * Atomic grant upsert that bumps grant_revision on every (re-)consent,
--    invalidating tokens minted under an earlier revision.

alter table public.oauth_codes
  add column if not exists grant_id uuid references public.oauth_grants(id) on delete cascade,
  add column if not exists grant_revision integer;

alter table public.oauth_grants
  add constraint oauth_grants_agent_scopes_only
  check (scopes <@ array['view:read', 'data:read', 'view:propose']::text[]) not valid;
alter table public.oauth_codes
  add constraint oauth_codes_agent_scopes_only
  check (scopes <@ array['view:read', 'data:read', 'view:propose']::text[]) not valid;
alter table public.oauth_tokens
  add constraint oauth_tokens_agent_scopes_only
  check (scopes <@ array['view:read', 'data:read', 'view:propose']::text[]) not valid;

create index if not exists oauth_grants_tenant_app_idx on public.oauth_grants(tenant_id, app_id);
create index if not exists oauth_grants_subject_idx on public.oauth_grants(subject_id, tenant_id, app_id);
create index if not exists oauth_codes_expires_idx on public.oauth_codes(expires_at);

-- (Re-)consent: insert or bump revision, clear revocation, replace scopes.
create or replace function public.contour_upsert_grant(
  p_subject uuid, p_tenant text, p_app text, p_client text, p_scopes text[], p_surfaces text[]
) returns public.oauth_grants
language plpgsql
set search_path = ''
as $$
declare
  v_grant public.oauth_grants;
begin
  insert into public.oauth_grants(subject_id, tenant_id, app_id, client_id, scopes, surfaces)
  values (p_subject, p_tenant, p_app, p_client, p_scopes, p_surfaces)
  on conflict (subject_id, tenant_id, app_id, client_id) do update
    set scopes = excluded.scopes,
        surfaces = excluded.surfaces,
        grant_revision = public.oauth_grants.grant_revision + 1,
        revoked_at = null,
        updated_at = now()
  returning * into v_grant;
  -- Tokens from earlier revisions are dead anyway (revision check); mark them
  -- revoked too so listings and introspection agree.
  update public.oauth_tokens set revoked_at = now()
  where grant_id = v_grant.id and revoked_at is null and grant_revision < v_grant.grant_revision;
  return v_grant;
end;
$$;

revoke all on function public.contour_upsert_grant(uuid, text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.contour_upsert_grant(uuid, text, text, text, text[], text[]) to service_role;
