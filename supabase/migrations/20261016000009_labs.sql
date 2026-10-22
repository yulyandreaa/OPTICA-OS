-- =============================================================================
-- Phase 06 — Labs, lab orders with timeline, quality control, delivery, public tracking.
-- =============================================================================

create table public.labs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  name       text not null,
  contact    text,
  phone      text,
  email      extensions.citext,
  lead_days  int not null default 5,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.lab_orders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  branch_id       uuid not null,
  patient_id      uuid not null,
  sale_id         uuid,
  prescription_id uuid,
  lab_id          uuid,
  number          text not null,
  status          text not null default 'pending' check (status in ('pending','sent','accepted','in_process','quality_control','ready','received','delivered','cancelled')),
  frame_description text,
  lens_description  text,
  lens_type       text,
  material        text,
  treatments      text[] not null default '{}',
  measurements    jsonb not null default '{}'::jsonb, -- { dp_od, dp_oi, height_od, height_oi, base_curve, … }
  notes           text,
  estimated_at    date,
  qc_checklist    jsonb not null default '{}'::jsonb, -- { formula, centering, height, frame, treatment, physical }: boolean
  qc_approved_by  uuid references public.profiles(id),
  qc_approved_at  timestamptz,
  delivered_at    timestamptz,
  delivered_by    uuid references public.profiles(id),
  delivery_notes  text,
  tracking_token  text not null default encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tracking_token),
  unique (id, tenant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  foreign key (sale_id, tenant_id) references public.sales(id, tenant_id),
  foreign key (prescription_id, tenant_id) references public.prescriptions(id, tenant_id),
  foreign key (lab_id, tenant_id) references public.labs(id, tenant_id)
);
create index lab_orders_tenant_idx on public.lab_orders (tenant_id, status, created_at desc);
create index lab_orders_patient_idx on public.lab_orders (tenant_id, patient_id);

create table public.lab_order_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  order_id   uuid not null,
  status     text not null,
  note       text,
  actor_id   uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (order_id, tenant_id) references public.lab_orders(id, tenant_id) on delete cascade
);
create index lab_order_events_idx on public.lab_order_events (order_id, created_at);
create trigger lab_order_events_immutable before update or delete on public.lab_order_events for each row execute function private.forbid_mutation();

create trigger lab_orders_number before insert on public.lab_orders for each row execute function private.doc_number_defaults('lab_order', 'OL');
create trigger lab_orders_updated_at before update on public.lab_orders for each row execute function private.set_updated_at();
create trigger lab_orders_audit after insert or update on public.lab_orders for each row execute function private.audit_row();

create or replace function private.lab_order_events_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.lab_order_events (tenant_id, order_id, status, actor_id) values (new.tenant_id, new.id, new.status, auth.uid());
    v_title := case new.status
      when 'pending' then 'Orden de laboratorio ' || new.number || ' creada'
      when 'sent' then 'Orden enviada al laboratorio'
      when 'ready' then 'Gafas listas en laboratorio'
      when 'received' then 'Gafas recibidas en la óptica'
      when 'delivered' then 'Gafas entregadas'
      else null end;
    if v_title is not null then
      insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
      values (new.tenant_id, new.patient_id, 'lab_order.' || new.status, v_title, jsonb_build_object('lab_order_id', new.id), auth.uid());
    end if;
  end if;
  return new;
end $$;
create trigger lab_orders_events after insert or update of status on public.lab_orders for each row execute function private.lab_order_events_trigger();

alter table public.labs enable row level security;
alter table public.lab_orders enable row level security;
alter table public.lab_order_events enable row level security;
revoke all on public.labs, public.lab_orders, public.lab_order_events from anon;

create policy labs_select on public.labs for select to authenticated using (private.is_member(tenant_id));
create policy labs_write on public.labs for all to authenticated using (private.can_write(tenant_id, 'settings.manage')) with check (private.can_write(tenant_id, 'settings.manage'));
create policy lo_select on public.lab_orders for select to authenticated using (private.has_permission(tenant_id, 'lab_orders.read', branch_id));
create policy lo_insert on public.lab_orders for insert to authenticated with check (private.can_write(tenant_id, 'lab_orders.create', branch_id));
create policy lo_update on public.lab_orders for update to authenticated using (private.can_write(tenant_id, 'lab_orders.update', branch_id)) with check (private.can_write(tenant_id, 'lab_orders.update', branch_id));
create policy loe_select on public.lab_order_events for select to authenticated using (private.has_permission(tenant_id, 'lab_orders.read'));
create policy loe_insert on public.lab_order_events for insert to authenticated with check (private.can_write(tenant_id, 'lab_orders.update'));

-- Ordered flow; QC approval requires lab_orders.qc and a complete checklist; delivery requires paid balance.
create or replace function public.advance_lab_order(p_order uuid, p_status text, p_note text default null, p_checklist jsonb default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  o public.lab_orders;
  flow text[] := array['pending','sent','accepted','in_process','quality_control','ready','received','delivered'];
  v_balance numeric;
begin
  select * into o from public.lab_orders where id = p_order for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_status = 'cancelled' then
    if o.status in ('delivered') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
  elsif array_position(flow, p_status) is null or array_position(flow, p_status) <= array_position(flow, o.status) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;

  if p_status = 'ready' and o.status = 'quality_control' then
    if not private.has_permission(o.tenant_id, 'lab_orders.qc', o.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if p_checklist is null or exists (select 1 from jsonb_each(p_checklist) where value <> 'true'::jsonb)
       or (select count(*) from jsonb_object_keys(p_checklist)) < 6 then
      raise exception 'QC_INCOMPLETE' using errcode = 'P0001', hint = 'Completa todo el control de calidad.';
    end if;
    update public.lab_orders set qc_checklist = p_checklist, qc_approved_by = auth.uid(), qc_approved_at = now() where id = p_order;
  end if;

  if p_status = 'delivered' and o.sale_id is not null then
    select balance into v_balance from public.sales where id = o.sale_id;
    if coalesce(v_balance, 0) > 0 then raise exception 'BALANCE_PENDING' using errcode = 'P0001', hint = 'El paciente tiene saldo pendiente.'; end if;
  end if;

  update public.lab_orders set status = p_status,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    delivered_by = case when p_status = 'delivered' then auth.uid() else delivered_by end,
    delivery_notes = case when p_status = 'delivered' then coalesce(p_note, delivery_notes) else delivery_notes end
  where id = p_order;
  if p_note is not null and p_status <> 'delivered' then
    -- Events are immutable; a note is recorded as its own event.
    insert into public.lab_order_events (tenant_id, order_id, status, note, actor_id) values (o.tenant_id, p_order, p_status, p_note, auth.uid());
  end if;
  return p_status;
end $$;

-- Public tracking (/track/[token]): order number, status, branch, ETA. No clinical data.
create or replace function public.track_lab_order(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'estimated_at', o.estimated_at, 'updated_at', o.updated_at,
    'tenant', t.trade_name, 'brand_color', t.brand_color, 'branch', b.name, 'branch_address', b.address, 'branch_phone', b.phone,
    'first_name', p.first_name,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
               from public.lab_order_events e where e.order_id = o.id and e.note is null)
  )
  from public.lab_orders o
  join public.tenants t on t.id = o.tenant_id
  join public.branches b on b.id = o.branch_id
  join public.patients p on p.id = o.patient_id
  where o.tracking_token = p_token and o.status <> 'cancelled'
$$;

revoke all on function public.advance_lab_order(uuid, text, text, jsonb) from public, anon;
grant execute on function public.advance_lab_order(uuid, text, text, jsonb) to authenticated;
grant execute on function public.track_lab_order(text) to anon, authenticated;
