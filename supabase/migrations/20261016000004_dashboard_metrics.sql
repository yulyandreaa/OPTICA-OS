-- =============================================================================
-- Dashboard metrics. SECURITY INVOKER: every count runs under the caller's RLS,
-- so a branch-scoped user only ever aggregates what they can already see.
-- All "day" boundaries are computed in the tenant timezone.
-- =============================================================================

create or replace function public.dashboard_metrics(p_tenant uuid, p_branch uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with tz as (select timezone as name from public.tenants where id = p_tenant),
  bounds as (
    select
      (date_trunc('day', now() at time zone tz.name)) at time zone tz.name                         as today_start,
      (date_trunc('day', now() at time zone tz.name) + interval '1 day') at time zone tz.name      as tomorrow_start,
      (date_trunc('day', now() at time zone tz.name) + interval '2 day') at time zone tz.name      as after_tomorrow,
      (date_trunc('month', now() at time zone tz.name)) at time zone tz.name                       as month_start,
      (date_trunc('month', now() at time zone tz.name) - interval '1 month') at time zone tz.name   as prev_month_start,
      -- same elapsed span of the previous month, for fair month-to-date comparisons
      (now() - interval '1 month')                                                                  as prev_month_cut
    from tz
  ),
  appts as (
    select a.* from public.appointments a
    where a.tenant_id = p_tenant and (p_branch is null or a.branch_id = p_branch)
      and a.starts_at >= (select prev_month_start from bounds) - interval '31 days'
  )
  select jsonb_build_object(
    'appointments_today',   (select count(*) from appts, bounds where starts_at >= today_start and starts_at < tomorrow_start and status not in ('cancelled','no_show')),
    'completed_today',      (select count(*) from appts, bounds where starts_at >= today_start and starts_at < tomorrow_start and status = 'completed'),
    'waiting_now',          (select count(*) from appts, bounds where starts_at >= today_start and starts_at < tomorrow_start and status in ('checked_in','waiting')),
    'in_consultation_now',  (select count(*) from appts, bounds where starts_at >= today_start and starts_at < tomorrow_start and status = 'in_consultation'),
    'unconfirmed_tomorrow', (select count(*) from appts, bounds where starts_at >= tomorrow_start and starts_at < after_tomorrow and status = 'scheduled'),
    'consultations_month',      (select count(*) from appts, bounds where starts_at >= month_start and status = 'completed'),
    'consultations_prev_month', (select count(*) from appts, bounds where starts_at >= prev_month_start and starts_at < prev_month_cut and status = 'completed'),
    'no_show_30d',      (select count(*) from appts where starts_at >= now() - interval '30 days' and starts_at < now() and status = 'no_show'),
    'finished_30d',     (select count(*) from appts where starts_at >= now() - interval '30 days' and starts_at < now() and status in ('completed','no_show')),
    'cancelled_30d',    (select count(*) from appts where starts_at >= now() - interval '30 days' and starts_at < now() and status = 'cancelled'),
    'cancelled_prev_30d', (select count(*) from appts where starts_at >= now() - interval '60 days' and starts_at < now() - interval '30 days' and status = 'cancelled'),
    'new_patients_month',      (select count(*) from public.patients p, bounds where p.tenant_id = p_tenant and p.deleted_at is null and p.created_at >= month_start),
    'new_patients_prev_month', (select count(*) from public.patients p, bounds where p.tenant_id = p_tenant and p.deleted_at is null and p.created_at >= prev_month_start and p.created_at < prev_month_cut),
    'patients_total',          (select count(*) from public.patients p where p.tenant_id = p_tenant and p.deleted_at is null),
    'online_bookings_month',   (select count(*) from appts, bounds where created_at >= month_start and source = 'online')
  )
$$;

-- Patients due for a visual control: last attended visit 12–36 months ago and nothing booked ahead.
create or replace function public.recall_opportunities(p_tenant uuid, p_limit int default 6)
returns table (patient_id uuid, full_name text, phone text, last_visit timestamptz, months_since int)
language sql stable security invoker set search_path = '' as $$
  with last_visits as (
    select a.patient_id, max(a.starts_at) as last_visit
    from public.appointments a
    where a.tenant_id = p_tenant and a.status = 'completed'
    group by a.patient_id
  )
  select p.id, p.full_name, coalesce(p.whatsapp, p.phone), lv.last_visit,
         (extract(year from age(now(), lv.last_visit)) * 12 + extract(month from age(now(), lv.last_visit)))::int
  from last_visits lv
  join public.patients p on p.id = lv.patient_id and p.tenant_id = p_tenant and p.deleted_at is null
  where lv.last_visit < now() - interval '12 months'
    and lv.last_visit > now() - interval '36 months'
    and not exists (
      select 1 from public.appointments f
      where f.tenant_id = p_tenant and f.patient_id = p.id and f.starts_at > now() and f.status not in ('cancelled','no_show'))
  order by lv.last_visit asc
  limit greatest(1, least(p_limit, 50))
$$;

create or replace function public.recall_opportunities_count(p_tenant uuid)
returns int language sql stable security invoker set search_path = '' as $$
  select count(*)::int from (
    select a.patient_id
    from public.appointments a
    where a.tenant_id = p_tenant and a.status = 'completed'
    group by a.patient_id
    having max(a.starts_at) < now() - interval '12 months' and max(a.starts_at) > now() - interval '36 months'
  ) due
  where not exists (
    select 1 from public.appointments f
    where f.tenant_id = p_tenant and f.patient_id = due.patient_id and f.starts_at > now() and f.status not in ('cancelled','no_show'))
$$;

revoke all on function public.dashboard_metrics(uuid, uuid), public.recall_opportunities(uuid, int), public.recall_opportunities_count(uuid) from public, anon;
grant execute on function public.dashboard_metrics(uuid, uuid), public.recall_opportunities(uuid, int), public.recall_opportunities_count(uuid) to authenticated;
