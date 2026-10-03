-- Retention and reconciliation job (proposed pilot policy, spec §11):
-- expire unaccepted proposals after their TTL, keep decision/usage metadata
-- 30 days, and release stale credit reservations without a proposal.
create or replace function public.contour_retention() returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_expired integer;
  v_decisions integer;
  v_usage integer;
  v_released integer;
  v_rate integer;
begin
  update public.proposals set status = 'EXPIRED', status_reason = 'ttl elapsed'
  where status = 'READY' and expires_at <= now();
  get diagnostics v_expired = row_count;

  delete from public.decision_events where created_at < now() - interval '30 days';
  get diagnostics v_decisions = row_count;
  delete from public.usage_events where created_at < now() - interval '30 days';
  get diagnostics v_usage = row_count;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_rate = row_count;

  with stale as (
    update public.credits c set status = 'available', job_id = null, reserved_at = null
    where c.status = 'reserved' and c.reserved_at < now() - interval '10 minutes'
    returning c.*
  ), led as (
    insert into public.credit_ledger(credit_id, tenant_id, app_id, subject_id, kind)
    select s.id, s.tenant_id, s.app_id, s.subject_id, 'release' from stale s
    returning 1
  )
  select count(*) into v_released from led;

  return jsonb_build_object('expiredProposals', v_expired, 'deletedDecisions', v_decisions,
    'deletedUsage', v_usage, 'releasedReservations', v_released, 'prunedRateWindows', v_rate);
end;
$$;
revoke all on function public.contour_retention() from public, anon, authenticated;
grant execute on function public.contour_retention() to service_role;
