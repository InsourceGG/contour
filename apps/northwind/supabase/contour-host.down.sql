-- Exact rollback of supabase/contour-host.sql, in reverse order. Idempotent.
-- From apps/northwind, before contour-migrate --drop:
--   supabase db query --linked -f supabase/contour-host.down.sql --workdir ../ops-demo
begin;

-- 2. northwind_contour: remove the company's agent access setting row.
do $$
begin
  if to_regclass('northwind_contour.tenant_app_settings') is not null then
    delete from northwind_contour.tenant_app_settings where tenant_id = 'northwind' and app_id = 'northwind';
  end if;
end $$;

-- 1. northwind: remove the trigger, its function, and the column.
drop trigger if exists bump_role_version on northwind.users;
drop function if exists northwind.bump_role_version();
alter table northwind.users drop column if exists role_version;

notify pgrst, 'reload schema';
commit;
