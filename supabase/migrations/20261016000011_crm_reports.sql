-- =============================================================================
-- Phase 09–10 — Commercial CRM (pipeline + leads), tasks, and reporting RPCs.
-- Reports are SECURITY INVOKER: they aggregate only what the caller can already read.
-- =============================================================================

create table public.pipeline_stages (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  sort_order int not null,
  is_won     boolean not null default false,
  is_lost    boolean not null default false,
  unique (tenant_id, code),
  unique (id, tenant_id)
);

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  stage_id     uuid not null,
  patient_id   uuid,
  name         text not null,
  phone        text,
  email        extensions.citext,
  source       text not null default 'walk_in' check (source in ('instagram','facebook','google','whatsapp','referral','web','walk_in','other')),
  interest     text,
  value        numeric(14,2),
  assigned_to  uuid,
  notes        text,
  lost_reason  text,
  stage_changed_at timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (stage_id, tenant_id) references public.pipeline_stages(id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  constraint leads_assigned_profile_fkey foreign key (assigned_to) references public.profiles(id)
);
create index leads_tenant_idx on public.leads (tenant_id, stage_id, updated_at desc);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  title        text not null,
  description  text,
  priority     text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status       text not null default 'open' check (status in ('open','done','cancelled')),
  due_at       timestamptz,
  assigned_to  uuid,
  related_type text check (related_type in ('patient','sale','lab_order','supplier','lead')),
  related_id   uuid,
  created_by   uuid references public.profiles(id),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint tasks_assigned_profile_fkey foreign key (assigned_to) references public.profiles(id)
);
create index tasks_tenant_idx on public.tasks (tenant_id, status, due_at);

create trigger leads_updated_at before update on public.leads for each row execute function private.set_updated_at();

create or replace function private.lead_stage_ts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.stage_id is distinct from old.stage_id then new.stage_changed_at := now(); end if;
  return new;
end $$;
create trigger leads_stage_ts before update on public.leads for each row execute function private.lead_stage_ts();

create or replace function private.seed_pipeline(p_tenant uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.pipeline_stages (tenant_id, code, name, sort_order, is_won, is_lost) values
    (p_tenant, 'new', 'Nuevo', 1, false, false), (p_tenant, 'contacted', 'Contactado', 2, false, false),
    (p_tenant, 'booked', 'Cita agendada', 3, false, false), (p_tenant, 'evaluated', 'Valorado', 4, false, false),
    (p_tenant, 'quoted', 'Cotización', 5, false, false), (p_tenant, 'negotiation', 'Negociación', 6, false, false),
    (p_tenant, 'won', 'Venta', 7, true, false), (p_tenant, 'lost', 'Perdido', 8, false, true)
  on conflict do nothing
$$;
create or replace function private.tenant_pipeline_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.seed_pipeline(new.id); return new; end $$;
create trigger tenants_seed_pipeline after insert on public.tenants for each row execute function private.tenant_pipeline_trigger();
select private.seed_pipeline(id) from public.tenants;

alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.tasks enable row level security;
revoke all on public.pipeline_stages, public.leads, public.tasks from anon;

create policy stages_select on public.pipeline_stages for select to authenticated using (private.is_member(tenant_id));
create policy stages_write on public.pipeline_stages for all to authenticated using (private.can_write(tenant_id, 'settings.manage')) with check (private.can_write(tenant_id, 'settings.manage'));
create policy leads_select on public.leads for select to authenticated using (private.has_permission(tenant_id, 'crm.read'));
create policy leads_write on public.leads for all to authenticated using (private.can_write(tenant_id, 'crm.manage')) with check (private.can_write(tenant_id, 'crm.manage'));
create policy tasks_select on public.tasks for select to authenticated using (private.is_member(tenant_id) and (assigned_to = auth.uid() or created_by = auth.uid() or private.has_permission(tenant_id, 'tasks.manage')));
create policy tasks_write on public.tasks for all to authenticated using (private.can_write(tenant_id, 'tasks.manage') or assigned_to = auth.uid()) with check (private.is_member(tenant_id));

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------
create or replace function public.report_sales(p_tenant uuid, p_from date, p_to date, p_branch uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with tz as (select timezone from public.tenants where id = p_tenant),
  s as (
    select sa.*, (sa.created_at at time zone (select timezone from tz))::date as day
    from public.sales sa
    where sa.tenant_id = p_tenant and sa.status <> 'cancelled' and (p_branch is null or sa.branch_id = p_branch)
      and (sa.created_at at time zone (select timezone from tz))::date between p_from and p_to
  ),
  items as (select si.*, s.seller_id, s.branch_id from public.sale_items si join s on s.id = si.sale_id),
  prev as (
    select coalesce(sum(total), 0) as total, count(*) as n from public.sales sa
    where sa.tenant_id = p_tenant and sa.status <> 'cancelled' and (p_branch is null or sa.branch_id = p_branch)
      and (sa.created_at at time zone (select timezone from tz))::date between p_from - (p_to - p_from + 1) and p_from - 1
  ),
  consults as (
    select count(distinct m.patient_id) as patients
    from public.medical_records m
    where m.tenant_id = p_tenant and m.status <> 'draft' and (p_branch is null or m.branch_id = p_branch)
      and (m.created_at at time zone (select timezone from tz))::date between p_from and p_to
  ),
  converted as (
    select count(distinct m.patient_id) as patients
    from public.medical_records m
    where m.tenant_id = p_tenant and m.status <> 'draft' and (p_branch is null or m.branch_id = p_branch)
      and (m.created_at at time zone (select timezone from tz))::date between p_from and p_to
      and exists (select 1 from s where s.patient_id = m.patient_id and s.created_at >= m.created_at - interval '1 day')
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(total), 0) from s),
    'count', (select count(*) from s),
    'avg_ticket', (select coalesce(round(avg(total)), 0) from s),
    'tax_total', (select coalesce(sum(tax_total), 0) from s),
    'balance_pending', (select coalesce(sum(balance), 0) from s),
    'margin', (select coalesce(sum(line_total - tax_amount - unit_cost * quantity), 0) from items),
    'prev_total', (select total from prev),
    'prev_count', (select n from prev),
    'consulted_patients', (select patients from consults),
    'converted_patients', (select patients from converted),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'total', coalesce(x.total, 0), 'count', coalesce(x.n, 0)) order by d), '[]'::jsonb)
               from generate_series(p_from, p_to, interval '1 day') d
               left join (select day, sum(total) as total, count(*) as n from s group by day) x on x.day = d::date),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(category, 'Otros'), 'total', total) order by total desc), '[]'::jsonb)
                    from (select category, sum(line_total) as total from items group by category) c),
    'by_seller', (select coalesce(jsonb_agg(jsonb_build_object('seller', p.full_name, 'total', x.total, 'count', x.n) order by x.total desc), '[]'::jsonb)
                  from (select seller_id, sum(total) as total, count(*) as n from s group by seller_id) x join public.profiles p on p.id = x.seller_id),
    'by_branch', (select coalesce(jsonb_agg(jsonb_build_object('branch', b.name, 'total', x.total) order by x.total desc), '[]'::jsonb)
                  from (select branch_id, sum(total) as total from s group by branch_id) x join public.branches b on b.id = x.branch_id),
    'top_products', (select coalesce(jsonb_agg(jsonb_build_object('description', description, 'quantity', qty, 'total', total) order by total desc), '[]'::jsonb)
                     from (select description, sum(quantity) as qty, sum(line_total) as total from items group by description order by sum(line_total) desc limit 8) t),
    'by_method', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'total', total) order by total desc), '[]'::jsonb)
                  from (select pa.method, sum(pa.amount) as total from public.payments pa join s on s.id = pa.sale_id group by pa.method) m)
  )
$$;

revoke all on function public.report_sales(uuid, date, date, uuid) from public, anon;
grant execute on function public.report_sales(uuid, date, date, uuid) to authenticated;
