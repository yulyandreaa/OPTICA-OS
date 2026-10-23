-- =============================================================================
-- Ventas y cotizaciones — etapa 2: indicators and the unified list of operations.
-- Definitions (also in docs/sales-metrics.md). Days are counted in the company's timezone.
--   valid sale         status completed or partially_returned (voided and fully returned sales are excluded).
--   net sales          Σ (total − tax_total) of valid sales registered in the period: after line discounts, before VAT
--                      (prices are VAT-inclusive). Same definition as the dashboard. Returns will subtract here once
--                      they exist (etapa 5).
--   sales count        number of valid sales registered in the period (one row per sale: no duplicates).
--   open quotes        quotes sent, viewed or accepted whose validity has not passed, as of today (not period-bound).
--   conversion rate    cohort by issue date: of the quotes issued in the period (any status but draft; issue date =
--                      sent_at, or created_at for older rows), how many are converted today. Quotes issued at the end of
--                      the period may still convert, so the rate of a recent period can grow; drafts never count.
-- Both functions are SECURITY INVOKER: RLS decides which branches (and whether quotes) the caller sees.
-- =============================================================================

create or replace function public.sales_overview(p_tenant uuid, p_from date, p_to date, p_branch uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_tz text; v_today date; r jsonb;
begin
  if not private.has_permission(p_tenant, 'sales.read', p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_from > p_to then raise exception 'INVALID_PERIOD' using errcode = '22023'; end if;
  select timezone into v_tz from public.tenants where id = p_tenant;
  v_today := (now() at time zone v_tz)::date;
  with s as (
    select sa.status, sa.total, sa.tax_total, sa.discount_total, sa.balance
      from public.sales sa
     where sa.tenant_id = p_tenant and (p_branch is null or sa.branch_id = p_branch)
       and (sa.created_at at time zone v_tz)::date between p_from and p_to
  ),
  q as (
    select qu.status, qu.total, qu.valid_until, (coalesce(qu.sent_at, qu.created_at) at time zone v_tz)::date as issued
      from public.quotes qu
     where qu.tenant_id = p_tenant and (p_branch is null or qu.branch_id = p_branch)
  ),
  cohort as (select * from q where status <> 'draft' and issued between p_from and p_to)
  select jsonb_build_object(
    'net_sales', (select coalesce(sum(total - tax_total), 0) from s where status in ('completed', 'partially_returned')),
    'gross_sales', (select coalesce(sum(total), 0) from s where status in ('completed', 'partially_returned')),
    'discounts', (select coalesce(sum(discount_total), 0) from s where status in ('completed', 'partially_returned')),
    'sales_count', (select count(*) from s where status in ('completed', 'partially_returned')),
    'voided_count', (select count(*) from s where status in ('voided', 'returned')),
    'balance_due', (select coalesce(sum(balance), 0) from s where status in ('completed', 'partially_returned') and balance > 0),
    'open_quotes', (select count(*) from q where status in ('sent', 'viewed', 'accepted') and valid_until >= v_today),
    'open_quotes_total', (select coalesce(sum(total), 0) from q where status in ('sent', 'viewed', 'accepted') and valid_until >= v_today),
    'draft_quotes', (select count(*) from q where status = 'draft' and valid_until >= v_today),
    'issued_quotes', (select count(*) from cohort),
    'converted_quotes', (select count(*) from cohort where status = 'converted')
  ) into r;
  return r;
end $$;

-- One list for sales and quotes. p_kind: 'all' | 'sale' | 'quote' | 'void' (voided or returned sales).
-- p_status: a sale status, or a quote status where 'expired' includes quotes past their date that nobody closed.
create or replace function public.sales_operations(
  p_tenant uuid, p_kind text default 'all', p_from date default null, p_to date default null, p_branch uuid default null,
  p_query text default null, p_status text default null, p_payment text default null, p_seller uuid default null,
  p_limit int default 25, p_offset int default 0
) returns table (
  kind text, id uuid, number text, created_at timestamptz, customer_id uuid, customer_name text, customer_document text,
  branch_name text, seller_name text, total numeric, balance numeric, status text, payment_status text, valid_until date,
  items_count int, total_count bigint
) language sql stable security invoker set search_path = '' as $$
  with tz as (select timezone as v from public.tenants where id = p_tenant),
  needle as (select nullif(trim(p_query), '') as v),
  ops as (
    select 'sale'::text as kind, sa.id, sa.number, sa.created_at, sa.patient_id as customer_id, sa.branch_id, sa.seller_id,
           sa.total, sa.balance, sa.status, sa.payment_status, null::date as valid_until
      from public.sales sa
     where sa.tenant_id = p_tenant and p_kind in ('all', 'sale', 'void')
       and (p_kind <> 'void' or sa.status in ('voided', 'returned', 'partially_returned'))
       and (p_payment is null or sa.payment_status = p_payment)
    union all
    select 'quote', qu.id, qu.number, qu.created_at, qu.patient_id, qu.branch_id, qu.seller_id, qu.total, null,
           case when qu.status in ('draft', 'sent', 'viewed', 'accepted')
                 and qu.valid_until < (now() at time zone (select v from tz))::date then 'expired' else qu.status end,
           null, qu.valid_until
      from public.quotes qu
     where qu.tenant_id = p_tenant and p_kind in ('all', 'quote') and p_payment is null
  ),
  filtered as (
    select o.*, pt.full_name as customer_name, pt.document_number as customer_document, br.name as branch_name,
           coalesce(nullif(pr.full_name, ''), pr.email::text) as seller_name
      from ops o
      left join public.patients pt on pt.id = o.customer_id
      left join public.branches br on br.id = o.branch_id
      left join public.profiles pr on pr.id = o.seller_id
     where (p_branch is null or o.branch_id = p_branch)
       and (p_from is null or (o.created_at at time zone (select v from tz))::date >= p_from)
       and (p_to is null or (o.created_at at time zone (select v from tz))::date <= p_to)
       and (p_status is null or o.status = p_status or (p_status = 'sent' and o.status = 'viewed'))
       and (p_seller is null or o.seller_id = p_seller)
       and ((select v from needle) is null
         or o.number ilike '%' || (select v from needle) || '%'
         or pt.full_name ilike '%' || (select v from needle) || '%'
         or pt.document_number ilike (select v from needle) || '%'
         or pr.full_name ilike '%' || (select v from needle) || '%'
         or exists (select 1 from public.sale_items si left join public.product_variants pv on pv.id = si.variant_id
                     where o.kind = 'sale' and si.sale_id = o.id
                       and (si.description ilike '%' || (select v from needle) || '%' or pv.sku ilike (select v from needle) || '%'))
         or exists (select 1 from public.quote_items qi left join public.product_variants pv on pv.id = qi.variant_id
                     where o.kind = 'quote' and qi.quote_id = o.id
                       and (qi.description ilike '%' || (select v from needle) || '%' or pv.sku ilike (select v from needle) || '%')))
  )
  select f.kind, f.id, f.number, f.created_at, f.customer_id, f.customer_name, f.customer_document, f.branch_name, f.seller_name,
         f.total, f.balance, f.status, f.payment_status, f.valid_until,
         (case when f.kind = 'sale' then (select count(*) from public.sale_items si where si.sale_id = f.id)
               else (select count(*) from public.quote_items qi where qi.quote_id = f.id) end)::int,
         count(*) over ()
    from filtered f
   order by f.created_at desc, f.number desc
   limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

revoke all on function public.sales_overview(uuid, date, date, uuid), public.sales_operations(uuid, text, date, date, uuid, text, text, text, uuid, int, int) from public, anon;
grant execute on function public.sales_overview(uuid, date, date, uuid), public.sales_operations(uuid, text, date, date, uuid, text, text, text, uuid, int, int) to authenticated;
