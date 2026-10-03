-- Security review hardening.
-- 1) Preferences are written only through the broker (validated + CSRF). The
--    owner-scoped RLS UPDATE policy stays as defense in depth, but end users no
--    longer hold the UPDATE privilege needed to bypass broker validation.
revoke update on public.user_preferences from authenticated;

-- 2) Agent access is controlled per tenant + app by that tenant's operators.
--    apps.agent_access_enabled remains a company-wide master switch; agent
--    access requires both to be true.
create table if not exists public.tenant_app_settings (
  tenant_id text not null references public.tenants(id),
  app_id text not null references public.apps(id),
  agent_access_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (tenant_id, app_id)
);
alter table public.tenant_app_settings enable row level security;
revoke all on public.tenant_app_settings from anon, authenticated;
insert into public.tenant_app_settings(tenant_id, app_id)
select t.id, a.id from public.tenants t cross join public.apps a
on conflict do nothing;

-- 3) Hygiene: platform helper should not be executable by API roles.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
