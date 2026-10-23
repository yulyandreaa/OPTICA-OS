-- Nueva venta: link an existing optical order (same customer, not cancelled or delivered, no sale yet) when the sale is
-- confirmed. Orders for new glasses are still created from the confirmed sale; this covers orders opened before the sale
-- (e.g. right after the exam). The order keeps its own life cycle; only sale_id is set, in the same transaction.

create or replace function private.link_lab_order(p_tenant uuid, p_sale uuid, p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sales; o public.lab_orders;
begin
  select * into s from public.sales where id = p_sale and tenant_id = p_tenant;
  select * into o from public.lab_orders where id = p_order and tenant_id = p_tenant for update;
  if o.id is null then raise exception 'LAB_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.has_permission(p_tenant, 'lab_orders.read', o.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if o.sale_id = p_sale then return; end if; -- retry
  if o.sale_id is not null or o.status in ('cancelled', 'delivered') or o.patient_id is distinct from s.patient_id then
    raise exception 'LAB_ORDER_NOT_LINKABLE' using errcode = 'P0001';
  end if;
  update public.lab_orders set sale_id = p_sale where id = p_order;
end $$;
revoke all on function private.link_lab_order(uuid, uuid, uuid) from public, anon;
grant execute on function private.link_lab_order(uuid, uuid, uuid) to authenticated;

-- create_sale: as in …022, plus `lab_order_id`.
create or replace function public.create_sale(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_sale uuid;
begin
  v_sale := private.create_sale_core(p - 'quote_id' - 'draft_id' - 'lab_order_id', null);
  -- A balance becomes a receivable: it must belong to someone.
  if exists (select 1 from public.sales where id = v_sale and balance > 0 and patient_id is null) then
    raise exception 'CUSTOMER_REQUIRED_FOR_BALANCE' using errcode = 'P0001';
  end if;
  if nullif(p ->> 'draft_id', '') is not null then
    perform private.discard_sale_draft((p ->> 'tenant_id')::uuid, (p ->> 'draft_id')::uuid);
  end if;
  if nullif(p ->> 'lab_order_id', '') is not null then
    perform private.link_lab_order((p ->> 'tenant_id')::uuid, v_sale, (p ->> 'lab_order_id')::uuid);
  end if;
  return v_sale;
end $$;
