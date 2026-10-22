-- =============================================================================
-- Phase 02 — Patients (CRM 360°) + Agenda.
-- =============================================================================
create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Patients
-- -----------------------------------------------------------------------------
create table public.patients (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  document_type           text not null check (document_type in ('CC','TI','CE','PA','RC','PEP','PPT','NIT','MS','AS','CD','SC')),
  document_number         text not null check (document_number ~ '^[A-Za-z0-9-]{3,20}$'),
  first_name              text not null check (length(first_name) between 1 and 80),
  middle_name             text,
  last_name               text not null check (length(last_name) between 1 and 80),
  second_last_name        text,
  full_name               text generated always as (
                            trim(regexp_replace(first_name || ' ' || coalesce(middle_name, '') || ' ' || last_name || ' ' || coalesce(second_last_name, ''), '\s+', ' ', 'g'))
                          ) stored not null,
  birth_date              date check (birth_date is null or birth_date between '1900-01-01' and current_date),
  sex                     text check (sex in ('M','F','I')), -- sexo biológico (RIPS / uso clínico)
  email                   extensions.citext,
  phone                   text,
  whatsapp                text,
  address                 text,
  city                    text,
  department              text,
  occupation              text,
  eps                     text,
  health_regime           text check (health_regime in ('contributivo','subsidiado','especial','particular','no_asegurado')),
  emergency_contact_name  text,
  emergency_contact_phone text,
  contact_preference      text not null default 'whatsapp' check (contact_preference in ('whatsapp','email','phone','sms','none')),
  source                  text check (source in ('instagram','facebook','google','whatsapp','referral','web','walk_in','other')),
  home_branch_id          uuid,
  assigned_to             uuid,
  tags                    text[] not null default '{}',
  notes                   text,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  unique (id, tenant_id),
  foreign key (home_branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (tenant_id, assigned_to) references public.tenant_members(tenant_id, user_id),
  constraint patients_assigned_profile_fkey foreign key (assigned_to) references public.profiles(id)
);
create unique index patients_document_uq on public.patients (tenant_id, document_type, document_number) where deleted_at is null;
create index patients_tenant_created_idx on public.patients (tenant_id, created_at desc, id) where deleted_at is null;
create index patients_name_trgm_idx on public.patients using gin (full_name extensions.gin_trgm_ops);
create index patients_document_idx on public.patients (tenant_id, document_number);
create index patients_phone_idx on public.patients (tenant_id, phone);

-- Versioned consents (data processing, marketing, clinical).
create table public.patient_consents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  patient_id      uuid not null,
  consent_type    text not null check (consent_type in ('data_processing','marketing','clinical','telemedicine')),
  version         text not null,
  granted         boolean not null,
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  ip_address      text,
  user_agent      text,
  document_path   text,
  recorded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id)
);
create index patient_consents_patient_idx on public.patient_consents (tenant_id, patient_id);

-- Timeline (append-only activity feed shown in the 360° profile).
create table public.patient_activities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  patient_id  uuid not null,
  type        text not null,
  title       text not null,
  metadata    jsonb not null default '{}'::jsonb,
  actor_id    uuid references public.profiles(id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id)
);
create index patient_activities_patient_idx on public.patient_activities (tenant_id, patient_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Agenda
-- -----------------------------------------------------------------------------
create table public.appointment_types (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  code               text not null check (code ~ '^[a-z_]+$'),
  name               text not null,
  description        text,
  duration_minutes   int not null default 30 check (duration_minutes between 5 and 480),
  color              text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  price              numeric(14,2) check (price is null or price >= 0),
  is_clinical        boolean not null default true,
  is_public          boolean not null default true, -- bookable from /book
  is_active          boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  unique (tenant_id, code),
  unique (id, tenant_id)
);

-- Weekly availability per specialist & branch. weekday: 0=domingo … 6=sábado.
create table public.specialist_schedules (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid not null,
  user_id      uuid not null,
  weekday      smallint not null check (weekday between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  created_at   timestamptz not null default now(),
  check (end_time > start_time),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id) references public.tenant_members(tenant_id, user_id) on delete cascade,
  constraint specialist_schedules_profile_fkey foreign key (user_id) references public.profiles(id) on delete cascade
);
create index specialist_schedules_lookup_idx on public.specialist_schedules (tenant_id, branch_id, weekday);

-- Vacations, breaks, blocks.
create table public.schedule_blocks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid,
  user_id    uuid,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id) references public.tenant_members(tenant_id, user_id) on delete cascade
);
create index schedule_blocks_range_idx on public.schedule_blocks using gist (tenant_id, tstzrange(starts_at, ends_at));

create table public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  branch_id           uuid not null,
  patient_id          uuid not null,
  specialist_id       uuid,
  appointment_type_id uuid not null,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  status              text not null default 'scheduled' check (status in
                        ('scheduled','confirmed','checked_in','waiting','in_consultation','completed','cancelled','no_show')),
  source              text not null default 'internal' check (source in ('internal','online','whatsapp','phone','walk_in')),
  notes               text,
  cancellation_reason text,
  confirmed_at        timestamptz,
  checked_in_at       timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (id, tenant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  foreign key (appointment_type_id, tenant_id) references public.appointment_types(id, tenant_id),
  foreign key (tenant_id, specialist_id) references public.tenant_members(tenant_id, user_id),
  -- Direct FK to profiles so PostgREST can embed the specialist's name.
  constraint appointments_specialist_profile_fkey foreign key (specialist_id) references public.profiles(id),
  -- A specialist can't be double-booked.
  constraint appointments_no_overlap exclude using gist (
    specialist_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (specialist_id is not null and status not in ('cancelled', 'no_show'))
);
create index appointments_calendar_idx on public.appointments (tenant_id, branch_id, starts_at);
create index appointments_patient_idx on public.appointments (tenant_id, patient_id, starts_at desc);
create index appointments_specialist_idx on public.appointments (tenant_id, specialist_id, starts_at);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create trigger patients_updated_at before update on public.patients for each row execute function private.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute function private.set_updated_at();

create trigger patients_audit after insert or update or delete on public.patients for each row execute function private.audit_row();
create trigger patient_consents_audit after insert or update or delete on public.patient_consents for each row execute function private.audit_row();
create trigger appointments_audit after insert or update or delete on public.appointments for each row execute function private.audit_row();

-- Archiving a patient requires patients.delete (UPDATE policy alone only needs patients.update).
create or replace function private.guard_patient_archive()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null
     and auth.uid() is not null
     and not private.has_permission(new.tenant_id, 'patients.delete') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id then
    raise exception 'TENANT_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger patients_guard_archive before update on public.patients
  for each row execute function private.guard_patient_archive();

-- Status timestamps + timeline entries for appointments.
create or replace function private.appointment_status_side_effects()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    case new.status
      when 'confirmed'       then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'checked_in'      then new.checked_in_at := coalesce(new.checked_in_at, now());
      when 'waiting'         then new.checked_in_at := coalesce(new.checked_in_at, now());
      when 'in_consultation' then new.started_at := coalesce(new.started_at, now());
      when 'completed'       then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled'       then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end $$;
create trigger appointments_status_ts before update on public.appointments
  for each row execute function private.appointment_status_side_effects();

create or replace function private.appointment_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type_name text; v_title text;
begin
  select name into v_type_name from public.appointment_types where id = new.appointment_type_id;
  if tg_op = 'INSERT' then
    v_title := 'Agendó ' || lower(coalesce(v_type_name, 'cita'));
  elsif new.status is distinct from old.status then
    v_title := case new.status
      when 'confirmed' then 'Confirmó su cita'
      when 'checked_in' then 'Llegó a la óptica'
      when 'completed' then 'Consulta realizada: ' || lower(coalesce(v_type_name, 'cita'))
      when 'cancelled' then 'Canceló su cita'
      when 'no_show' then 'No asistió a su cita'
      else null end;
  end if;
  if v_title is not null then
    insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
    values (new.tenant_id, new.patient_id, 'appointment.' || case when tg_op = 'INSERT' then 'created' else new.status end,
            v_title, jsonb_build_object('appointment_id', new.id, 'starts_at', new.starts_at), auth.uid());
  end if;
  return new;
end $$;
create trigger appointments_timeline after insert or update of status on public.appointments
  for each row execute function private.appointment_timeline();

create or replace function private.patient_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.patient_activities (tenant_id, patient_id, type, title, actor_id, occurred_at)
  values (new.tenant_id, new.id, 'patient.created', 'Paciente registrado', auth.uid(), new.created_at);
  return new;
end $$;
create trigger patients_timeline after insert on public.patients
  for each row execute function private.patient_timeline();

-- Default appointment types for every new tenant.
create or replace function private.seed_tenant_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.appointment_types (tenant_id, code, name, duration_minutes, color, is_clinical, sort_order) values
    (new.id, 'valoracion',   'Valoración visual',             30, '#6366f1', true, 1),
    (new.id, 'optometria',   'Consulta de optometría',        40, '#0ea5e9', true, 2),
    (new.id, 'oftalmologia', 'Consulta de oftalmología',      30, '#8b5cf6', true, 3),
    (new.id, 'control',      'Control',                       20, '#14b8a6', true, 4),
    (new.id, 'lentes_contacto', 'Adaptación lentes de contacto', 45, '#f59e0b', true, 5),
    (new.id, 'entrega',      'Entrega de gafas',              15, '#22c55e', false, 6),
    (new.id, 'garantia',     'Garantía',                      20, '#ef4444', false, 7),
    (new.id, 'otro',         'Otro',                          30, '#64748b', false, 8);
  return new;
end $$;
create trigger tenants_seed_defaults after insert on public.tenants
  for each row execute function private.seed_tenant_defaults();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.patients             enable row level security;
alter table public.patient_consents     enable row level security;
alter table public.patient_activities   enable row level security;
alter table public.appointment_types    enable row level security;
alter table public.specialist_schedules enable row level security;
alter table public.schedule_blocks      enable row level security;
alter table public.appointments         enable row level security;
revoke all on public.patients, public.patient_consents, public.patient_activities, public.appointment_types,
  public.specialist_schedules, public.schedule_blocks, public.appointments from anon;

create policy patients_select on public.patients for select to authenticated
  using (private.has_permission(tenant_id, 'patients.read'));
create policy patients_insert on public.patients for insert to authenticated
  with check (private.can_write(tenant_id, 'patients.create'));
create policy patients_update on public.patients for update to authenticated
  using (private.can_write(tenant_id, 'patients.update'))
  with check (private.can_write(tenant_id, 'patients.update'));

create policy consents_select on public.patient_consents for select to authenticated
  using (private.has_permission(tenant_id, 'patients.read'));
create policy consents_insert on public.patient_consents for insert to authenticated
  with check (private.can_write(tenant_id, 'patients.update'));
create policy consents_update on public.patient_consents for update to authenticated
  using (private.can_write(tenant_id, 'patients.update'))
  with check (private.can_write(tenant_id, 'patients.update'));

create policy activities_select on public.patient_activities for select to authenticated
  using (private.has_permission(tenant_id, 'patients.read'));
create policy activities_insert on public.patient_activities for insert to authenticated
  with check (private.can_write(tenant_id, 'patients.update'));

create policy appt_types_select on public.appointment_types for select to authenticated
  using (private.is_member(tenant_id));
create policy appt_types_write on public.appointment_types for all to authenticated
  using (private.can_write(tenant_id, 'schedules.manage'))
  with check (private.can_write(tenant_id, 'schedules.manage'));

create policy schedules_select on public.specialist_schedules for select to authenticated
  using (private.has_permission(tenant_id, 'appointments.read', branch_id));
create policy schedules_write on public.specialist_schedules for all to authenticated
  using (private.can_write(tenant_id, 'schedules.manage', branch_id))
  with check (private.can_write(tenant_id, 'schedules.manage', branch_id));

create policy blocks_select on public.schedule_blocks for select to authenticated
  using (private.has_permission(tenant_id, 'appointments.read', branch_id));
create policy blocks_write on public.schedule_blocks for all to authenticated
  using (private.can_write(tenant_id, 'schedules.manage', branch_id))
  with check (private.can_write(tenant_id, 'schedules.manage', branch_id));

create policy appointments_select on public.appointments for select to authenticated
  using (private.has_permission(tenant_id, 'appointments.read', branch_id));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (private.can_write(tenant_id, 'appointments.create', branch_id));
create policy appointments_update on public.appointments for update to authenticated
  using (private.can_write(tenant_id, 'appointments.update', branch_id))
  with check (private.can_write(tenant_id, 'appointments.update', branch_id));

-- =============================================================================
-- Public booking (/book/[tenantSlug]) — anon-callable, narrowly scoped RPCs.
-- They expose only what a booking page needs; never patient data.
-- =============================================================================
create or replace function public.booking_catalog(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.trade_name, 'slug', t.slug, 'brand_color', t.brand_color, 'timezone', t.timezone),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'city', b.city) order by b.is_main desc, b.name)
                  from public.branches b where b.tenant_id = t.id and b.status = 'active' and b.deleted_at is null), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'duration', a.duration_minutes, 'price', a.price) order by a.sort_order)
                  from public.appointment_types a where a.tenant_id = t.id and a.is_active and a.is_public), '[]'::jsonb),
    'specialists', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'name', p.full_name, 'branch_id', s.branch_id))
                  from public.specialist_schedules s
                  join public.profiles p on p.id = s.user_id
                  join public.tenant_members m on m.tenant_id = s.tenant_id and m.user_id = s.user_id and m.status = 'active'
                  where s.tenant_id = t.id), '[]'::jsonb)
  )
  from public.tenants t
  where t.slug = lower(p_slug)::extensions.citext and t.status = 'active' and t.deleted_at is null
$$;

-- Free slots for a given local date (tenant timezone).
create or replace function public.booking_slots(p_slug text, p_branch uuid, p_type uuid, p_date date, p_specialist uuid default null)
returns table (specialist_id uuid, starts_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with t as (
    select id, timezone from public.tenants
    where slug = lower(p_slug)::extensions.citext and status = 'active' and deleted_at is null
  ),
  ty as (
    select a.duration_minutes from public.appointment_types a, t
    where a.id = p_type and a.tenant_id = t.id and a.is_active and a.is_public
  ),
  candidates as (
    select s.user_id,
           gs as slot_start,
           gs + make_interval(mins => (select duration_minutes from ty)) as slot_end
    from t
    join public.specialist_schedules s on s.tenant_id = t.id and s.branch_id = p_branch
      and s.weekday = extract(dow from p_date)::int
      and (p_specialist is null or s.user_id = p_specialist)
    cross join lateral generate_series(
      (p_date + s.start_time) at time zone t.timezone,
      (p_date + s.end_time) at time zone t.timezone - make_interval(mins => (select duration_minutes from ty)),
      make_interval(mins => s.slot_minutes)
    ) gs
  )
  select c.user_id, c.slot_start
  from candidates c, t
  where c.slot_start > now() + interval '1 hour'
    and not exists (
      select 1 from public.appointments ap
      where ap.tenant_id = t.id and ap.specialist_id = c.user_id
        and ap.status not in ('cancelled', 'no_show')
        and tstzrange(ap.starts_at, ap.ends_at) && tstzrange(c.slot_start, c.slot_end))
    and not exists (
      select 1 from public.schedule_blocks bl
      where bl.tenant_id = t.id and (bl.user_id is null or bl.user_id = c.user_id)
        and (bl.branch_id is null or bl.branch_id = p_branch)
        and tstzrange(bl.starts_at, bl.ends_at) && tstzrange(c.slot_start, c.slot_end))
  order by c.slot_start, c.user_id
$$;

-- Books an appointment; matches an existing patient by document or creates a new one.
create or replace function public.booking_create(
  p_slug text, p_branch uuid, p_type uuid, p_specialist uuid, p_starts_at timestamptz,
  p_document_type text, p_document_number text, p_first_name text, p_last_name text,
  p_phone text, p_email text, p_accept_data_policy boolean, p_policy_version text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid; v_patient uuid; v_duration int; v_appt uuid; v_slot_ok boolean;
begin
  if not coalesce(p_accept_data_policy, false) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  select id into v_tenant from public.tenants
   where slug = lower(p_slug)::extensions.citext and status = 'active' and deleted_at is null;
  if v_tenant is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  select duration_minutes into v_duration from public.appointment_types
   where id = p_type and tenant_id = v_tenant and is_active and is_public;
  if v_duration is null then raise exception 'INVALID_SERVICE' using errcode = 'P0001'; end if;

  select exists (
    select 1 from public.booking_slots(p_slug, p_branch, p_type, (p_starts_at at time zone (select timezone from public.tenants where id = v_tenant))::date, p_specialist) s
    where s.specialist_id = p_specialist and s.starts_at = p_starts_at
  ) into v_slot_ok;
  if not v_slot_ok then raise exception 'SLOT_UNAVAILABLE' using errcode = 'P0001'; end if;

  select id into v_patient from public.patients
   where tenant_id = v_tenant and document_type = p_document_type and document_number = p_document_number and deleted_at is null;

  if v_patient is null then
    insert into public.patients (tenant_id, document_type, document_number, first_name, last_name, phone, whatsapp, email, source, home_branch_id)
    values (v_tenant, p_document_type, p_document_number, p_first_name, p_last_name, p_phone, p_phone, nullif(p_email, ''), 'web', p_branch)
    returning id into v_patient;
  end if;

  insert into public.patient_consents (tenant_id, patient_id, consent_type, version, granted, ip_address, user_agent)
  values (v_tenant, v_patient, 'data_processing', coalesce(p_policy_version, 'v1'), true,
          split_part(coalesce(private.request_header('x-forwarded-for'), ''), ',', 1), private.request_header('user-agent'));

  insert into public.appointments (tenant_id, branch_id, patient_id, specialist_id, appointment_type_id, starts_at, ends_at, source)
  values (v_tenant, p_branch, v_patient, p_specialist, p_type, p_starts_at, p_starts_at + make_interval(mins => v_duration), 'online')
  returning id into v_appt;

  return jsonb_build_object('appointment_id', v_appt, 'starts_at', p_starts_at);
end $$;

grant execute on function public.booking_catalog(text) to anon, authenticated;
grant execute on function public.booking_slots(text, uuid, uuid, date, uuid) to anon, authenticated;
grant execute on function public.booking_create(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, boolean, text) to anon, authenticated;
