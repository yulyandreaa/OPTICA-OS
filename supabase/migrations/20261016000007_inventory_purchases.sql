-- =============================================================================
-- Phase 04 — Catalog, stock per branch (immutable movements), transfers, suppliers, purchases.
-- Stock is NEVER updated directly: every change is an inventory_movement; a trigger
-- maintains inventory_levels.
-- =============================================================================

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (code in ('frames','ophthalmic_lenses','contact_lenses','solutions','accessories','sunglasses','services','other')),
  name text not null,
  unique (tenant_id, code),
  unique (id, tenant_id)
);

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  category_id   uuid not null,
  brand_id      uuid,
  name          text not null,
  model         text,
  collection    text,
  description   text,
  tax_rate      numeric(5,2) not null default 19 check (tax_rate in (0, 5, 19)),
  is_stocked    boolean not null default true,  -- services / lens fabrication are not stocked
  attributes    jsonb not null default '{}'::jsonb, -- material, shape, gender, lens, bridge, temple, tags[]
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (category_id, tenant_id) references public.product_categories(id, tenant_id),
  foreign key (brand_id, tenant_id) references public.brands(id, tenant_id)
);
create index products_tenant_idx on public.products (tenant_id, name);

create table public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null,
  sku        text not null,
  barcode    text,
  color_name text,
  color_hex  text check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$'),
  image_url  text,
  stage_top  text,
  stage_bottom text,
  cost       numeric(14,2) not null default 0 check (cost >= 0),
  price      numeric(14,2) not null check (price >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (id, tenant_id),
  foreign key (product_id, tenant_id) references public.products(id, tenant_id) on delete cascade
);
create unique index product_variants_barcode_uq on public.product_variants (tenant_id, barcode) where barcode is not null;

create table public.inventory_levels (
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  branch_id    uuid not null,
  variant_id   uuid not null,
  quantity     numeric(12,2) not null default 0,
  min_quantity numeric(12,2) not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (branch_id, variant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);
create index inventory_levels_tenant_idx on public.inventory_levels (tenant_id, branch_id);

create table public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  branch_id      uuid not null,
  variant_id     uuid not null,
  type           text not null check (type in ('initial','purchase','sale','return','adjustment','transfer_out','transfer_in','damage','loss')),
  quantity       numeric(12,2) not null check (quantity <> 0), -- signed: + in, − out
  unit_cost      numeric(14,2),
  reference_type text,
  reference_id   uuid,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);
create index inventory_movements_idx on public.inventory_movements (tenant_id, branch_id, created_at desc);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);

create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function private.forbid_mutation();

create or replace function private.apply_inventory_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type in ('sale','transfer_out','damage','loss') and new.quantity > 0 then new.quantity := -new.quantity; end if;
  if new.type in ('purchase','transfer_in','return','initial') and new.quantity < 0 then new.quantity := -new.quantity; end if;
  insert into public.inventory_levels (tenant_id, branch_id, variant_id, quantity)
  values (new.tenant_id, new.branch_id, new.variant_id, new.quantity)
  on conflict (branch_id, variant_id) do update set quantity = public.inventory_levels.quantity + excluded.quantity, updated_at = now();
  return new;
end $$;
create trigger inventory_movements_apply before insert on public.inventory_movements
  for each row execute function private.apply_inventory_movement();

-- Levels are maintained only by the trigger above.
create or replace function private.guard_levels()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.quantity is distinct from old.quantity and current_user not in ('postgres', 'service_role')
     and pg_trigger_depth() < 2 then
    raise exception 'STOCK_DIRECT_EDIT_FORBIDDEN' using errcode = '42501', hint = 'Registra un movimiento de inventario.';
  end if;
  return new;
end $$;
create trigger inventory_levels_guard before update on public.inventory_levels for each row execute function private.guard_levels();

-- Transfers between branches: requested → approved → in_transit → received | cancelled
create table public.inventory_transfers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  number         text not null,
  from_branch_id uuid not null,
  to_branch_id   uuid not null,
  status         text not null default 'requested' check (status in ('requested','approved','in_transit','received','cancelled')),
  notes          text,
  requested_by   uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (from_branch_id <> to_branch_id),
  unique (id, tenant_id),
  foreign key (from_branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (to_branch_id, tenant_id) references public.branches(id, tenant_id)
);
create table public.inventory_transfer_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  transfer_id uuid not null,
  variant_id  uuid not null,
  quantity    numeric(12,2) not null check (quantity > 0),
  foreign key (transfer_id, tenant_id) references public.inventory_transfers(id, tenant_id) on delete cascade,
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);

-- Suppliers & purchases
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  name           text not null,
  tax_id         text,
  contact_name   text,
  email          extensions.citext,
  phone          text,
  address        text,
  brands         text[] not null default '{}',
  payment_terms  text,
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  branch_id   uuid not null,
  supplier_id uuid not null,
  number      text not null,
  status      text not null default 'draft' check (status in ('draft','sent','approved','partially_received','received','cancelled')),
  expected_at date,
  notes       text,
  total       numeric(14,2) not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, number),
  unique (id, tenant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (supplier_id, tenant_id) references public.suppliers(id, tenant_id)
);
create table public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  purchase_order_id uuid not null,
  variant_id        uuid not null,
  quantity          numeric(12,2) not null check (quantity > 0),
  received_quantity numeric(12,2) not null default 0 check (received_quantity >= 0),
  unit_cost         numeric(14,2) not null check (unit_cost >= 0),
  foreign key (purchase_order_id, tenant_id) references public.purchase_orders(id, tenant_id) on delete cascade,
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);

create or replace function private.doc_number_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.number is null or new.number = '' then
    new.number := private.next_number(new.tenant_id, tg_argv[0], tg_argv[1]);
  end if;
  return new;
end $$;
create trigger purchase_orders_number before insert on public.purchase_orders for each row execute function private.doc_number_defaults('purchase_order', 'OC');
create trigger transfers_number before insert on public.inventory_transfers for each row execute function private.doc_number_defaults('transfer', 'TR');

create trigger products_updated_at before update on public.products for each row execute function private.set_updated_at();
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute function private.set_updated_at();
create trigger transfers_updated_at before update on public.inventory_transfers for each row execute function private.set_updated_at();
create trigger products_audit after insert or update on public.products for each row execute function private.audit_row();
create trigger variants_audit after insert or update on public.product_variants for each row execute function private.audit_row();
create trigger movements_audit after insert on public.inventory_movements for each row execute function private.audit_row();
create trigger purchase_orders_audit after insert or update on public.purchase_orders for each row execute function private.audit_row();

-- Default categories per tenant (existing + future tenants)
create or replace function private.seed_product_categories(p_tenant uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.product_categories (tenant_id, code, name) values
    (p_tenant, 'frames', 'Monturas'), (p_tenant, 'ophthalmic_lenses', 'Lentes oftálmicos'),
    (p_tenant, 'contact_lenses', 'Lentes de contacto'), (p_tenant, 'solutions', 'Soluciones'),
    (p_tenant, 'accessories', 'Accesorios'), (p_tenant, 'sunglasses', 'Gafas de sol'),
    (p_tenant, 'services', 'Servicios'), (p_tenant, 'other', 'Otros')
  on conflict do nothing
$$;
create or replace function private.tenant_categories_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.seed_product_categories(new.id); return new; end $$;
create trigger tenants_seed_categories after insert on public.tenants for each row execute function private.tenant_categories_trigger();
select private.seed_product_categories(id) from public.tenants;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.brands enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_levels enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_transfers enable row level security;
alter table public.inventory_transfer_items enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
revoke all on public.brands, public.product_categories, public.products, public.product_variants, public.inventory_levels,
  public.inventory_movements, public.inventory_transfers, public.inventory_transfer_items, public.suppliers,
  public.purchase_orders, public.purchase_order_items from anon;

-- Catalog is readable by anyone who can sell or see inventory.
create policy brands_select on public.brands for select to authenticated using (private.is_member(tenant_id));
create policy brands_write on public.brands for all to authenticated using (private.can_write(tenant_id, 'inventory.manage')) with check (private.can_write(tenant_id, 'inventory.manage'));
create policy categories_select on public.product_categories for select to authenticated using (private.is_member(tenant_id));
create policy products_select on public.products for select to authenticated using (private.is_member(tenant_id));
create policy products_write on public.products for all to authenticated using (private.can_write(tenant_id, 'inventory.manage')) with check (private.can_write(tenant_id, 'inventory.manage'));
create policy variants_select on public.product_variants for select to authenticated using (private.is_member(tenant_id));
create policy variants_write on public.product_variants for all to authenticated using (private.can_write(tenant_id, 'inventory.manage')) with check (private.can_write(tenant_id, 'inventory.manage'));

create policy levels_select on public.inventory_levels for select to authenticated
  using (private.has_permission(tenant_id, 'inventory.read', branch_id) or private.has_permission(tenant_id, 'pos.use', branch_id));
create policy levels_min on public.inventory_levels for update to authenticated
  using (private.can_write(tenant_id, 'inventory.adjust', branch_id)) with check (private.can_write(tenant_id, 'inventory.adjust', branch_id));

create policy movements_select on public.inventory_movements for select to authenticated
  using (private.has_permission(tenant_id, 'inventory.read', branch_id));
-- Manual movements: adjustments need inventory.adjust; sales/purchases go through RPCs that check their own permission.
create policy movements_insert on public.inventory_movements for insert to authenticated
  with check (
    (type in ('adjustment','damage','loss','initial') and private.can_write(tenant_id, 'inventory.adjust', branch_id))
    or (type = 'sale' and private.can_write(tenant_id, 'sales.create', branch_id))
    or (type = 'return' and private.can_write(tenant_id, 'sales.refund', branch_id))
    or (type = 'purchase' and private.can_write(tenant_id, 'purchases.approve', branch_id))
    or (type in ('transfer_out','transfer_in') and private.can_write(tenant_id, 'inventory.transfer', branch_id))
  );

create policy transfers_select on public.inventory_transfers for select to authenticated
  using (private.has_permission(tenant_id, 'inventory.read', from_branch_id) or private.has_permission(tenant_id, 'inventory.read', to_branch_id));
create policy transfers_write on public.inventory_transfers for all to authenticated
  using (private.can_write(tenant_id, 'inventory.transfer')) with check (private.can_write(tenant_id, 'inventory.transfer'));
create policy transfer_items_select on public.inventory_transfer_items for select to authenticated using (private.has_permission(tenant_id, 'inventory.read'));
create policy transfer_items_write on public.inventory_transfer_items for all to authenticated
  using (private.can_write(tenant_id, 'inventory.transfer')) with check (private.can_write(tenant_id, 'inventory.transfer'));

create policy suppliers_select on public.suppliers for select to authenticated using (private.has_permission(tenant_id, 'suppliers.read'));
create policy suppliers_write on public.suppliers for all to authenticated using (private.can_write(tenant_id, 'suppliers.manage')) with check (private.can_write(tenant_id, 'suppliers.manage'));
create policy po_select on public.purchase_orders for select to authenticated using (private.has_permission(tenant_id, 'purchases.read', branch_id));
create policy po_write on public.purchase_orders for all to authenticated using (private.can_write(tenant_id, 'purchases.create', branch_id)) with check (private.can_write(tenant_id, 'purchases.create', branch_id));
create policy po_items_select on public.purchase_order_items for select to authenticated using (private.has_permission(tenant_id, 'purchases.read'));
create policy po_items_write on public.purchase_order_items for all to authenticated using (private.can_write(tenant_id, 'purchases.create')) with check (private.can_write(tenant_id, 'purchases.create'));

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
-- Receive a purchase order (fully or partially): [{item_id, quantity}]
create or replace function public.receive_purchase_order(p_order uuid, p_items jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare po public.purchase_orders; it record; pending numeric;
begin
  select * into po from public.purchase_orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if po.status in ('received','cancelled','draft') then raise exception 'PO_NOT_RECEIVABLE' using errcode = 'P0001'; end if;
  if not private.can_write(po.tenant_id, 'purchases.approve', po.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  for it in select i.*, (x ->> 'quantity')::numeric as qty
            from jsonb_array_elements(p_items) x
            join public.purchase_order_items i on i.id = (x ->> 'item_id')::uuid and i.purchase_order_id = p_order loop
    if it.qty <= 0 then continue; end if;
    if it.received_quantity + it.qty > it.quantity then raise exception 'PO_OVER_RECEIVED' using errcode = 'P0001'; end if;
    update public.purchase_order_items set received_quantity = received_quantity + it.qty where id = it.id;
    insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, unit_cost, reference_type, reference_id, created_by)
    values (po.tenant_id, po.branch_id, it.variant_id, 'purchase', it.qty, it.unit_cost, 'purchase_order', po.id, auth.uid());
  end loop;

  select coalesce(sum(quantity - received_quantity), 0) into pending from public.purchase_order_items where purchase_order_id = p_order;
  update public.purchase_orders set status = case when pending = 0 then 'received' else 'partially_received' end where id = p_order;
  return case when pending = 0 then 'received' else 'partially_received' end;
end $$;

create or replace function public.advance_transfer(p_transfer uuid, p_status text)
returns text language plpgsql security invoker set search_path = '' as $$
declare t public.inventory_transfers; it record;
begin
  select * into t from public.inventory_transfers where id = p_transfer for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (t.status, p_status) in (('requested','approved'),('approved','in_transit'),('in_transit','received'),('requested','cancelled'),('approved','cancelled')) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if p_status = 'in_transit' then
    for it in select * from public.inventory_transfer_items where transfer_id = p_transfer loop
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, reference_type, reference_id, created_by)
      values (t.tenant_id, t.from_branch_id, it.variant_id, 'transfer_out', it.quantity, 'transfer', t.id, auth.uid());
    end loop;
  elsif p_status = 'received' then
    for it in select * from public.inventory_transfer_items where transfer_id = p_transfer loop
      insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, reference_type, reference_id, created_by)
      values (t.tenant_id, t.to_branch_id, it.variant_id, 'transfer_in', it.quantity, 'transfer', t.id, auth.uid());
    end loop;
  end if;
  update public.inventory_transfers set status = p_status where id = p_transfer;
  return p_status;
end $$;

-- Stock overview per variant for a branch (or all branches), with low-stock flag.
create or replace function public.inventory_overview(p_tenant uuid, p_branch uuid default null, p_query text default null)
returns table (variant_id uuid, product_id uuid, product_name text, category text, brand text, sku text, color_name text, color_hex text,
               image_url text, price numeric, cost numeric, quantity numeric, min_quantity numeric, is_low boolean)
language sql stable security invoker set search_path = '' as $$
  select v.id, p.id, p.name, c.name, b.name, v.sku, v.color_name, v.color_hex, v.image_url, v.price, v.cost,
         coalesce(sum(l.quantity), 0), coalesce(min(l.min_quantity), 1),
         coalesce(sum(l.quantity), 0) <= coalesce(min(l.min_quantity), 1)
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.product_categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  left join public.inventory_levels l on l.variant_id = v.id and (p_branch is null or l.branch_id = p_branch)
  where v.tenant_id = p_tenant and v.is_active and p.is_active and p.is_stocked
    and (p_query is null or p_query = '' or p.name ilike '%' || p_query || '%' or v.sku ilike '%' || p_query || '%' or v.barcode = p_query)
  group by v.id, p.id, c.name, b.name
  order by c.name, p.name, v.color_name
$$;

revoke all on function public.receive_purchase_order(uuid, jsonb), public.advance_transfer(uuid, text), public.inventory_overview(uuid, uuid, text) from public, anon;
grant execute on function public.receive_purchase_order(uuid, jsonb), public.advance_transfer(uuid, text), public.inventory_overview(uuid, uuid, text) to authenticated;
