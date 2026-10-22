-- Owner dashboard ("Resumen del negocio"). One call returns KPIs for the period and the comparison
-- period, the sales series, sales by branch and operational alerts. Definitions (docs/dashboard-metrics.md):
--
--   valid sale       status in ('partial','paid'): cancelled and returned sales are excluded entirely
--                    (returns/voids are whole-sale states in this model). Dated by created_at, tenant timezone.
--   net sales        Σ (total − tax_total) of valid sales: after line discounts, before VAT (prices are VAT-inclusive).
--   gross margin     Σ (line_total − tax_amount − unit_cost × quantity) over lines WITH a recorded cost (unit_cost > 0).
--                    cost_coverage = net of costed lines / net of all lines; the UI never extrapolates the rest.
--   collected        Σ payments.amount registered in the period on valid sales (payments are immutable rows,
--                    so nothing is double counted). Not the same as the sales total.
--   receivables      Σ balance of valid sales with balance > 0 as of now (not period-bound).
--   overdue          receivables on sales older than 30 days (no due date exists yet).
--   comparison       deltas are shown only when first_sale_day <= p_prev_from (full history for the previous period).
--
-- security invoker: RLS still scopes every row to the caller's tenant and branches; on top of that the
-- caller must hold reports.financial, so sales reps cannot read the owner's financial KPIs.

alter table public.tenants add column if not exists is_demo boolean not null default false;
comment on column public.tenants.is_demo is 'Seeded demo company: the UI labels its figures as demo data.';

create or replace function public.dashboard_summary(
  p_tenant uuid, p_from date, p_to date, p_prev_from date, p_prev_to date,
  p_branch uuid default null, p_bucket text default 'day'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz text;
  v_today date;
  v_result jsonb;
begin
  if not private.has_permission(p_tenant, 'reports.financial', p_branch) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_bucket not in ('day', 'week', 'month') or p_from > p_to or p_prev_from > p_prev_to then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  select timezone into v_tz from public.tenants where id = p_tenant;
  v_today := (now() at time zone v_tz)::date;

  with s as (
    select sa.id, sa.branch_id, sa.seller_id, sa.patient_id, sa.number, sa.total, sa.tax_total, sa.balance, sa.created_at,
           (sa.created_at at time zone v_tz)::date as day
      from public.sales sa
     where sa.tenant_id = p_tenant and sa.status in ('partial', 'paid')
       and (p_branch is null or sa.branch_id = p_branch)
  ),
  cur as (select * from s where day between p_from and p_to),
  prv as (select * from s where day between p_prev_from and p_prev_to),
  items as (
    select si.line_total - si.tax_amount as net, si.unit_cost * si.quantity as cost, si.unit_cost > 0 as costed, s.day,
           si.variant_id, si.description, si.quantity, coalesce(nullif(si.category, ''), 'Otros') as category
      from public.sale_items si join s on s.id = si.sale_id
     where s.day between p_from and p_to or s.day between p_prev_from and p_prev_to
  ),
  pay as (
    select pa.amount, (pa.created_at at time zone v_tz)::date as day
      from public.payments pa join s on s.id = pa.sale_id
  ),
  voided as (
    select count(*) as n, coalesce(sum(sa.total - sa.tax_total), 0) as net
      from public.sales sa
     where sa.tenant_id = p_tenant and sa.status in ('cancelled', 'returned')
       and (p_branch is null or sa.branch_id = p_branch)
       and (sa.created_at at time zone v_tz)::date between p_from and p_to
  ),
  buckets as (
    select x.b, row_number() over (order by x.b) as idx
      from (select distinct date_trunc(p_bucket, d)::date as b from generate_series(p_from, p_to, interval '1 day') d) x
  ),
  prev_buckets as (
    select x.b, row_number() over (order by x.b) as idx
      from (select distinct date_trunc(p_bucket, d)::date as b from generate_series(p_prev_from, p_prev_to, interval '1 day') d) x
  ),
  stock as (
    select v.id, c.name as category, coalesce(sum(l.quantity), 0) as qty, coalesce(min(l.min_quantity), 1) as min_qty
      from public.product_variants v
      join public.products p on p.id = v.product_id
      join public.product_categories c on c.id = p.category_id
      left join public.inventory_levels l on l.variant_id = v.id and (p_branch is null or l.branch_id = p_branch)
     where v.tenant_id = p_tenant and v.is_active and p.is_active and p.is_stocked
     group by v.id, c.name
  ),
  late as (
    select lo.id, lo.number, v_today - lo.estimated_at as days_late
      from public.lab_orders lo
     where lo.tenant_id = p_tenant and (p_branch is null or lo.branch_id = p_branch)
       and lo.status not in ('received', 'delivered', 'cancelled')
       and lo.estimated_at is not null and lo.estimated_at < v_today
  )
  select jsonb_build_object(
    'current', jsonb_build_object(
      'net_sales', (select coalesce(sum(total - tax_total), 0) from cur),
      'gross_sales', (select coalesce(sum(total), 0) from cur),
      'sales_count', (select count(*) from cur),
      'margin', (select coalesce(sum(net - cost) filter (where costed), 0) from items where day between p_from and p_to),
      'costed_net', (select coalesce(sum(net) filter (where costed), 0) from items where day between p_from and p_to),
      'items_net', (select coalesce(sum(net), 0) from items where day between p_from and p_to),
      'uncosted_lines', (select count(*) filter (where not costed) from items where day between p_from and p_to),
      'collected', (select coalesce(sum(amount), 0) from pay where day between p_from and p_to),
      'payments_count', (select count(*) from pay where day between p_from and p_to),
      'voided_count', (select n from voided),
      'voided_net', (select net from voided)
    ),
    'previous', jsonb_build_object(
      'net_sales', (select coalesce(sum(total - tax_total), 0) from prv),
      'sales_count', (select count(*) from prv),
      'margin', (select coalesce(sum(net - cost) filter (where costed), 0) from items where day between p_prev_from and p_prev_to),
      'costed_net', (select coalesce(sum(net) filter (where costed), 0) from items where day between p_prev_from and p_prev_to),
      'items_net', (select coalesce(sum(net), 0) from items where day between p_prev_from and p_prev_to),
      'collected', (select coalesce(sum(amount), 0) from pay where day between p_prev_from and p_prev_to)
    ),
    -- First valid sale: a comparison is only meaningful if the history covers the whole previous period.
    'first_sale_day', (select min(day) from s),
    'receivables', jsonb_build_object(
      'total', (select coalesce(sum(balance), 0) from s where balance > 0),
      'count', (select count(*) from s where balance > 0),
      'overdue_total', (select coalesce(sum(balance), 0) from s where balance > 0 and day < v_today - 30),
      'overdue_count', (select count(*) from s where balance > 0 and day < v_today - 30)
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', b.b, 'net', coalesce(c.net, 0), 'count', coalesce(c.n, 0),
               'prev_bucket', pb.b, 'prev_net', coalesce(p.net, 0)) order by b.idx), '[]'::jsonb)
        from buckets b
        left join (select date_trunc(p_bucket, day)::date as b, sum(total - tax_total) as net, count(*) as n from cur group by 1) c on c.b = b.b
        left join prev_buckets pb on pb.idx = b.idx
        left join (select date_trunc(p_bucket, day)::date as b, sum(total - tax_total) as net from prv group by 1) p on p.b = pb.b
    ),
    'by_branch', (
      select coalesce(jsonb_agg(jsonb_build_object('branch_id', br.id, 'name', br.name, 'net', coalesce(x.net, 0), 'count', coalesce(x.n, 0),
                                                   'prev_net', coalesce(x.prev_net, 0), 'prev_count', coalesce(x.prev_n, 0))
                                order by coalesce(x.net, 0) desc, br.name), '[]'::jsonb)
        from public.branches br
        left join (
          select sa.branch_id,
                 sum(sa.total - sa.tax_total) filter (where d between p_from and p_to) as net,
                 count(*) filter (where d between p_from and p_to) as n,
                 sum(sa.total - sa.tax_total) filter (where d between p_prev_from and p_prev_to) as prev_net,
                 count(*) filter (where d between p_prev_from and p_prev_to) as prev_n
            from public.sales sa, lateral (select (sa.created_at at time zone v_tz)::date as d) dd
           where sa.tenant_id = p_tenant and sa.status in ('partial', 'paid')
           group by sa.branch_id
        ) x on x.branch_id = br.id
       where br.tenant_id = p_tenant and br.deleted_at is null
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category', category, 'net', net) order by net desc), '[]'::jsonb)
        from (select category, sum(net) as net from items where day between p_from and p_to group by category having sum(net) > 0) c
    ),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object('description', t.description, 'quantity', t.qty, 'net', t.net, 'image_url', v.image_url) order by t.net desc), '[]'::jsonb)
        from (
          select variant_id, min(description) as description, sum(quantity) as qty, sum(net) as net
            from items where day between p_from and p_to
           group by variant_id, case when variant_id is null then description end
           order by sum(net) desc limit 5
        ) t left join public.product_variants v on v.id = t.variant_id
    ),
    'by_seller', (
      select coalesce(jsonb_agg(jsonb_build_object('seller_id', x.seller_id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'net', x.net, 'count', x.n)
                                order by x.net desc), '[]'::jsonb)
        from (select seller_id, sum(total - tax_total) as net, count(*) as n from cur group by seller_id order by 2 desc limit 5) x
        join public.profiles p on p.id = x.seller_id
    ),
    'alerts', jsonb_build_object(
      'low_stock', (select count(*) from stock where qty > 0 and qty <= min_qty),
      'out_of_stock', (select count(*) from stock where qty <= 0),
      'low_stock_by_category', (
        select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc, category), '[]'::jsonb)
          from (select category, count(*) as n from stock where qty <= min_qty group by category) c),
      'late_lab_orders', (select count(*) from late),
      'late_orders', (
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'number', number, 'days_late', days_late) order by days_late desc, number), '[]'::jsonb)
          from (select * from late order by days_late desc, number limit 3) l),
      'overdue', (
        select coalesce(jsonb_agg(jsonb_build_object('sale_id', o.id, 'number', o.number, 'customer', pt.full_name, 'balance', o.balance) order by o.balance desc), '[]'::jsonb)
          from (select * from s where balance > 0 and day < v_today - 30 order by balance desc limit 3) o
          left join public.patients pt on pt.id = o.patient_id)
    )
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.dashboard_summary(uuid, date, date, date, date, uuid, text) from public, anon;
grant execute on function public.dashboard_summary(uuid, date, date, date, date, uuid, text) to authenticated;
