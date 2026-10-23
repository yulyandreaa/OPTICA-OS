-- Deleting products.
-- A product can only be deleted while it has no history (movements, lots, transfers, purchases, quotes, sales)
-- and no units anywhere: once it has moved, deleting it would break the inventory and sales trail, so the
-- app offers deactivating instead. Deletions are audited.

create or replace function public.product_has_history(p_tenant uuid, p_product uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with v as (select id from public.product_variants where tenant_id = p_tenant and product_id = p_product)
  select private.is_member(p_tenant) and (
       exists (select 1 from public.inventory_movements m where m.tenant_id = p_tenant and m.variant_id in (select id from v))
    or exists (select 1 from public.inventory_lots l where l.tenant_id = p_tenant and l.variant_id in (select id from v))
    or exists (select 1 from public.inventory_transfer_items t where t.tenant_id = p_tenant and t.variant_id in (select id from v))
    or exists (select 1 from public.purchase_order_items po where po.tenant_id = p_tenant and po.variant_id in (select id from v))
    or exists (select 1 from public.quote_items q where q.tenant_id = p_tenant and q.variant_id in (select id from v))
    or exists (select 1 from public.sale_items s where s.tenant_id = p_tenant and s.variant_id in (select id from v))
    or exists (select 1 from public.inventory_levels il where il.tenant_id = p_tenant and il.variant_id in (select id from v) and il.quantity <> 0)
  );
$$;

create or replace function public.delete_product(p_tenant uuid, p_product uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_write(p_tenant, 'inventory.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform 1 from public.products where id = p_product and tenant_id = p_tenant for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  if public.product_has_history(p_tenant, p_product) then raise exception 'PRODUCT_HAS_HISTORY' using errcode = 'P0001'; end if;

  -- Empty stock rows (one per branch) and costs go with the variants; the product row is audited on delete.
  delete from public.inventory_levels where tenant_id = p_tenant and variant_id in (select id from public.product_variants where tenant_id = p_tenant and product_id = p_product);
  delete from public.products where id = p_product and tenant_id = p_tenant;
end $$;

revoke execute on function public.product_has_history(uuid, uuid) from public, anon;
revoke execute on function public.delete_product(uuid, uuid) from public, anon;
grant execute on function public.product_has_history(uuid, uuid) to authenticated;
grant execute on function public.delete_product(uuid, uuid) to authenticated;

drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products for each row execute function private.audit_row();
