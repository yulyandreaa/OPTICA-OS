-- =============================================================================
-- Phase 05 — Quotes, sales (POS), mixed payments. Prices are IVA-inclusive (Colombian retail);
-- base and tax are derived per line with NUMERIC math in the database, never floats.
-- =============================================================================

create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  branch_id       uuid not null,
  patient_id      uuid not null,
  prescription_id uuid,
  seller_id       uuid,
  number          text not null,
  status          text not null default 'draft' check (status in ('draft','sent','viewed','accepted','expired','converted','rejected')),
  public_token    text not null default encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
  valid_until     date not null default (current_date + 15),
  notes           text,
  subtotal        numeric(14,2) not null default 0,
  discount_total  numeric(14,2) not null default 0,
  tax_total       numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  sale_id         uuid,
  viewed_at       timestamptz,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, number),
  unique (public_token),
  unique (id, tenant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  foreign key (prescription_id, tenant_id) references public.prescriptions(id, tenant_id),
  constraint quotes_seller_profile_fkey foreign key (seller_id) references public.profiles(id)
);
create index quotes_tenant_idx on public.quotes (tenant_id, created_at desc);

create table public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  quote_id    uuid not null,
  variant_id  uuid,
  description text not null,
  quantity    numeric(12,2) not null check (quantity > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate    numeric(5,2) not null default 19,
  line_total  numeric(14,2) not null,
  tax_amount  numeric(14,2) not null,
  sort_order  int not null default 0,
  foreign key (quote_id, tenant_id) references public.quotes(id, tenant_id) on delete cascade,
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);

create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  branch_id        uuid not null,
  patient_id       uuid,
  prescription_id  uuid,
  quote_id         uuid,
  seller_id        uuid not null,
  number           text not null,
  status           text not null default 'partial' check (status in ('partial','paid','cancelled','returned')),
  subtotal         numeric(14,2) not null default 0,
  discount_total   numeric(14,2) not null default 0,
  tax_total        numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  paid_total       numeric(14,2) not null default 0,
  balance          numeric(14,2) generated always as (total - paid_total) stored,
  currency         char(3) not null default 'COP',
  notes            text,
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, number),
  unique (id, tenant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  foreign key (prescription_id, tenant_id) references public.prescriptions(id, tenant_id),
  foreign key (quote_id, tenant_id) references public.quotes(id, tenant_id),
  constraint sales_seller_profile_fkey foreign key (seller_id) references public.profiles(id)
);
create unique index sales_idempotency_uq on public.sales (tenant_id, idempotency_key) where idempotency_key is not null;
create index sales_tenant_idx on public.sales (tenant_id, created_at desc);
create index sales_patient_idx on public.sales (tenant_id, patient_id, created_at desc);
alter table public.quotes add constraint quotes_sale_fkey foreign key (sale_id, tenant_id) references public.sales(id, tenant_id);

create table public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  sale_id     uuid not null,
  variant_id  uuid,
  description text not null,
  category    text,
  quantity    numeric(12,2) not null check (quantity > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  unit_cost   numeric(14,2) not null default 0,
  discount    numeric(14,2) not null default 0 check (discount >= 0),
  tax_rate    numeric(5,2) not null default 19,
  line_total  numeric(14,2) not null,
  tax_amount  numeric(14,2) not null,
  sort_order  int not null default 0,
  foreign key (sale_id, tenant_id) references public.sales(id, tenant_id) on delete cascade,
  foreign key (variant_id, tenant_id) references public.product_variants(id, tenant_id)
);
create index sale_items_sale_idx on public.sale_items (sale_id);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  sale_id     uuid not null,
  method      text not null check (method in ('cash','card','transfer','nequi','daviplata','wompi','credit')),
  amount      numeric(14,2) not null check (amount > 0),
  reference   text,
  received_by uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  foreign key (sale_id, tenant_id) references public.sales(id, tenant_id)
);
create index payments_sale_idx on public.payments (sale_id);
create trigger payments_immutable before update or delete on public.payments for each row execute function private.forbid_mutation();

create trigger quotes_number before insert on public.quotes for each row execute function private.doc_number_defaults('quote', 'COT');
create trigger sales_number before insert on public.sales for each row execute function private.doc_number_defaults('sale', 'V');
create trigger quotes_updated_at before update on public.quotes for each row execute function private.set_updated_at();
create trigger sales_updated_at before update on public.sales for each row execute function private.set_updated_at();
create trigger sales_audit after insert or update on public.sales for each row execute function private.audit_row();
create trigger payments_audit after insert on public.payments for each row execute function private.audit_row();
create trigger quotes_audit after insert or update on public.quotes for each row execute function private.audit_row();

create or replace function private.sale_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.patient_id is null then return new; end if;
  if tg_table_name = 'sales' then
    insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
    values (new.tenant_id, new.patient_id, 'sale.created', 'Compró ' || new.number || ' por $' || to_char(new.total, 'FM999G999G999'), jsonb_build_object('sale_id', new.id), auth.uid());
  else
    insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
    values (new.tenant_id, new.patient_id, 'quote.created', 'Cotización ' || new.number, jsonb_build_object('quote_id', new.id), auth.uid());
  end if;
  return new;
end $$;
create trigger sales_timeline after insert on public.sales for each row execute function private.sale_timeline();
create trigger quotes_timeline after insert on public.quotes for each row execute function private.sale_timeline();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
revoke all on public.quotes, public.quote_items, public.sales, public.sale_items, public.payments from anon;

create policy quotes_select on public.quotes for select to authenticated using (private.has_permission(tenant_id, 'quotes.read', branch_id));
create policy quotes_write on public.quotes for all to authenticated using (private.can_write(tenant_id, 'quotes.create', branch_id)) with check (private.can_write(tenant_id, 'quotes.create', branch_id));
create policy quote_items_select on public.quote_items for select to authenticated using (private.has_permission(tenant_id, 'quotes.read'));
create policy quote_items_write on public.quote_items for all to authenticated using (private.can_write(tenant_id, 'quotes.create')) with check (private.can_write(tenant_id, 'quotes.create'));
create policy sales_select on public.sales for select to authenticated using (private.has_permission(tenant_id, 'sales.read', branch_id));
create policy sales_insert on public.sales for insert to authenticated with check (private.can_write(tenant_id, 'sales.create', branch_id));
create policy sales_update on public.sales for update to authenticated using (private.can_write(tenant_id, 'sales.create', branch_id)) with check (private.can_write(tenant_id, 'sales.create', branch_id));
create policy sale_items_select on public.sale_items for select to authenticated using (private.has_permission(tenant_id, 'sales.read'));
create policy sale_items_insert on public.sale_items for insert to authenticated with check (private.can_write(tenant_id, 'sales.create'));
create policy payments_select on public.payments for select to authenticated using (private.has_permission(tenant_id, 'sales.read'));
create policy payments_insert on public.payments for insert to authenticated with check (private.can_write(tenant_id, 'sales.create'));

-- -----------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER)
-- -----------------------------------------------------------------------------
-- Line math: line_total = qty × unit_price − discount (IVA included); tax = line_total − line_total / (1 + rate).
create or replace function private.line_tax(p_total numeric, p_rate numeric)
returns numeric language sql immutable set search_path = '' as $$
  select round(p_total - p_total / (1 + p_rate / 100), 2)
$$;
grant execute on function private.line_tax(numeric, numeric) to authenticated, service_role;

create or replace function private.add_payments(p_tenant uuid, p_sale uuid, p_payments jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare p jsonb; v_total numeric; v_paid numeric;
begin
  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    if coalesce((p ->> 'amount')::numeric, 0) <= 0 then continue; end if;
    insert into public.payments (tenant_id, sale_id, method, amount, reference, received_by)
    values (p_tenant, p_sale, p ->> 'method', round((p ->> 'amount')::numeric, 2), nullif(p ->> 'reference', ''), auth.uid());
  end loop;
  select total into v_total from public.sales where id = p_sale;
  select coalesce(sum(amount), 0) into v_paid from public.payments where sale_id = p_sale;
  if v_paid > v_total then raise exception 'PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001', hint = 'El pago supera el saldo de la venta.'; end if;
  update public.sales set paid_total = v_paid, status = case when v_paid >= v_total then 'paid' else 'partial' end where id = p_sale;
end $$;
grant execute on function private.add_payments(uuid, uuid, jsonb) to authenticated;

-- p: { tenant_id, branch_id, patient_id?, prescription_id?, quote_id?, notes?, idempotency_key?,
--      items: [{ variant_id?, description?, quantity, unit_price?, discount?, tax_rate? }],
--      payments: [{ method, amount, reference? }] }
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
      select pv.id, pv.price, pv.cost, pr.name || coalesce(' · ' || pv.color_name, ''), pr.tax_rate, pr.is_stocked, c.name
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

create or replace function public.add_sale_payment(p_sale uuid, p_payments jsonb)
returns numeric language plpgsql security invoker set search_path = '' as $$
declare s public.sales;
begin
  select * into s from public.sales where id = p_sale;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if s.status in ('cancelled','returned') then raise exception 'SALE_CLOSED' using errcode = 'P0001'; end if;
  if not private.can_write(s.tenant_id, 'sales.create', s.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform private.add_payments(s.tenant_id, p_sale, p_payments);
  return (select balance from public.sales where id = p_sale);
end $$;

-- p: { tenant_id, branch_id, patient_id, prescription_id?, notes?, valid_days?, items: [...] }
create or replace function public.create_quote(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_quote uuid; it jsonb; i int := 0; v_vid uuid; v_vprice numeric; v_label text; v_vrate numeric;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric; v_line numeric; v_tax numeric;
  v_sub numeric := 0; v_disc_total numeric := 0; v_tax_total numeric := 0; v_total numeric := 0;
begin
  if not private.can_write(v_tenant, 'quotes.create', v_branch) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into public.quotes (tenant_id, branch_id, patient_id, prescription_id, seller_id, notes, status, valid_until, created_by)
  values (v_tenant, v_branch, (p ->> 'patient_id')::uuid, nullif(p ->> 'prescription_id', '')::uuid, auth.uid(), nullif(p ->> 'notes', ''), 'sent',
          current_date + coalesce((p ->> 'valid_days')::int, 15), auth.uid())
  returning id into v_quote;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    i := i + 1; v_vid := null; v_vprice := null; v_label := null; v_vrate := null;
    if it ->> 'variant_id' is not null then
      select pv.id, pv.price, pr.name || coalesce(' · ' || pv.color_name, ''), pr.tax_rate into v_vid, v_vprice, v_label, v_vrate
        from public.product_variants pv join public.products pr on pr.id = pv.product_id
       where pv.id = (it ->> 'variant_id')::uuid and pv.tenant_id = v_tenant;
    end if;
    v_qty := coalesce((it ->> 'quantity')::numeric, 1);
    v_price := coalesce((it ->> 'unit_price')::numeric, v_vprice, 0);
    v_disc := coalesce((it ->> 'discount')::numeric, 0);
    v_rate := coalesce((it ->> 'tax_rate')::numeric, v_vrate, 19);
    v_line := round(v_qty * v_price - v_disc, 2);
    v_tax := private.line_tax(v_line, v_rate);
    insert into public.quote_items (tenant_id, quote_id, variant_id, description, quantity, unit_price, discount, tax_rate, line_total, tax_amount, sort_order)
    values (v_tenant, v_quote, v_vid, coalesce(nullif(it ->> 'description', ''), v_label, 'Ítem'), v_qty, v_price, v_disc, v_rate, v_line, v_tax, i);
    v_sub := v_sub + v_qty * v_price; v_disc_total := v_disc_total + v_disc; v_tax_total := v_tax_total + v_tax; v_total := v_total + v_line;
  end loop;
  update public.quotes set subtotal = v_sub, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total where id = v_quote;
  return v_quote;
end $$;

-- Converts a quote into a sale reusing its lines (no retyping), with optional down payment.
create or replace function public.convert_quote(p_quote uuid, p_payments jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare q public.quotes; v_items jsonb;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if q.status = 'converted' then return q.sale_id; end if;
  if q.status in ('expired','rejected') or q.valid_until < current_date then raise exception 'QUOTE_EXPIRED' using errcode = 'P0001'; end if;
  select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'description', description, 'quantity', quantity, 'unit_price', unit_price,
                   'discount', discount, 'tax_rate', tax_rate) order by sort_order)
    into v_items from public.quote_items where quote_id = p_quote;
  return public.create_sale(jsonb_build_object('tenant_id', q.tenant_id, 'branch_id', q.branch_id, 'patient_id', q.patient_id,
    'prescription_id', q.prescription_id, 'quote_id', q.id, 'items', v_items, 'payments', coalesce(p_payments, '[]'::jsonb),
    'idempotency_key', coalesce(p_idempotency_key, 'quote:' || q.id)));
end $$;

-- Public quote view (/quote/[token]) — no clinical data, marks as viewed.
create or replace function public.public_quote(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.quotes; r jsonb;
begin
  select * into q from public.quotes where public_token = p_token;
  if not found then return null; end if;
  if q.status = 'sent' then update public.quotes set status = 'viewed', viewed_at = now() where id = q.id; end if;
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

revoke all on function public.create_sale(jsonb), public.add_sale_payment(uuid, jsonb), public.create_quote(jsonb), public.convert_quote(uuid, jsonb, text) from public, anon;
grant execute on function public.create_sale(jsonb), public.add_sale_payment(uuid, jsonb), public.create_quote(jsonb), public.convert_quote(uuid, jsonb, text) to authenticated;
grant execute on function public.public_quote(text) to anon, authenticated;
