-- =============================================================================
-- Inventario: catalog by category kind, protected costs (weighted average), stock that never goes
-- negative, lots / expiry, idempotent movements, safe transfers (send → receive) and listing RPCs.
--
--   product      catalog reference shared by every branch of the company
--   variant      sellable combination (color, size, power…) with its own SKU / barcode
--   level        quantity of a variant in a branch (maintained ONLY by movements)
--   movement     immutable entry / exit; the trigger below validates and applies it
--   lot          quantity of a variant per branch and lot code, for products with track_lots
--
-- Stock rules (enforced here, never only in the UI):
--   · no movement may leave a branch (or a lot) below zero
--   · idempotency_key makes retries return the first movement instead of a second one
--   · cost = weighted average over the company's units (branches + in transit), updated by
--     purchases and initial loads that carry a unit cost; readable only with inventory.costs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permission: costs and margins
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values ('inventory.costs', 'inventory', 'Ver costos y márgenes')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select id, 'inventory.costs' from public.roles where tenant_id is null and code in ('OWNER', 'ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Categories: administrable, each one belongs to a kind that drives the product form
-- -----------------------------------------------------------------------------
alter table public.product_categories drop constraint if exists product_categories_code_check;
alter table public.product_categories
  add column if not exists kind text,
  add column if not exists is_active boolean not null default true,
  add column if not exists sort_order int not null default 100,
  add column if not exists created_at timestamptz not null default now();
update public.product_categories set kind = case code
    when 'frames' then 'frame' when 'sunglasses' then 'frame'
    when 'ophthalmic_lenses' then 'ophthalmic_lens' when 'contact_lenses' then 'contact_lens'
    when 'services' then 'service' else 'supply' end,
  sort_order = case code
    when 'frames' then 10 when 'sunglasses' then 20 when 'ophthalmic_lenses' then 30 when 'contact_lenses' then 40
    when 'solutions' then 50 when 'accessories' then 60 when 'services' then 70 else 90 end
where kind is null;
alter table public.product_categories alter column kind set not null;
alter table public.product_categories add constraint product_categories_kind_check
  check (kind in ('frame', 'ophthalmic_lens', 'contact_lens', 'supply', 'service'));
alter table public.product_categories add constraint product_categories_code_format check (code ~ '^[a-z0-9_-]{2,40}$');
create unique index if not exists product_categories_name_uq on public.product_categories (tenant_id, lower(name));

create or replace function private.seed_product_categories(p_tenant uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.product_categories (tenant_id, code, name, kind, sort_order) values
    (p_tenant, 'frames', 'Monturas', 'frame', 10), (p_tenant, 'sunglasses', 'Gafas de sol', 'frame', 20),
    (p_tenant, 'ophthalmic_lenses', 'Lentes oftálmicos', 'ophthalmic_lens', 30),
    (p_tenant, 'contact_lenses', 'Lentes de contacto', 'contact_lens', 40), (p_tenant, 'solutions', 'Soluciones', 'supply', 50),
    (p_tenant, 'accessories', 'Accesorios', 'supply', 60), (p_tenant, 'services', 'Servicios', 'service', 70),
    (p_tenant, 'other', 'Otros', 'supply', 90)
  on conflict do nothing
$$;

create policy categories_insert on public.product_categories for insert to authenticated with check (private.can_write(tenant_id, 'inventory.manage'));
create policy categories_update on public.product_categories for update to authenticated
  using (private.can_write(tenant_id, 'inventory.manage')) with check (private.can_write(tenant_id, 'inventory.manage'));
create trigger categories_audit after insert or update on public.product_categories for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Products and variants
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists unit text not null default 'unidad',
  add column if not exists default_min_stock numeric(12,2) not null default 1,
  add column if not exists track_lots boolean not null default false,
  add column if not exists idempotency_key text;
alter table public.products add constraint products_unit_check check (unit in ('unidad', 'par', 'caja', 'frasco', 'blister'));
alter table public.products add constraint products_min_stock_check check (default_min_stock >= 0);
alter table public.products add constraint products_name_check check (length(trim(name)) between 2 and 160);
create unique index if not exists products_idempotency_uq on public.products (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
update public.products p set track_lots = true
  from public.product_categories c where c.id = p.category_id and c.kind = 'contact_lens' and p.is_stocked;

alter table public.product_variants
  add column if not exists attributes jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists product_variants_sku_trgm on public.product_variants using gin (sku extensions.gin_trgm_ops);
-- The same product can't have two variants with the same color and attributes.
create unique index if not exists product_variants_attrs_uq on public.product_variants (product_id, lower(coalesce(color_name, '')), attributes);
create trigger product_variants_updated_at before update on public.product_variants for each row execute function private.set_updated_at();

-- SKU / barcode normalization; a blank SKU gets the next number of the category kind (MON-000001…).
create or replace function private.variant_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_prefix text;
begin
  new.sku := nullif(upper(trim(new.sku)), '');
  new.barcode := nullif(trim(new.barcode), '');
  if new.sku is null then
    select c.kind into v_kind from public.products p join public.product_categories c on c.id = p.category_id where p.id = new.product_id;
    v_prefix := case v_kind when 'frame' then 'MON' when 'ophthalmic_lens' then 'LEN' when 'contact_lens' then 'LC' when 'service' then 'SRV' else 'ACC' end;
    loop
      new.sku := private.next_number(new.tenant_id, 'sku_' || coalesce(v_kind, 'supply'), v_prefix);
      exit when not exists (select 1 from public.product_variants where tenant_id = new.tenant_id and sku = new.sku);
    end loop;
  end if;
  return new;
end $$;
create trigger product_variants_defaults before insert or update of sku, barcode on public.product_variants
  for each row execute function private.variant_defaults();

-- -----------------------------------------------------------------------------
-- Costs: separate table so the catalog can stay readable by every member.
-- -----------------------------------------------------------------------------
create table public.variant_costs (
  variant_id uuid primary key,
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  avg_cost   numeric(16,4) not null default 0 check (avg_cost >= 0),
  last_cost  numeric(14,2) check (last_cost is null or last_cost >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id) on delete cascade
);
insert into public.variant_costs (variant_id, tenant_id, avg_cost)
select id, tenant_id, cost from public.product_variants on conflict do nothing;
alter table public.product_variants drop column cost;

alter table public.variant_costs enable row level security;
revoke all on public.variant_costs from anon;
create policy variant_costs_select on public.variant_costs for select to authenticated using (private.has_permission(tenant_id, 'inventory.costs'));
create policy variant_costs_insert on public.variant_costs for insert to authenticated
  with check (private.can_write(tenant_id, 'inventory.costs') and private.can_write(tenant_id, 'inventory.manage'));
create policy variant_costs_update on public.variant_costs for update to authenticated
  using (private.can_write(tenant_id, 'inventory.costs') and private.can_write(tenant_id, 'inventory.manage'))
  with check (private.can_write(tenant_id, 'inventory.costs') and private.can_write(tenant_id, 'inventory.manage'));
create trigger variant_costs_audit after insert or update on public.variant_costs for each row execute function private.audit_row();

-- For RPCs run by people who sell but must not see costs (the sale still records its cost for margins).
create or replace function private.variant_cost(p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select avg_cost from public.variant_costs where variant_id = p_variant), 0)
$$;
revoke all on function private.variant_cost(uuid) from public, anon;
grant execute on function private.variant_cost(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lots and expiry
-- -----------------------------------------------------------------------------
create table public.inventory_lots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  branch_id  uuid not null,
  variant_id uuid not null,
  lot_code   text not null check (length(lot_code) between 1 and 60),
  expires_on date,
  quantity   numeric(12,2) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, variant_id, lot_code),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);
create index inventory_lots_expiry_idx on public.inventory_lots (tenant_id, expires_on) where quantity > 0;
alter table public.inventory_lots enable row level security;
revoke all on public.inventory_lots from anon;
-- Read-only for users: lots change only through movements.
create policy lots_select on public.inventory_lots for select to authenticated
  using (private.has_permission(tenant_id, 'inventory.read', branch_id) or private.has_permission(tenant_id, 'pos.use', branch_id));

-- -----------------------------------------------------------------------------
-- Movements
-- -----------------------------------------------------------------------------
alter table public.inventory_movements
  add column if not exists lot_code text,
  add column if not exists expires_on date,
  add column if not exists lot_allocations jsonb not null default '[]'::jsonb, -- [{lot_code, expires_on, quantity}] actually moved
  add column if not exists idempotency_key text;
create unique index if not exists inventory_movements_idempotency_uq on public.inventory_movements (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists inventory_movements_reference_idx on public.inventory_movements (reference_type, reference_id);

-- Unit costs live in movements too: direct reads need inventory.costs; everyone else uses
-- inventory_movement_history(), which hides the cost.
drop policy if exists movements_select on public.inventory_movements;
create policy movements_select on public.inventory_movements for select to authenticated
  using (private.has_permission(tenant_id, 'inventory.read', branch_id) and private.has_permission(tenant_id, 'inventory.costs'));

create or replace function private.apply_inventory_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_track boolean; v_stocked boolean; v_min numeric; v_name text;
  v_onhand numeric; v_avg numeric; v_new_qty numeric;
  v_need numeric; v_take numeric; v_alloc jsonb := '[]'::jsonb; v_lot record; v_lot_qty numeric; v_lot_exp date;
begin
  if new.type in ('sale','transfer_out','damage','loss') and new.quantity > 0 then new.quantity := -new.quantity; end if;
  if new.type in ('purchase','transfer_in','return','initial') and new.quantity < 0 then new.quantity := -new.quantity; end if;

  select p.track_lots, p.is_stocked, p.default_min_stock, p.name || coalesce(' · ' || v.color_name, '')
    into v_track, v_stocked, v_min, v_name
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = new.variant_id and v.tenant_id = new.tenant_id;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_stocked then raise exception 'PRODUCT_NOT_STOCKED' using errcode = 'P0001'; end if;

  -- Only people who may see costs can set one by hand (purchases bring the purchase-order cost).
  if new.unit_cost is not null and new.type in ('initial', 'adjustment') and auth.uid() is not null
     and not private.has_permission(new.tenant_id, 'inventory.costs') then
    raise exception 'COSTS_FORBIDDEN' using errcode = '42501';
  end if;

  -- Weighted average cost over every unit the company owns (branches + in transit).
  select avg_cost into v_avg from public.variant_costs where variant_id = new.variant_id for update;
  if new.quantity > 0 and new.type in ('purchase', 'initial') and new.unit_cost is not null then
    select coalesce(sum(quantity), 0) into v_onhand from public.inventory_levels where variant_id = new.variant_id;
    v_onhand := v_onhand + coalesce((
      select sum(ti.quantity) from public.inventory_transfer_items ti join public.inventory_transfers t on t.id = ti.transfer_id
       where ti.variant_id = new.variant_id and t.status = 'in_transit'), 0);
    v_avg := case when v_onhand <= 0 or v_avg is null or v_avg = 0 then new.unit_cost
                  else round((v_onhand * v_avg + new.quantity * new.unit_cost) / (v_onhand + new.quantity), 4) end;
    insert into public.variant_costs (tenant_id, variant_id, avg_cost, last_cost, updated_by)
    values (new.tenant_id, new.variant_id, v_avg, case when new.type = 'purchase' then new.unit_cost end, auth.uid())
    on conflict (variant_id) do update set avg_cost = excluded.avg_cost,
      last_cost = coalesce(excluded.last_cost, public.variant_costs.last_cost), updated_at = now(), updated_by = excluded.updated_by;
  end if;
  new.unit_cost := coalesce(new.unit_cost, v_avg);

  insert into public.inventory_levels (tenant_id, branch_id, variant_id, quantity, min_quantity)
  values (new.tenant_id, new.branch_id, new.variant_id, new.quantity, v_min)
  on conflict (branch_id, variant_id) do update set quantity = public.inventory_levels.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_new_qty;
  if new.quantity < 0 and v_new_qty < 0 then
    raise exception 'STOCK_INSUFFICIENT' using errcode = 'P0001', hint = 'No hay suficiente stock de ' || v_name || ' en esta sede.';
  end if;

  new.lot_code := nullif(upper(trim(new.lot_code)), '');
  if v_track then
    if new.quantity > 0 then
      if new.lot_code is null then
        -- Transfers and returns may bring units without a lot (stock recorded before lots were tracked).
        if new.type in ('purchase', 'initial', 'adjustment') then
          raise exception 'LOT_REQUIRED' using errcode = 'P0001', hint = v_name || ' maneja lotes: indica el lote.';
        end if;
      else
        insert into public.inventory_lots (tenant_id, branch_id, variant_id, lot_code, expires_on, quantity)
        values (new.tenant_id, new.branch_id, new.variant_id, new.lot_code, new.expires_on, new.quantity)
        on conflict (branch_id, variant_id, lot_code) do update
          set quantity = public.inventory_lots.quantity + excluded.quantity,
              expires_on = coalesce(public.inventory_lots.expires_on, excluded.expires_on), updated_at = now()
        returning expires_on into v_lot_exp;
        new.expires_on := v_lot_exp;
        new.lot_allocations := jsonb_build_array(jsonb_build_object('lot_code', new.lot_code, 'expires_on', v_lot_exp, 'quantity', new.quantity));
      end if;
    else
      v_need := -new.quantity;
      if new.lot_code is not null then
        update public.inventory_lots set quantity = quantity - v_need, updated_at = now()
         where branch_id = new.branch_id and variant_id = new.variant_id and lot_code = new.lot_code and quantity >= v_need
        returning quantity, expires_on into v_lot_qty, v_lot_exp;
        if not found then raise exception 'LOT_INSUFFICIENT' using errcode = 'P0001', hint = 'El lote ' || new.lot_code || ' no tiene suficientes unidades.'; end if;
        new.expires_on := v_lot_exp;
        new.lot_allocations := jsonb_build_array(jsonb_build_object('lot_code', new.lot_code, 'expires_on', v_lot_exp, 'quantity', v_need));
      else
        -- First expiry, first out. Sales skip expired lots; damage / loss may discard them.
        for v_lot in select l.id, l.lot_code, l.expires_on, l.quantity from public.inventory_lots l
                      where l.branch_id = new.branch_id and l.variant_id = new.variant_id and l.quantity > 0
                        and (new.type <> 'sale' or l.expires_on is null or l.expires_on >= current_date)
                      order by l.expires_on nulls last, l.created_at for update loop
          exit when v_need <= 0;
          v_take := least(v_lot.quantity, v_need);
          update public.inventory_lots set quantity = quantity - v_take, updated_at = now() where id = v_lot.id;
          v_alloc := v_alloc || jsonb_build_object('lot_code', v_lot.lot_code, 'expires_on', v_lot.expires_on, 'quantity', v_take);
          v_need := v_need - v_take;
        end loop;
        if v_need > 0 and new.type = 'sale' and exists (
          select 1 from public.inventory_lots l where l.branch_id = new.branch_id and l.variant_id = new.variant_id
             and l.quantity > 0 and l.expires_on < current_date) then
          raise exception 'LOT_EXPIRED' using errcode = 'P0001', hint = 'Las unidades disponibles de ' || v_name || ' están vencidas.';
        end if;
        new.lot_allocations := v_alloc;
      end if;
    end if;
  end if;
  return new;
end $$;

-- Minimum per branch (the level row may not exist yet: no movement so far).
create or replace function public.set_min_stock(p_tenant uuid, p_branch uuid, p_variant uuid, p_min numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_write(p_tenant, 'inventory.adjust', p_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_min is null or p_min < 0 or p_min > 99999 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.product_variants where id = p_variant and tenant_id = p_tenant)
     or not exists (select 1 from public.branches where id = p_branch and tenant_id = p_tenant) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.inventory_levels (tenant_id, branch_id, variant_id, quantity, min_quantity)
  values (p_tenant, p_branch, p_variant, 0, p_min)
  on conflict (branch_id, variant_id) do update set min_quantity = excluded.min_quantity, updated_at = now();
end $$;

-- Manual movements: initial load, adjustment (+/−), physical count, damage, loss.
-- p: { tenant_id, branch_id, variant_id, type: initial|adjustment|count|damage|loss, quantity?, counted?,
--      lot_code?, expires_on?, unit_cost?, notes, idempotency_key? }   → movement id (null: count without difference)
create or replace function public.record_movement(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_variant uuid := (p ->> 'variant_id')::uuid;
  v_type text := p ->> 'type';
  v_key text := nullif(p ->> 'idempotency_key', '');
  v_notes text := nullif(trim(p ->> 'notes'), '');
  v_qty numeric; v_counted numeric; v_current numeric; v_id uuid;
begin
  if v_type is null or v_type not in ('initial', 'adjustment', 'count', 'damage', 'loss') then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001';
  end if;
  if not private.can_write(v_tenant, 'inventory.adjust', v_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_notes is null or length(v_notes) < 3 then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v_key is not null then
    select id into v_id from public.inventory_movements where tenant_id = v_tenant and idempotency_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;

  if v_type = 'count' then
    v_counted := (p ->> 'counted')::numeric;
    if v_counted is null or v_counted < 0 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
    -- Lock the level so the difference is computed against a number nobody else is changing.
    select quantity into v_current from public.inventory_levels where branch_id = v_branch and variant_id = v_variant for update;
    v_qty := v_counted - coalesce(v_current, 0);
    if v_qty = 0 then return null; end if;
    v_type := 'adjustment';
    v_notes := 'Conteo físico: ' || trim_scale(v_counted) || ' contadas, había ' || trim_scale(coalesce(v_current, 0)) || '. ' || v_notes;
  else
    v_qty := (p ->> 'quantity')::numeric;
    if v_qty is null or v_qty = 0 or abs(v_qty) > 99999 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  end if;

  begin
    insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, lot_code, expires_on, notes, created_by, idempotency_key)
    values (v_tenant, v_branch, v_variant, v_type, v_qty, nullif(p ->> 'unit_cost', '')::numeric, nullif(p ->> 'lot_code', ''),
            nullif(p ->> 'expires_on', '')::date, v_notes, auth.uid(), v_key)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.inventory_movements where tenant_id = v_tenant and idempotency_key = v_key;
    if v_id is null then raise; end if;
  end;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Product create / update in one transaction (never touches stock on update)
-- p: { tenant_id, id?, category_id, brand?, name, model?, collection?, description?, tax_rate, is_stocked, unit,
--      default_min_stock, track_lots, is_active, attributes{}, idempotency_key?,
--      variants: [{ id?, sku?, barcode?, color_name?, color_hex?, image_url?, attributes{}, price, cost?, is_active }],
--      initial_stock?: [{ variant (index), branch_id, quantity, lot_code?, expires_on? }]  -- only when creating }
-- -----------------------------------------------------------------------------
create or replace function public.save_product(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_creating boolean := nullif(p ->> 'id', '') is null;
  v_costs boolean; v_brand uuid; v_brand_name text := nullif(trim(p ->> 'brand'), '');
  v_old_min numeric; v_min numeric := coalesce((p ->> 'default_min_stock')::numeric, 1);
  v_stocked boolean := coalesce((p ->> 'is_stocked')::boolean, true);
  v jsonb; s jsonb; v_vid uuid; v_ids uuid[] := '{}';
begin
  if not private.can_write(v_tenant, 'inventory.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_costs := private.has_permission(v_tenant, 'inventory.costs');
  if jsonb_array_length(coalesce(p -> 'variants', '[]'::jsonb)) = 0 then raise exception 'VARIANT_REQUIRED' using errcode = 'P0001'; end if;

  if v_creating and nullif(p ->> 'idempotency_key', '') is not null then
    select id into v_id from public.products where tenant_id = v_tenant and idempotency_key = p ->> 'idempotency_key';
    if v_id is not null then return v_id; end if;
  end if;
  if not exists (select 1 from public.product_categories where id = (p ->> 'category_id')::uuid and tenant_id = v_tenant) then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_brand_name is not null then
    select id into v_brand from public.brands where tenant_id = v_tenant and lower(name) = lower(v_brand_name);
    if v_brand is null then
      insert into public.brands (tenant_id, name) values (v_tenant, v_brand_name) returning id into v_brand;
    end if;
  end if;

  if v_creating then
    insert into public.products (tenant_id, category_id, brand_id, name, model, collection, description, tax_rate, is_stocked,
                                 unit, default_min_stock, track_lots, attributes, is_active, idempotency_key)
    values (v_tenant, (p ->> 'category_id')::uuid, v_brand, trim(p ->> 'name'), nullif(trim(p ->> 'model'), ''),
            nullif(trim(p ->> 'collection'), ''), nullif(trim(p ->> 'description'), ''), coalesce((p ->> 'tax_rate')::numeric, 19),
            v_stocked, coalesce(p ->> 'unit', 'unidad'), v_min, coalesce((p ->> 'track_lots')::boolean, false) and v_stocked,
            jsonb_strip_nulls(coalesce(p -> 'attributes', '{}'::jsonb)), coalesce((p ->> 'is_active')::boolean, true),
            nullif(p ->> 'idempotency_key', ''))
    returning id into v_id;
  else
    select default_min_stock into v_old_min from public.products where id = v_id and tenant_id = v_tenant for update;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if not v_stocked and exists (
      select 1 from public.inventory_levels l join public.product_variants pv on pv.id = l.variant_id
       where pv.product_id = v_id and l.quantity <> 0) then
      raise exception 'PRODUCT_HAS_STOCK' using errcode = 'P0001';
    end if;
    update public.products set
      category_id = (p ->> 'category_id')::uuid, brand_id = v_brand, name = trim(p ->> 'name'),
      model = nullif(trim(p ->> 'model'), ''), collection = nullif(trim(p ->> 'collection'), ''),
      description = nullif(trim(p ->> 'description'), ''), tax_rate = coalesce((p ->> 'tax_rate')::numeric, tax_rate),
      is_stocked = v_stocked, unit = coalesce(p ->> 'unit', unit), default_min_stock = v_min,
      track_lots = coalesce((p ->> 'track_lots')::boolean, track_lots) and v_stocked,
      -- Keys the form doesn't manage (showcase, tags…) are kept; form keys sent as null are removed.
      attributes = jsonb_strip_nulls(attributes || coalesce(p -> 'attributes', '{}'::jsonb)),
      is_active = coalesce((p ->> 'is_active')::boolean, is_active)
    where id = v_id;
    -- A new default minimum replaces it in the branches that still used the old default.
    if v_old_min is distinct from v_min then
      update public.inventory_levels l set min_quantity = v_min
        from public.product_variants pv where pv.id = l.variant_id and pv.product_id = v_id and l.min_quantity = v_old_min;
    end if;
  end if;

  for v in select * from jsonb_array_elements(p -> 'variants') loop
    v_vid := null;
    if nullif(v ->> 'id', '') is not null then
      update public.product_variants set
        sku = coalesce(nullif(upper(trim(v ->> 'sku')), ''), sku), barcode = nullif(trim(v ->> 'barcode'), ''),
        color_name = nullif(trim(v ->> 'color_name'), ''), color_hex = nullif(v ->> 'color_hex', ''),
        image_url = nullif(trim(v ->> 'image_url'), ''), attributes = jsonb_strip_nulls(coalesce(v -> 'attributes', '{}'::jsonb)),
        price = (v ->> 'price')::numeric, is_active = coalesce((v ->> 'is_active')::boolean, true)
      where id = (v ->> 'id')::uuid and product_id = v_id and tenant_id = v_tenant
      returning id into v_vid;
      if v_vid is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    else
      insert into public.product_variants (tenant_id, product_id, sku, barcode, color_name, color_hex, image_url, attributes, price, is_active)
      values (v_tenant, v_id, v ->> 'sku', v ->> 'barcode', nullif(trim(v ->> 'color_name'), ''), nullif(v ->> 'color_hex', ''),
              nullif(trim(v ->> 'image_url'), ''), jsonb_strip_nulls(coalesce(v -> 'attributes', '{}'::jsonb)),
              (v ->> 'price')::numeric, coalesce((v ->> 'is_active')::boolean, true))
      returning id into v_vid;
    end if;
    v_ids := v_ids || v_vid;

    if nullif(v ->> 'cost', '') is not null then
      if not v_costs then raise exception 'COSTS_FORBIDDEN' using errcode = '42501'; end if;
      insert into public.variant_costs (tenant_id, variant_id, avg_cost, updated_by)
      values (v_tenant, v_vid, (v ->> 'cost')::numeric, auth.uid())
      on conflict (variant_id) do update set avg_cost = excluded.avg_cost, updated_at = now(), updated_by = excluded.updated_by
        where public.variant_costs.avg_cost is distinct from excluded.avg_cost;
    end if;
  end loop;

  -- Initial stock: only while creating, always as 'initial' movements (date, user, branch, reason).
  if v_creating then
    for s in select * from jsonb_array_elements(coalesce(p -> 'initial_stock', '[]'::jsonb)) loop
      continue when coalesce((s ->> 'quantity')::numeric, 0) <= 0;
      if not private.can_write(v_tenant, 'inventory.adjust', (s ->> 'branch_id')::uuid) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, lot_code, expires_on, notes, created_by)
      values (v_tenant, (s ->> 'branch_id')::uuid, v_ids[(s ->> 'variant')::int + 1], 'initial', (s ->> 'quantity')::numeric,
              nullif(s ->> 'lot_code', ''), nullif(s ->> 'expires_on', '')::date, 'Existencia inicial al crear el producto', auth.uid());
    end loop;
  end if;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Sales use the protected cost (unchanged otherwise; the movement trigger now also blocks races to negative stock)
-- -----------------------------------------------------------------------------
create or replace function public.create_sale(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_sale uuid;
  it jsonb;
  v_vid uuid; v_vprice numeric; v_vcost numeric; v_label text; v_vrate numeric; v_stocked boolean; v_cat text;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric; v_line numeric; v_tax numeric;
  v_sub numeric := 0; v_disc_total numeric := 0; v_tax_total numeric := 0; v_total numeric := 0;
  v_stock numeric; i int := 0;
begin
  if not private.can_write(v_tenant, 'sales.create', v_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then raise exception 'SALE_EMPTY' using errcode = 'P0001'; end if;

  if p ->> 'idempotency_key' is not null then
    select id into v_sale from public.sales where tenant_id = v_tenant and idempotency_key = p ->> 'idempotency_key';
    if v_sale is not null then return v_sale; end if;
  end if;

  insert into public.sales (tenant_id, branch_id, patient_id, prescription_id, quote_id, seller_id, notes, idempotency_key)
  values (v_tenant, v_branch, nullif(p ->> 'patient_id', '')::uuid, nullif(p ->> 'prescription_id', '')::uuid,
          nullif(p ->> 'quote_id', '')::uuid, auth.uid(), nullif(p ->> 'notes', ''), p ->> 'idempotency_key')
  returning id into v_sale;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    i := i + 1;
    v_vid := null; v_vprice := null; v_vcost := null; v_label := null; v_vrate := null; v_stocked := false; v_cat := null;
    if it ->> 'variant_id' is not null then
      select pv.id, pv.price, private.variant_cost(pv.id), pr.name || coalesce(' · ' || pv.color_name, ''), pr.tax_rate, pr.is_stocked, c.name
        into v_vid, v_vprice, v_vcost, v_label, v_vrate, v_stocked, v_cat
        from public.product_variants pv join public.products pr on pr.id = pv.product_id join public.product_categories c on c.id = pr.category_id
       where pv.id = (it ->> 'variant_id')::uuid and pv.tenant_id = v_tenant;
      if v_vid is null then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
    end if;
    v_qty := coalesce((it ->> 'quantity')::numeric, 1);
    v_price := coalesce((it ->> 'unit_price')::numeric, v_vprice, 0);
    v_disc := coalesce((it ->> 'discount')::numeric, 0);
    v_rate := coalesce((it ->> 'tax_rate')::numeric, v_vrate, 19);
    if v_disc > 0 and not private.has_permission(v_tenant, 'sales.discount', v_branch) then
      raise exception 'DISCOUNT_FORBIDDEN' using errcode = '42501', hint = 'Necesitas permiso para aplicar descuentos.';
    end if;
    v_line := round(v_qty * v_price - v_disc, 2);
    if v_line < 0 then raise exception 'DISCOUNT_TOO_HIGH' using errcode = 'P0001'; end if;
    v_tax := private.line_tax(v_line, v_rate);

    insert into public.sale_items (tenant_id, sale_id, variant_id, description, category, quantity, unit_price, unit_cost, discount, tax_rate, line_total, tax_amount, sort_order)
    values (v_tenant, v_sale, v_vid, coalesce(nullif(it ->> 'description', ''), v_label, 'Ítem'), coalesce(it ->> 'category', v_cat),
            v_qty, v_price, coalesce(v_vcost, 0), v_disc, v_rate, v_line, v_tax, i);

    if v_vid is not null and v_stocked then
      select coalesce(quantity, 0) into v_stock from public.inventory_levels where branch_id = v_branch and variant_id = v_vid;
      if coalesce(v_stock, 0) < v_qty then
        raise exception 'STOCK_INSUFFICIENT' using errcode = 'P0001', hint = 'No hay suficiente stock de ' || v_label || ' en esta sede.';
      end if;
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, reference_type, reference_id, created_by)
      values (v_tenant, v_branch, v_vid, 'sale', v_qty, v_vcost, 'sale', v_sale, auth.uid());
    end if;

    v_sub := v_sub + v_qty * v_price; v_disc_total := v_disc_total + v_disc; v_tax_total := v_tax_total + v_tax; v_total := v_total + v_line;
  end loop;

  update public.sales set subtotal = v_sub, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total where id = v_sale;
  perform private.add_payments(v_tenant, v_sale, p -> 'payments');

  if p ->> 'quote_id' is not null then
    update public.quotes set status = 'converted', sale_id = v_sale where id = (p ->> 'quote_id')::uuid and tenant_id = v_tenant;
  end if;
  return v_sale;
end $$;

-- -----------------------------------------------------------------------------
-- Purchases: receiving is the moment stock grows. Lots per line and a retry key.
-- p_items: [{ item_id, quantity, lot_code?, expires_on? }]
-- -----------------------------------------------------------------------------
drop function if exists public.receive_purchase_order(uuid, jsonb);
create or replace function public.receive_purchase_order(p_order uuid, p_items jsonb, p_key text default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare po public.purchase_orders; it record; pending numeric;
begin
  select * into po from public.purchase_orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not private.can_write(po.tenant_id, 'purchases.approve', po.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_key is not null and exists (
    select 1 from jsonb_array_elements(p_items) x join public.inventory_movements m
      on m.tenant_id = po.tenant_id and m.idempotency_key = 'po:' || p_key || ':' || (x ->> 'item_id')) then
    return po.status;
  end if;
  if po.status in ('received', 'cancelled', 'draft') then raise exception 'PO_NOT_RECEIVABLE' using errcode = 'P0001'; end if;

  for it in select i.*, (x ->> 'quantity')::numeric as qty, nullif(x ->> 'lot_code', '') as lot_code, nullif(x ->> 'expires_on', '')::date as expires_on
            from jsonb_array_elements(p_items) x
            join public.purchase_order_items i on i.id = (x ->> 'item_id')::uuid and i.purchase_order_id = p_order loop
    if it.qty <= 0 then continue; end if;
    if it.received_quantity + it.qty > it.quantity then raise exception 'PO_OVER_RECEIVED' using errcode = 'P0001'; end if;
    update public.purchase_order_items set received_quantity = received_quantity + it.qty where id = it.id;
    insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, lot_code, expires_on,
                                            reference_type, reference_id, created_by, idempotency_key)
    values (po.tenant_id, po.branch_id, it.variant_id, 'purchase', it.qty, it.unit_cost, it.lot_code, it.expires_on,
            'purchase_order', po.id, auth.uid(), case when p_key is not null then 'po:' || p_key || ':' || it.id end);
  end loop;

  select coalesce(sum(quantity - received_quantity), 0) into pending from public.purchase_order_items where purchase_order_id = p_order;
  update public.purchase_orders set status = case when pending = 0 then 'received' else 'partially_received' end where id = p_order;
  return case when pending = 0 then 'received' else 'partially_received' end;
end $$;

-- -----------------------------------------------------------------------------
-- Transfers: send (leaves origin, in transit) → receive (enters destination) | cancel (returns to origin)
-- -----------------------------------------------------------------------------
alter table public.inventory_transfers
  add column if not exists idempotency_key text,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by uuid references public.profiles(id),
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text;
create unique index if not exists inventory_transfers_idempotency_uq on public.inventory_transfers (tenant_id, idempotency_key) where idempotency_key is not null;
create index if not exists inventory_transfers_status_idx on public.inventory_transfers (tenant_id, status, created_at desc);
create trigger transfers_audit after insert or update on public.inventory_transfers for each row execute function private.audit_row();

-- Status only changes inside the RPCs below (they move the stock); branches never change.
create or replace function private.guard_transfer()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'requested';
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'requested' then raise exception 'TRANSFER_LOCKED' using errcode = 'P0001'; end if;
    return old;
  end if;
  if new.from_branch_id <> old.from_branch_id or new.to_branch_id <> old.to_branch_id or new.tenant_id <> old.tenant_id then
    raise exception 'TRANSFER_LOCKED' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('app.inventory_rpc', true), '') <> 'on' then
    raise exception 'TRANSFER_RPC_ONLY' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger inventory_transfers_guard before insert or update or delete on public.inventory_transfers
  for each row execute function private.guard_transfer();

-- Lines can't change once the transfer was sent.
create or replace function private.guard_transfer_items()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.inventory_transfers where id = coalesce(new.transfer_id, old.transfer_id);
  if v_status is distinct from 'requested' then raise exception 'TRANSFER_LOCKED' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end $$;
create trigger inventory_transfer_items_guard before insert or update or delete on public.inventory_transfer_items
  for each row execute function private.guard_transfer_items();

create or replace function private.set_transfer_status(p_transfer uuid, p_status text, p_reason text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('app.inventory_rpc', 'on', true);
  update public.inventory_transfers set status = p_status,
    sent_at = case when p_status = 'in_transit' then now() else sent_at end,
    sent_by = case when p_status = 'in_transit' then auth.uid() else sent_by end,
    received_at = case when p_status = 'received' then now() else received_at end,
    received_by = case when p_status = 'received' then auth.uid() else received_by end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancel_reason = case when p_status = 'cancelled' then p_reason else cancel_reason end
  where id = p_transfer;
  perform set_config('app.inventory_rpc', '', true);
end $$;

create or replace function private.send_transfer(p_transfer uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare t public.inventory_transfers; it record; n int := 0;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if t.status not in ('requested', 'approved') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if not private.can_write(t.tenant_id, 'inventory.transfer', t.from_branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  for it in select variant_id, quantity from public.inventory_transfer_items where transfer_id = p_transfer loop
    -- The movement trigger checks availability at the origin and picks the lots (first expiry, first out).
    insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, reference_type, reference_id, created_by)
    values (t.tenant_id, t.from_branch_id, it.variant_id, 'transfer_out', it.quantity, 'transfer', t.id, auth.uid());
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'TRANSFER_EMPTY' using errcode = 'P0001'; end if;
  perform private.set_transfer_status(p_transfer, 'in_transit');
end $$;

-- Puts the units that left the origin into p_branch, lot by lot, at the cost they left with.
-- security definer: the caller already checked permission; movement rows with costs aren't readable by everyone.
create or replace function private.land_transfer(p_transfer uuid, p_branch uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m record; a jsonb; v_rest numeric;
begin
  for m in select * from public.inventory_movements where reference_type = 'transfer' and reference_id = p_transfer and type = 'transfer_out' loop
    v_rest := -m.quantity;
    for a in select * from jsonb_array_elements(m.lot_allocations) loop
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, lot_code, expires_on, reference_type, reference_id, notes, created_by)
      values (m.tenant_id, p_branch, m.variant_id, 'transfer_in', (a ->> 'quantity')::numeric, m.unit_cost, a ->> 'lot_code',
              nullif(a ->> 'expires_on', '')::date, 'transfer', p_transfer, p_notes, auth.uid());
      v_rest := v_rest - (a ->> 'quantity')::numeric;
    end loop;
    if v_rest > 0 then
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, reference_type, reference_id, notes, created_by)
      values (m.tenant_id, p_branch, m.variant_id, 'transfer_in', v_rest, m.unit_cost, 'transfer', p_transfer, p_notes, auth.uid());
    end if;
  end loop;
end $$;
revoke all on function private.land_transfer(uuid, uuid, text) from public, anon;
grant execute on function private.land_transfer(uuid, uuid, text) to authenticated;

-- p: { tenant_id, from_branch_id, to_branch_id, notes?, idempotency_key?, items: [{ variant_id, quantity }] } → transfer id (already in transit)
create or replace function public.create_transfer(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_from uuid := (p ->> 'from_branch_id')::uuid;
  v_to uuid := (p ->> 'to_branch_id')::uuid;
  v_key text := nullif(p ->> 'idempotency_key', '');
  v_id uuid;
begin
  if not private.can_write(v_tenant, 'inventory.transfer', v_from) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_from = v_to then raise exception 'TRANSFER_SAME_BRANCH' using errcode = 'P0001'; end if;
  if v_key is not null then
    select id into v_id from public.inventory_transfers where tenant_id = v_tenant and idempotency_key = v_key;
    if v_id is not null then return v_id; end if;
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) x where (x ->> 'quantity')::numeric > 0) then
    raise exception 'TRANSFER_EMPTY' using errcode = 'P0001';
  end if;

  insert into public.inventory_transfers (tenant_id, number, from_branch_id, to_branch_id, notes, requested_by, idempotency_key)
  values (v_tenant, '', v_from, v_to, nullif(trim(p ->> 'notes'), ''), auth.uid(), v_key)
  returning id into v_id;
  insert into public.inventory_transfer_items (tenant_id, transfer_id, variant_id, quantity)
  select v_tenant, v_id, (x ->> 'variant_id')::uuid, sum((x ->> 'quantity')::numeric)
    from jsonb_array_elements(p -> 'items') x where (x ->> 'quantity')::numeric > 0
   group by (x ->> 'variant_id')::uuid;
  perform private.send_transfer(v_id);
  return v_id;
end $$;

create or replace function public.receive_transfer(p_transfer uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.inventory_transfers;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if t.status = 'received' then return 'received'; end if; -- retry
  if t.status <> 'in_transit' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if not private.can_write(t.tenant_id, 'inventory.transfer', t.to_branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform private.land_transfer(p_transfer, t.to_branch_id);
  perform private.set_transfer_status(p_transfer, 'received');
  return 'received';
end $$;

create or replace function public.cancel_transfer(p_transfer uuid, p_reason text default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.inventory_transfers;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if t.status = 'cancelled' then return 'cancelled'; end if;
  if t.status = 'received' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  if not private.can_write(t.tenant_id, 'inventory.transfer', t.from_branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if t.status = 'in_transit' then
    perform private.land_transfer(p_transfer, t.from_branch_id, 'Devuelto a la sede de origen por cancelación del traslado');
  end if;
  perform private.set_transfer_status(p_transfer, 'cancelled', nullif(trim(p_reason), ''));
  return 'cancelled';
end $$;

-- Older clients / transfers created before this migration.
create or replace function public.advance_transfer(p_transfer uuid, p_status text)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.inventory_transfers;
begin
  case p_status
    when 'in_transit' then perform private.send_transfer(p_transfer);
    when 'received' then perform public.receive_transfer(p_transfer);
    when 'cancelled' then perform public.cancel_transfer(p_transfer, null);
    when 'approved' then
      select * into t from public.inventory_transfers where id = p_transfer for update;
      if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
      if t.status <> 'requested' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
      if not private.can_write(t.tenant_id, 'inventory.transfer', t.from_branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
      perform private.set_transfer_status(p_transfer, 'approved');
    else raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end case;
  return p_status;
end $$;

-- -----------------------------------------------------------------------------
-- Reading: one stock definition shared by the inventory screens and the dashboard
--   quantity      units in the branches in scope (all the caller may read, or one)
--   min_quantity  sum of each branch's minimum (configured, or the product default)
--   in_transit    units travelling towards the branches in scope
--   status        out: ≤ 0 · low: above 0 and at or under the minimum · ok
-- -----------------------------------------------------------------------------
create or replace function public.inventory_stock(p_tenant uuid, p_branch uuid default null)
returns table (variant_id uuid, quantity numeric, min_quantity numeric, in_transit numeric, branches jsonb)
language sql stable security invoker set search_path = '' as $$
  with scope as (
    select b.id, b.name from public.branches b
     where b.tenant_id = p_tenant and (p_branch is null or b.id = p_branch)
       and private.has_permission(p_tenant, 'inventory.read', b.id)
       and (b.status = 'active' or exists (select 1 from public.inventory_levels l where l.branch_id = b.id and l.quantity <> 0))
  ),
  cells as (
    select v.id as variant_id, s.id as branch_id, s.name as branch_name,
           coalesce(l.quantity, 0) as qty, coalesce(l.min_quantity, p.default_min_stock) as min_qty
      from public.product_variants v
      join public.products p on p.id = v.product_id and p.is_stocked
      cross join scope s
      left join public.inventory_levels l on l.variant_id = v.id and l.branch_id = s.id
     where v.tenant_id = p_tenant
  ),
  transit as (
    select ti.variant_id, sum(ti.quantity) as qty
      from public.inventory_transfer_items ti join public.inventory_transfers t on t.id = ti.transfer_id
     where t.tenant_id = p_tenant and t.status = 'in_transit' and t.to_branch_id in (select id from scope)
     group by ti.variant_id
  )
  select c.variant_id, sum(c.qty), sum(c.min_qty), coalesce(max(tr.qty), 0),
         jsonb_agg(jsonb_build_object('branch_id', c.branch_id, 'name', c.branch_name, 'quantity', c.qty, 'min', c.min_qty) order by c.branch_name)
    from cells c left join transit tr on tr.variant_id = c.variant_id
   group by c.variant_id
$$;

-- p_status: active | inactive | all · p_availability: available (units > 0) | low | out | null
create or replace function public.inventory_list(
  p_tenant uuid, p_branch uuid default null, p_query text default null, p_category uuid default null, p_brand uuid default null,
  p_status text default 'active', p_availability text default null, p_limit int default 25, p_offset int default 0)
returns table (variant_id uuid, product_id uuid, product_name text, model text, brand text, category text, category_kind text,
  sku text, barcode text, color_name text, color_hex text, attributes jsonb, image_url text, unit text, is_stocked boolean,
  track_lots boolean, price numeric, cost numeric, quantity numeric, min_quantity numeric, in_transit numeric, branches jsonb,
  stock_status text, is_active boolean, next_expiry date, total_count bigint)
language sql stable security invoker set search_path = '' as $$
  with q as (select nullif(trim(p_query), '') as t),
  base as (
    select v.id as variant_id, p.id as product_id, p.name as product_name, p.model, b.name as brand, c.name as category,
           c.kind as category_kind, v.sku, v.barcode, v.color_name, v.color_hex, v.attributes, v.image_url, p.unit, p.is_stocked,
           p.track_lots, v.price, vc.avg_cost as cost, s.quantity, s.min_quantity, s.in_transit, s.branches,
           case when not p.is_stocked then 'na' when coalesce(s.quantity, 0) <= 0 then 'out'
                when s.quantity <= s.min_quantity then 'low' else 'ok' end as stock_status,
           (v.is_active and p.is_active) as is_active
      from public.product_variants v
      join public.products p on p.id = v.product_id
      join public.product_categories c on c.id = p.category_id
      left join public.brands b on b.id = p.brand_id
      left join public.variant_costs vc on vc.variant_id = v.id
      left join public.inventory_stock(p_tenant, p_branch) s on s.variant_id = v.id
      cross join q
     where v.tenant_id = p_tenant
       and (p_category is null or p.category_id = p_category)
       and (p_brand is null or p.brand_id = p_brand)
       and (coalesce(p_status, 'active') = 'all' or ((p_status = 'active') = (v.is_active and p.is_active)))
       and (q.t is null or p.name ilike '%' || q.t || '%' or v.sku ilike '%' || q.t || '%' or v.barcode = q.t
            or p.model ilike '%' || q.t || '%' or b.name ilike '%' || q.t || '%' or c.name ilike '%' || q.t || '%'
            or v.color_name ilike '%' || q.t || '%')
  ),
  filtered as (
    select * from base
     where p_availability is null
        or (p_availability = 'available' and base.stock_status in ('ok', 'low'))
        or base.stock_status = p_availability
  )
  select f.variant_id, f.product_id, f.product_name, f.model, f.brand, f.category, f.category_kind, f.sku, f.barcode, f.color_name,
         f.color_hex, f.attributes, f.image_url, f.unit, f.is_stocked, f.track_lots, f.price, f.cost, f.quantity, f.min_quantity,
         f.in_transit, f.branches, f.stock_status, f.is_active,
         (select min(l.expires_on) from public.inventory_lots l
           where l.variant_id = f.variant_id and l.quantity > 0 and (p_branch is null or l.branch_id = p_branch)),
         count(*) over ()
    from filtered f
   order by f.product_name, f.color_name nulls first, f.sku
   limit least(coalesce(p_limit, 25), 100) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.inventory_summary(p_tenant uuid, p_branch uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with perm as (select private.has_permission(p_tenant, 'inventory.costs') as costs),
  s as (
    select p.is_stocked, (v.is_active and p.is_active) as active, coalesce(st.quantity, 0) as quantity,
           coalesce(st.min_quantity, 0) as min_quantity, coalesce(st.in_transit, 0) as in_transit, vc.avg_cost
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.inventory_stock(p_tenant, p_branch) st on st.variant_id = v.id
      left join public.variant_costs vc on vc.variant_id = v.id
     where v.tenant_id = p_tenant
  ),
  lots as (
    select l.expires_on from public.inventory_lots l
     where l.tenant_id = p_tenant and l.quantity > 0 and l.expires_on is not null and (p_branch is null or l.branch_id = p_branch)
  )
  select jsonb_build_object(
    'active_refs', count(*) filter (where active),
    'stocked_refs', count(*) filter (where active and is_stocked),
    'units', coalesce(sum(quantity) filter (where is_stocked and quantity > 0), 0),
    'in_transit', coalesce(sum(in_transit) filter (where is_stocked), 0),
    'low', count(*) filter (where active and is_stocked and quantity > 0 and quantity <= min_quantity),
    'out', count(*) filter (where active and is_stocked and quantity <= 0),
    'can_see_costs', (select costs from perm),
    'value', case when (select costs from perm) then coalesce(sum(quantity * coalesce(avg_cost, 0)) filter (where is_stocked and quantity > 0), 0) end,
    'uncosted', case when (select costs from perm) then count(*) filter (where is_stocked and quantity > 0 and coalesce(avg_cost, 0) = 0) end,
    'expiring', (select count(*) from lots where expires_on between current_date and current_date + 60),
    'expired', (select count(*) from lots where expires_on < current_date),
    'transfers_in_transit', (select count(*) from public.inventory_transfers t where t.tenant_id = p_tenant and t.status = 'in_transit'
                               and (p_branch is null or t.to_branch_id = p_branch or t.from_branch_id = p_branch))
  ) from s
$$;

-- Movement history for anyone with inventory.read in the branch; the unit cost only with inventory.costs.
create or replace function public.inventory_movement_history(
  p_tenant uuid, p_branch uuid default null, p_product uuid default null, p_variant uuid default null, p_type text default null,
  p_before timestamptz default null, p_before_id uuid default null, p_limit int default 50)
returns table (id uuid, created_at timestamptz, type text, quantity numeric, unit_cost numeric, branch_id uuid, branch_name text,
  variant_id uuid, sku text, product_id uuid, product_name text, color_name text, variant_attributes jsonb, lot_code text,
  expires_on date, lot_allocations jsonb, notes text, reference_type text, reference_id uuid, reference_label text, author_name text)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select b.id, b.name from public.branches b
     where b.tenant_id = p_tenant and private.has_permission(p_tenant, 'inventory.read', b.id) and (p_branch is null or b.id = p_branch)
  ),
  perm as (select private.has_permission(p_tenant, 'inventory.costs') as costs)
  select m.id, m.created_at, m.type, m.quantity, case when (select costs from perm) then m.unit_cost end,
         m.branch_id, a.name, m.variant_id, v.sku, p.id, p.name, v.color_name, v.attributes, m.lot_code, m.expires_on,
         m.lot_allocations, m.notes, m.reference_type, m.reference_id,
         case m.reference_type
           when 'sale' then (select s.number from public.sales s where s.id = m.reference_id)
           when 'purchase_order' then (select po.number from public.purchase_orders po where po.id = m.reference_id)
           when 'transfer' then (select t.number from public.inventory_transfers t where t.id = m.reference_id) end,
         pr.full_name
    from public.inventory_movements m
    join allowed a on a.id = m.branch_id
    join public.product_variants v on v.id = m.variant_id
    join public.products p on p.id = v.product_id
    left join public.profiles pr on pr.id = m.created_by
   where m.tenant_id = p_tenant
     and (p_product is null or p.id = p_product)
     and (p_variant is null or m.variant_id = p_variant)
     and (p_type is null or m.type = p_type
          or (p_type = 'transfer' and m.type in ('transfer_in', 'transfer_out'))
          or (p_type = 'damage_loss' and m.type in ('damage', 'loss')))
     and (p_before is null or (m.created_at, m.id) < (p_before, p_before_id))
   order by m.created_at desc, m.id desc
   limit least(coalesce(p_limit, 50), 200)
$$;

-- Older screens: same signature, cost now from the protected table (null without inventory.costs).
create or replace function public.inventory_overview(p_tenant uuid, p_branch uuid default null, p_query text default null)
returns table (variant_id uuid, product_id uuid, product_name text, category text, brand text, sku text, color_name text, color_hex text,
               image_url text, price numeric, cost numeric, quantity numeric, min_quantity numeric, is_low boolean)
language sql stable security invoker set search_path = '' as $$
  select l.variant_id, l.product_id, l.product_name, l.category, l.brand, l.sku, l.color_name, l.color_hex, l.image_url, l.price, l.cost,
         coalesce(l.quantity, 0), coalesce(l.min_quantity, 0), l.stock_status in ('low', 'out')
    from public.inventory_list(p_tenant, p_branch, p_query, null, null, 'active', null, 100, 0) l
   where l.is_stocked
$$;

revoke all on function public.set_min_stock(uuid, uuid, uuid, numeric), public.record_movement(jsonb), public.save_product(jsonb),
  public.receive_purchase_order(uuid, jsonb, text), public.create_transfer(jsonb), public.receive_transfer(uuid),
  public.cancel_transfer(uuid, text), public.inventory_stock(uuid, uuid),
  public.inventory_list(uuid, uuid, text, uuid, uuid, text, text, int, int), public.inventory_summary(uuid, uuid),
  public.inventory_movement_history(uuid, uuid, uuid, uuid, text, timestamptz, uuid, int) from public, anon;
grant execute on function public.set_min_stock(uuid, uuid, uuid, numeric), public.record_movement(jsonb), public.save_product(jsonb),
  public.receive_purchase_order(uuid, jsonb, text), public.create_transfer(jsonb), public.receive_transfer(uuid),
  public.cancel_transfer(uuid, text), public.inventory_stock(uuid, uuid),
  public.inventory_list(uuid, uuid, text, uuid, uuid, text, text, int, int), public.inventory_summary(uuid, uuid),
  public.inventory_movement_history(uuid, uuid, uuid, uuid, text, timestamptz, uuid, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Dashboard: same stock definition as the inventory screen (body copied from …014, only the stock CTE changes)
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

