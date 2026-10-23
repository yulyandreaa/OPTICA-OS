-- =============================================================================
-- Nueva venta: drafts.
-- A draft is a sale row with status 'draft': priced from the catalog like any sale, but it moves no stock, takes no
-- payments, gets its own numbering (BOR-…) so real sales keep a gapless V-… series, and doesn't count anywhere
-- (metrics, customer role, timeline). Confirming sends the final cart to create_sale with the draft id: the sale is
-- created (stock and payments validated again) and the draft is discarded in the same transaction.
-- =============================================================================

alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check check (status in ('draft', 'completed', 'voided', 'returned', 'partially_returned'));

-- Drafts don't make anyone a customer nor show in the patient's timeline.
drop trigger if exists sales_mark_customer on public.sales;
create trigger sales_mark_customer after insert on public.sales for each row when (new.status <> 'draft') execute function private.mark_person_role('customer');
drop trigger if exists sales_timeline on public.sales;
create trigger sales_timeline after insert on public.sales for each row when (new.status <> 'draft') execute function private.sale_timeline();
drop trigger if exists sales_audit on public.sales;
create trigger sales_audit after insert or update or delete on public.sales for each row execute function private.audit_row();

-- p: { tenant_id, id?, branch_id, patient_id?, seller_id?, notes?, payment_terms?, items: [{ variant_id, quantity, discount? }] }
create or replace function public.save_sale_draft(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  d public.sales; v_seller uuid; it jsonb; l record; i int := 0;
  v_sub numeric := 0; v_disc_total numeric := 0; v_tax_total numeric := 0; v_total numeric := 0;
begin
  if not private.can_write(v_tenant, 'sales.create', v_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 and nullif(p ->> 'patient_id', '') is null then
    raise exception 'SALE_EMPTY' using errcode = 'P0001';
  end if;
  if nullif(p ->> 'patient_id', '') is not null and not exists (
    select 1 from public.patients where id = (p ->> 'patient_id')::uuid and tenant_id = v_tenant and deleted_at is null) then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_seller := private.check_seller(v_tenant, v_branch, nullif(p ->> 'seller_id', '')::uuid);

  perform set_config('app.sales_rpc', 'on', true);
  if v_id is null then
    insert into public.sales (tenant_id, branch_id, patient_id, seller_id, created_by, notes, payment_terms, status, payment_status, number)
    values (v_tenant, v_branch, nullif(p ->> 'patient_id', '')::uuid, v_seller, auth.uid(), nullif(trim(p ->> 'notes'), ''),
            nullif(trim(p ->> 'payment_terms'), ''), 'draft', 'pending', private.next_number(v_tenant, 'sale_draft', 'BOR'))
    returning id into v_id;
  else
    select * into d from public.sales where id = v_id and tenant_id = v_tenant for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if d.status <> 'draft' then raise exception 'SALE_NOT_DRAFT' using errcode = 'P0001'; end if;
    if not private.can_write(v_tenant, 'sales.create', d.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    update public.sales set branch_id = v_branch, patient_id = nullif(p ->> 'patient_id', '')::uuid, seller_id = v_seller,
           notes = nullif(trim(p ->> 'notes'), ''), payment_terms = nullif(trim(p ->> 'payment_terms'), '')
     where id = v_id;
    delete from public.sale_items where sale_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    select * into l from private.price_line(v_tenant, nullif(it ->> 'variant_id', '')::uuid,
                                            coalesce((it ->> 'quantity')::numeric, 1), coalesce((it ->> 'discount')::numeric, 0));
    if coalesce((it ->> 'discount')::numeric, 0) > 0 and not private.has_permission(v_tenant, 'sales.discount', v_branch) then
      raise exception 'DISCOUNT_FORBIDDEN' using errcode = '42501';
    end if;
    insert into public.sale_items (tenant_id, sale_id, variant_id, description, category, quantity, unit_price, unit_cost, discount, tax_rate, line_total, tax_amount, sort_order)
    values (v_tenant, v_id, l.variant_id, l.description, l.category, coalesce((it ->> 'quantity')::numeric, 1), l.unit_price, 0,
            coalesce((it ->> 'discount')::numeric, 0), l.tax_rate, l.line_total, l.tax_amount, i);
    v_sub := v_sub + l.line_total + coalesce((it ->> 'discount')::numeric, 0);
    v_disc_total := v_disc_total + coalesce((it ->> 'discount')::numeric, 0);
    v_tax_total := v_tax_total + l.tax_amount;
    v_total := v_total + l.line_total;
  end loop;
  update public.sales set subtotal = v_sub, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total where id = v_id;
  return v_id;
end $$;

-- security definer: sales have no DELETE policy (a registered sale is never deleted); this only removes drafts,
-- after checking the caller may sell in the draft's branch.
create or replace function private.discard_sale_draft(p_tenant uuid, p_draft uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.sales;
begin
  select * into d from public.sales where id = p_draft and tenant_id = p_tenant for update;
  if not found then return; end if; -- already discarded (retry)
  if d.status <> 'draft' then raise exception 'SALE_NOT_DRAFT' using errcode = 'P0001'; end if;
  if not private.can_write(p_tenant, 'sales.create', d.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform set_config('app.sales_rpc', 'on', true);
  delete from public.sales where id = p_draft;
end $$;
revoke all on function private.discard_sale_draft(uuid, uuid) from public, anon;
grant execute on function private.discard_sale_draft(uuid, uuid) to authenticated;

create or replace function public.delete_sale_draft(p_tenant uuid, p_draft uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.discard_sale_draft(p_tenant, p_draft);
end $$;

-- create_sale: same as etapa 1, plus `draft_id` (the draft this sale confirms; discarded in the same transaction)
-- and the rule that a sale left with a balance needs a customer.
create or replace function public.create_sale(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_sale uuid;
begin
  v_sale := private.create_sale_core(p - 'quote_id' - 'draft_id', null);
  -- A balance becomes a receivable: it must belong to someone.
  if exists (select 1 from public.sales where id = v_sale and balance > 0 and patient_id is null) then
    raise exception 'CUSTOMER_REQUIRED_FOR_BALANCE' using errcode = 'P0001';
  end if;
  if nullif(p ->> 'draft_id', '') is not null then
    perform private.discard_sale_draft((p ->> 'tenant_id')::uuid, (p ->> 'draft_id')::uuid);
  end if;
  return v_sale;
end $$;

-- Payments only on registered sales (not drafts, not voided or returned ones).
create or replace function public.add_sale_payment(p_sale uuid, p_payments jsonb)
returns numeric language plpgsql security invoker set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.can_write(s.tenant_id, 'sales.create', s.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if s.status = 'draft' then raise exception 'SALE_IS_DRAFT' using errcode = 'P0001'; end if;
  if s.status in ('voided', 'returned') then raise exception 'SALE_CLOSED' using errcode = 'P0001'; end if;
  perform private.add_payments(s.tenant_id, p_sale, p_payments);
  return (select balance from public.sales where id = p_sale);
end $$;

revoke all on function public.save_sale_draft(jsonb), public.delete_sale_draft(uuid, uuid) from public, anon;
grant execute on function public.save_sale_draft(jsonb), public.delete_sale_draft(uuid, uuid) to authenticated;
