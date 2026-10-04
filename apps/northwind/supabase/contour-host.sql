-- Northwind host changes for Contour. Every statement is idempotent.
-- Apply after contour-migrate --schema northwind_contour, from apps/northwind:
--   supabase db query --linked -f supabase/contour-host.sql --workdir ../ops-demo
-- Exact rollback: supabase/contour-host.down.sql
begin;

-- 1. northwind: a role version for live Contour membership checks.
--    Existing users are backfilled to 1 by the default.
alter table northwind.users
  add column if not exists role_version integer not null default 1 check (role_version >= 1);

-- A role or team change bumps the version in the same row write, so open
-- agent proposals and sessions stop matching on their next call. Any other
-- update keeps the stored version, so the counter only moves forward.
create or replace function northwind.bump_role_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.role is distinct from old.role or new.team is distinct from old.team then
    new.role_version := old.role_version + 1;
  else
    new.role_version := old.role_version;
  end if;
  return new;
end;
$$;
revoke all on function northwind.bump_role_version() from public, anon, authenticated;
grant execute on function northwind.bump_role_version() to service_role;
drop trigger if exists bump_role_version on northwind.users;
create trigger bump_role_version
  before update on northwind.users
  for each row execute function northwind.bump_role_version();

-- 2. northwind_contour: the approved agent access setting for the company.
--    Agents enabled; the admin kill switch starts off.
insert into northwind_contour.tenant_app_settings (tenant_id, app_id, agent_access_enabled, updated_by)
values ('northwind', 'northwind', true, 'contour-host.sql')
on conflict (tenant_id, app_id) do nothing;

notify pgrst, 'reload schema';
commit;
