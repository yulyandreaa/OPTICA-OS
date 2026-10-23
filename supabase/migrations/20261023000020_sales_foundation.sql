-- =============================================================================
-- Ventas y cotizaciones — etapa 1: base segura.
--   · Commercial status and payment status are separate columns (a paid sale can be voided; a returned one refunded).
--       sales.status          completed | voided | returned | partially_returned
--       sales.payment_status  pending | partial | paid | refunded | partially_refunded
--   · Prices, VAT and cost always come from the catalog: the server ignores amounts sent by the client.
--   · Discounts need sales.discount (no cap, by business decision) and are audited with the sale.
--   · Quotes: draft → sent → accepted / rejected; editable while draft or sent; expired when valid_until passes
--     (derived from the date; set_quote_status records it when someone acts on an expired quote);
--     converting uses the CURRENT catalog price (business decision) and is idempotent.
--   · Sales, quotes and their lines change only through these functions (direct writes are refused).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns and states
-- -----------------------------------------------------------------------------
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales
  add column if not exists payment_status text not null default 'pending',
  add column if not exists due_date date,
  add column if not exists payment_terms text,
  add column if not exists created_by uuid references public.profiles(id);
update public.sales set
  payment_status = case when status in ('partial', 'paid') and paid_total >= total and total > 0 then 'paid'
                        when paid_total >= total then 'paid'
                        when paid_total > 0 then 'partial' else 'pending' end,
  status = case status when 'cancelled' then 'voided' when 'returned' then 'returned' else 'completed' end,
  created_by = coalesce(created_by, seller_id);
alter table public.sales alter column status set default 'completed';
alter table public.sales add constraint sales_status_check check (status in ('completed', 'voided', 'returned', 'partially_returned'));
alter table public.sales add constraint sales_payment_status_check check (payment_status in ('pending', 'partial', 'paid', 'refunded', 'partially_refunded'));
create index if not exists sales_tenant_status_idx on public.sales (tenant_id, status, created_at desc);

alter table public.quotes
  add column if not exists payment_terms text,
  add column if not exists sent_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists converted_at timestamptz;
create index if not exists quotes_tenant_status_idx on public.quotes (tenant_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- Only the RPCs below write sales, quotes and their lines.
-- -----------------------------------------------------------------------------
create or replace function private.sales_rpc_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.sales_rpc', true), '') <> 'on' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'SALES_RPC_ONLY' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists sales_rpc_only on public.sales;
drop trigger if exists sale_items_rpc_only on public.sale_items;
drop trigger if exists quotes_rpc_only on public.quotes;
drop trigger if exists quote_items_rpc_only on public.quote_items;
create trigger sales_rpc_only before insert or update or delete on public.sales for each row execute function private.sales_rpc_only();
create trigger sale_items_rpc_only before insert or update or delete on public.sale_items for each row execute function private.sales_rpc_only();
create trigger quotes_rpc_only before insert or update or delete on public.quotes for each row execute function private.sales_rpc_only();
create trigger quote_items_rpc_only before insert or update or delete on public.quote_items for each row execute function private.sales_rpc_only();
-- Lines are never edited after the fact: a correction is a return or a void (etapa 5).
create trigger sale_items_audit after insert on public.sale_items for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Pricing: one place that turns (variant, quantity, discount) into a priced line from the catalog.
-- -----------------------------------------------------------------------------
create or replace function private.price_line(p_tenant uuid, p_variant uuid, p_qty numeric, p_discount numeric,
  out variant_id uuid, out description text, out category text, out unit_price numeric, out unit_cost numeric,
  out tax_rate numeric, out line_total numeric, out tax_amount numeric, out is_stocked boolean, out is_active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_variant is null then raise exception 'PRODUCT_REQUIRED' using errcode = 'P0001'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 9999 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  if p_discount is null or p_discount < 0 then raise exception 'INVALID_DISCOUNT' using errcode = 'P0001'; end if;
  select pv.id, pr.name || coalesce(' · ' || nullif(pv.color_name, ''), ''), c.name, pv.price, private.variant_cost(pv.id),
         pr.tax_rate, pr.is_stocked, pv.is_active and pr.is_active
    into variant_id, description, category, unit_price, unit_cost, tax_rate, is_stocked, is_active
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    join public.product_categories c on c.id = pr.category_id
   where pv.id = p_variant and pv.tenant_id = p_tenant;
  if variant_id is null then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  line_total := round(p_qty * unit_price - p_discount, 2);
  if line_total < 0 then raise exception 'DISCOUNT_TOO_HIGH' using errcode = 'P0001'; end if;
  tax_amount := private.line_tax(line_total, tax_rate);
end $$;
revoke all on function private.price_line(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function private.price_line(uuid, uuid, numeric, numeric) to authenticated;

/** Seller must be an active member allowed to sell in that branch; defaults to the caller. */
create or replace function private.check_seller(p_tenant uuid, p_branch uuid, p_seller uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if p_seller is null or p_seller = auth.uid() then return auth.uid(); end if;
  if not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = p_tenant and m.user_id = p_seller and m.status = 'active'
       and exists (select 1 from public.user_roles r join public.role_permissions rp on rp.role_id = r.role_id
                    where r.tenant_id = p_tenant and r.user_id = p_seller and rp.permission_code = 'sales.create'
                      and (r.branch_id is null or r.branch_id = p_branch))
  ) then raise exception 'INVALID_SELLER' using errcode = 'P0001'; end if;
  return p_seller;
end $$;
revoke all on function private.check_seller(uuid, uuid, uuid) from public, anon;
grant execute on function private.check_seller(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Payments: recalculates paid_total and payment_status (never the commercial status).
-- -----------------------------------------------------------------------------
create or replace function private.add_payments(p_tenant uuid, p_sale uuid, p_payments jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare p jsonb; v_total numeric; v_paid numeric;
begin
  perform set_config('app.sales_rpc', 'on', true);
  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce((p ->> 'amount')::numeric, 0) <= 0 then continue; end if;
    if (p ->> 'method') not in ('cash', 'card', 'transfer', 'nequi', 'daviplata', 'wompi') then
      raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
    end if;
    insert into public.payments (tenant_id, sale_id, method, amount, reference, received_by)
    values (p_tenant, p_sale, p ->> 'method', round((p ->> 'amount')::numeric, 2), nullif(trim(p ->> 'reference'), ''), auth.uid());
  end loop;
  select total into v_total from public.sales where id = p_sale;
  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = p_sale;
  if v_paid > v_total then raise exception 'PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001'; end if;
  update public.sales set paid_total = v_paid,
         payment_status = case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partial' else 'pending' end
   where id = p_sale;
end $$;

-- -----------------------------------------------------------------------------
-- Sales
-- p: { tenant_id, branch_id, patient_id?, prescription_id?, seller_id?, notes?, due_date?, payment_terms?, idempotency_key?,
--      items: [{ variant_id, quantity, discount? }], payments: [{ method, amount, reference? }] }
-- Prices, VAT and cost come from the catalog. Stock leaves the branch when the sale is registered.
-- -----------------------------------------------------------------------------
create or replace function private.create_sale_core(p jsonb, p_quote uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_key text := nullif(p ->> 'idempotency_key', '');
  v_sale uuid; v_seller uuid; it jsonb; l record; i int := 0;
  v_sub numeric := 0; v_disc_total numeric := 0; v_tax_total numeric := 0; v_total numeric := 0;
begin
  if not private.can_write(v_tenant, 'sales.create', v_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_key is not null then
    select id into v_sale from public.sales where tenant_id = v_tenant and idempotency_key = v_key;
    if v_sale is not null then return v_sale; end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'SALE_EMPTY' using errcode = 'P0001'; end if;
  if nullif(p ->> 'patient_id', '') is not null and not exists (
    select 1 from public.patients where id = (p ->> 'patient_id')::uuid and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if nullif(p ->> 'due_date', '') is not null and (p ->> 'due_date')::date < current_date then
    raise exception 'INVALID_DUE_DATE' using errcode = 'P0001';
  end if;
  v_seller := private.check_seller(v_tenant, v_branch, nullif(p ->> 'seller_id', '')::uuid);

  perform set_config('app.sales_rpc', 'on', true);
  insert into public.sales (tenant_id, branch_id, patient_id, prescription_id, quote_id, seller_id, created_by, notes, due_date, payment_terms, idempotency_key)
  values (v_tenant, v_branch, nullif(p ->> 'patient_id', '')::uuid, nullif(p ->> 'prescription_id', '')::uuid, p_quote, v_seller, auth.uid(),
          nullif(trim(p ->> 'notes'), ''), nullif(p ->> 'due_date', '')::date, nullif(trim(p ->> 'payment_terms'), ''), v_key)
  returning id into v_sale;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    i := i + 1;
    select * into l from private.price_line(v_tenant, nullif(it ->> 'variant_id', '')::uuid,
                                            coalesce((it ->> 'quantity')::numeric, 1), coalesce((it ->> 'discount')::numeric, 0));
    if not l.is_active then raise exception 'PRODUCT_INACTIVE' using errcode = 'P0001', hint = l.description || ' está inactivo y no se puede vender.'; end if;
    if coalesce((it ->> 'discount')::numeric, 0) > 0 and not private.has_permission(v_tenant, 'sales.discount', v_branch) then
      raise exception 'DISCOUNT_FORBIDDEN' using errcode = '42501';
    end if;
    insert into public.sale_items (tenant_id, sale_id, variant_id, description, category, quantity, unit_price, unit_cost, discount, tax_rate, line_total, tax_amount, sort_order)
    values (v_tenant, v_sale, l.variant_id, l.description, l.category, coalesce((it ->> 'quantity')::numeric, 1), l.unit_price, l.unit_cost,
            coalesce((it ->> 'discount')::numeric, 0), l.tax_rate, l.line_total, l.tax_amount, i);
    if l.is_stocked then
      -- The movement trigger checks availability (and picks lots, first expiry first out).
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, reference_type, reference_id, created_by)
      values (v_tenant, v_branch, l.variant_id, 'sale', coalesce((it ->> 'quantity')::numeric, 1), l.unit_cost, 'sale', v_sale, auth.uid());
    end if;
    v_sub := v_sub + l.line_total + coalesce((it ->> 'discount')::numeric, 0);
    v_disc_total := v_disc_total + coalesce((it ->> 'discount')::numeric, 0);
    v_tax_total := v_tax_total + l.tax_amount;
    v_total := v_total + l.line_total;
  end loop;

  update public.sales set subtotal = v_sub, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total,
         payment_status = case when v_total = 0 then 'paid' else 'pending' end
   where id = v_sale;
  perform private.add_payments(v_tenant, v_sale, p -> 'payments');
  return v_sale;
end $$;
revoke all on function private.create_sale_core(jsonb, uuid) from public, anon;
grant execute on function private.create_sale_core(jsonb, uuid) to authenticated;

create or replace function public.create_sale(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  -- A quote becomes a sale only through convert_quote (eligibility, current prices, link and history).
  return private.create_sale_core(p - 'quote_id', null);
end $$;

create or replace function public.add_sale_payment(p_sale uuid, p_payments jsonb)
returns numeric language plpgsql security invoker set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.can_write(s.tenant_id, 'sales.create', s.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if s.status in ('voided', 'returned') then raise exception 'SALE_CLOSED' using errcode = 'P0001'; end if;
  perform private.add_payments(s.tenant_id, p_sale, p_payments);
  return (select balance from public.sales where id = p_sale);
end $$;

-- -----------------------------------------------------------------------------
-- Quotes
-- p: { tenant_id, id?, branch_id, patient_id, prescription_id?, seller_id?, status: 'draft'|'sent', valid_until, notes?, payment_terms?,
--      items: [{ variant_id, quantity, discount? }] }
-- -----------------------------------------------------------------------------
create or replace function public.save_quote(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'draft');
  v_until date := coalesce(nullif(p ->> 'valid_until', '')::date, current_date + 15);
  q public.quotes; v_seller uuid; it jsonb; l record; i int := 0;
  v_sub numeric := 0; v_disc_total numeric := 0; v_tax_total numeric := 0; v_total numeric := 0;
begin
  if not private.can_write(v_tenant, 'quotes.create', v_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_status not in ('draft', 'sent') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if v_until < current_date then raise exception 'INVALID_VALID_UNTIL' using errcode = 'P0001'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'SALE_EMPTY' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.patients where id = (p ->> 'patient_id')::uuid and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_seller := private.check_seller(v_tenant, v_branch, nullif(p ->> 'seller_id', '')::uuid);

  perform set_config('app.sales_rpc', 'on', true);
  if v_id is null then
    insert into public.quotes (tenant_id, branch_id, patient_id, prescription_id, seller_id, notes, payment_terms, status, valid_until, created_by, sent_at)
    values (v_tenant, v_branch, (p ->> 'patient_id')::uuid, nullif(p ->> 'prescription_id', '')::uuid, v_seller, nullif(trim(p ->> 'notes'), ''),
            nullif(trim(p ->> 'payment_terms'), ''), v_status, v_until, auth.uid(), case when v_status = 'sent' then now() end)
    returning id into v_id;
  else
    select * into q from public.quotes where id = v_id and tenant_id = v_tenant for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if q.status not in ('draft', 'sent', 'viewed') then raise exception 'QUOTE_LOCKED' using errcode = 'P0001'; end if;
    if not private.can_write(v_tenant, 'quotes.create', q.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    update public.quotes set branch_id = v_branch, patient_id = (p ->> 'patient_id')::uuid, prescription_id = nullif(p ->> 'prescription_id', '')::uuid,
           seller_id = v_seller, notes = nullif(trim(p ->> 'notes'), ''), payment_terms = nullif(trim(p ->> 'payment_terms'), ''),
           status = case when q.status = 'viewed' and v_status = 'sent' then 'viewed' else v_status end, valid_until = v_until,
           sent_at = case when v_status = 'sent' then coalesce(q.sent_at, now()) else q.sent_at end
     where id = v_id;
    delete from public.quote_items where quote_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    i := i + 1;
    select * into l from private.price_line(v_tenant, nullif(it ->> 'variant_id', '')::uuid,
                                            coalesce((it ->> 'quantity')::numeric, 1), coalesce((it ->> 'discount')::numeric, 0));
    if not l.is_active then raise exception 'PRODUCT_INACTIVE' using errcode = 'P0001', hint = l.description || ' está inactivo.'; end if;
    if coalesce((it ->> 'discount')::numeric, 0) > 0 and not private.has_permission(v_tenant, 'sales.discount', v_branch) then
      raise exception 'DISCOUNT_FORBIDDEN' using errcode = '42501';
    end if;
    insert into public.quote_items (tenant_id, quote_id, variant_id, description, quantity, unit_price, discount, tax_rate, line_total, tax_amount, sort_order)
    values (v_tenant, v_id, l.variant_id, l.description, coalesce((it ->> 'quantity')::numeric, 1), l.unit_price,
            coalesce((it ->> 'discount')::numeric, 0), l.tax_rate, l.line_total, l.tax_amount, i);
    v_sub := v_sub + l.line_total + coalesce((it ->> 'discount')::numeric, 0);
    v_disc_total := v_disc_total + coalesce((it ->> 'discount')::numeric, 0);
    v_tax_total := v_tax_total + l.tax_amount;
    v_total := v_total + l.line_total;
  end loop;
  update public.quotes set subtotal = v_sub, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total where id = v_id;
  return v_id;
end $$;

/** Commercial decisions on a quote: send, accept, reject (with reason). Expiry is registered when it is detected. */
create or replace function public.set_quote_status(p_quote uuid, p_status text, p_reason text default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare q public.quotes;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.can_write(q.tenant_id, 'quotes.create', q.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if q.status = p_status then return q.status; end if; -- retry
  perform set_config('app.sales_rpc', 'on', true);
  if q.status in ('draft', 'sent', 'viewed', 'accepted') and q.valid_until < current_date and p_status <> 'rejected' then
    update public.quotes set status = 'expired' where id = p_quote;
    return 'expired';
  end if;
  if not (
       (p_status = 'sent' and q.status = 'draft')
    or (p_status = 'accepted' and q.status in ('sent', 'viewed'))
    or (p_status = 'rejected' and q.status in ('draft', 'sent', 'viewed', 'accepted'))
  ) then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if p_status = 'rejected' and length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  update public.quotes set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
         rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
         rejection_reason = case when p_status = 'rejected' then left(trim(p_reason), 300) else rejection_reason end
   where id = p_quote;
  return p_status;
end $$;

/**
 * Before converting: is the quote still eligible, and what changed since it was quoted (price, stock, active)?
 * The sale uses current prices, so the user confirms the new total first.
 */
create or replace function public.quote_conversion_check(p_quote uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare q public.quotes; v_lines jsonb; v_total numeric;
begin
  select * into q from public.quotes where id = p_quote;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', qi.description, 'quantity', qi.quantity, 'discount', qi.discount,
           'quoted_price', qi.unit_price, 'current_price', pv.price,
           'active', coalesce(pv.is_active and pr.is_active, false), 'stocked', coalesce(pr.is_stocked, false),
           'available', case when pr.is_stocked then coalesce((select quantity from public.inventory_levels l where l.branch_id = q.branch_id and l.variant_id = qi.variant_id), 0) end
         ) order by qi.sort_order), '[]'::jsonb),
         coalesce(sum(round(qi.quantity * coalesce(pv.price, qi.unit_price) - qi.discount, 2)), 0)
    into v_lines, v_total
    from public.quote_items qi
    left join public.product_variants pv on pv.id = qi.variant_id
    left join public.products pr on pr.id = pv.product_id
   where qi.quote_id = p_quote;
  return jsonb_build_object(
    'status', case when q.status in ('draft', 'sent', 'viewed', 'accepted') and q.valid_until < current_date then 'expired' else q.status end,
    'eligible', q.status in ('sent', 'viewed', 'accepted') and q.valid_until >= current_date,
    'sale_id', q.sale_id, 'quoted_total', q.total, 'current_total', v_total, 'lines', v_lines);
end $$;

-- Converts a quote into a sale: same customer, lines, quantities and discounts at CURRENT prices. Idempotent per quote.
create or replace function public.convert_quote(p_quote uuid, p_payments jsonb, p_idempotency_key text default null, p_options jsonb default '{}'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare q public.quotes; v_items jsonb; v_sale uuid;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if q.status = 'converted' then return q.sale_id; end if; -- retry
  if not private.can_write(q.tenant_id, 'sales.create', q.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform set_config('app.sales_rpc', 'on', true);
  -- Expiry is derived from valid_until (the raise rolls back any write); set_quote_status records it explicitly.
  if q.status in ('draft', 'sent', 'viewed', 'accepted') and q.valid_until < current_date then
    raise exception 'QUOTE_EXPIRED' using errcode = 'P0001';
  end if;
  if q.status = 'draft' then raise exception 'QUOTE_NOT_SENT' using errcode = 'P0001'; end if;
  if q.status not in ('sent', 'viewed', 'accepted') then raise exception 'QUOTE_NOT_CONVERTIBLE' using errcode = 'P0001'; end if;
  select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity, 'discount', discount) order by sort_order)
    into v_items from public.quote_items where quote_id = p_quote;
  v_sale := private.create_sale_core(jsonb_build_object(
    'tenant_id', q.tenant_id, 'branch_id', q.branch_id, 'patient_id', q.patient_id, 'prescription_id', q.prescription_id,
    'seller_id', q.seller_id, 'notes', coalesce(p_options ->> 'notes', q.notes), 'payment_terms', coalesce(p_options ->> 'payment_terms', q.payment_terms),
    'due_date', p_options ->> 'due_date', 'items', v_items, 'payments', coalesce(p_payments, '[]'::jsonb),
    'idempotency_key', coalesce(p_idempotency_key, 'quote:' || q.id)), q.id);
  update public.quotes set status = 'converted', sale_id = v_sale, converted_at = now() where id = p_quote;
  return v_sale;
end $$;

-- The public quote page marks "viewed" through a definer function: let it past the guard.
create or replace function public.public_quote(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.quotes; r jsonb;
begin
  select * into q from public.quotes where public_token = p_token;
  if not found or q.status = 'draft' then return null; end if;
  if q.status = 'sent' then
    perform set_config('app.sales_rpc', 'on', true);
    update public.quotes set status = 'viewed', viewed_at = now() where id = q.id;
  end if;
  select jsonb_build_object(
    'number', q.number, 'status', case when q.status = 'sent' then 'viewed' else q.status end, 'valid_until', q.valid_until,
    'total', q.total, 'tax_total', q.tax_total, 'discount_total', q.discount_total,
    'tenant', (select jsonb_build_object('name', t.trade_name, 'brand_color', t.brand_color, 'phone', t.phone) from public.tenants t where t.id = q.tenant_id),
    'branch', (select jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone) from public.branches b where b.id = q.branch_id),
    'patient_first_name', (select first_name from public.patients where id = q.patient_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'unit_price', i.unit_price,
               'discount', i.discount, 'line_total', i.line_total, 'image_url', v.image_url) order by i.sort_order), '[]'::jsonb)
              from public.quote_items i left join public.product_variants v on v.id = i.variant_id where i.quote_id = q.id)
  ) into r;
  return r;
end $$;

drop function if exists public.create_quote(jsonb);
drop function if exists public.convert_quote(uuid, jsonb, text);
revoke all on function public.save_quote(jsonb), public.set_quote_status(uuid, text, text), public.quote_conversion_check(uuid),
  public.convert_quote(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.save_quote(jsonb), public.set_quote_status(uuid, text, text), public.quote_conversion_check(uuid),
  public.convert_quote(uuid, jsonb, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Dashboard: same body as …016, with the new commercial states
-- (valid = completed or partially returned; excluded = voided or fully returned).
-- -----------------------------------------------------------------------------
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
     where sa.tenant_id = p_tenant and sa.status in ('completed', 'partially_returned')
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
     where sa.tenant_id = p_tenant and sa.status in ('voided', 'returned')
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
    select v.id, c.name as category, coalesce(s.quantity, 0) as qty, coalesce(s.min_quantity, 0) as min_qty
      from public.product_variants v
      join public.products p on p.id = v.product_id
      join public.product_categories c on c.id = p.category_id
      join public.inventory_stock(p_tenant, p_branch) s on s.variant_id = v.id
     where v.tenant_id = p_tenant and v.is_active and p.is_active and p.is_stocked
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
           where sa.tenant_id = p_tenant and sa.status in ('completed', 'partially_returned')
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
