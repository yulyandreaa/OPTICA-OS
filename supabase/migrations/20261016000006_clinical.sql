-- =============================================================================
-- Phase 03 — Clinical records, optometry exam, prescriptions, signing & amendments.
-- Signed records are frozen: the only way to change them is `amend_medical_record`,
-- which keeps the original values, the change, the reason, the author and a new hash.
-- =============================================================================

-- Per-tenant document numbering (V-000123, C-000045…), gap-free per type.
create table public.document_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  doc_type  text not null,
  prefix    text not null,
  next_value bigint not null default 1,
  primary key (tenant_id, doc_type)
);
alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from anon, authenticated;

create or replace function private.next_number(p_tenant uuid, p_type text, p_prefix text)
returns text language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.document_sequences (tenant_id, doc_type, prefix, next_value)
  values (p_tenant, p_type, p_prefix, 2)
  on conflict (tenant_id, doc_type) do update set next_value = public.document_sequences.next_value + 1
  returning next_value - 1 into v;
  return p_prefix || '-' || lpad(v::text, 6, '0');
end $$;
grant execute on function private.next_number(uuid, text, text) to authenticated, service_role;

create table public.medical_records (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  branch_id          uuid not null,
  patient_id         uuid not null,
  appointment_id     uuid,
  professional_id    uuid not null,
  number             text not null,
  record_type        text not null default 'optometry' check (record_type in ('optometry', 'ophthalmology', 'contact_lens', 'control')),
  status             text not null default 'draft' check (status in ('draft', 'signed', 'amended')),
  chief_complaint    text,
  current_illness    text,
  personal_history   text,
  family_history     text,
  ocular_history     text,
  allergies          text,
  medications        text,
  surgeries          text,
  habits             text,
  symptoms           text,
  external_exam      text,
  observations       text,
  -- Structured exam: { va: {od:{sc_far,cc_far,sc_near,cc_near}, oi:{…}}, refraction: {od:{sphere,cylinder,axis,add,prism,base,va}, oi:{…}},
  --   dp: {binocular, od, oi}, heights: {od, oi}, keratometry: {od:{k1,k2,axis}, oi:{…}}, lensometry: {od, oi}, iop: {od, oi} }
  exam               jsonb not null default '{}'::jsonb,
  diagnoses          jsonb not null default '[]'::jsonb,  -- [{ code: "H52.1", label: "Miopía" }]
  plan               text,
  recommendations    text,
  lens_recommendation jsonb not null default '{}'::jsonb, -- { type, material, treatments: [] }
  signed_at          timestamptz,
  signed_by          uuid references public.profiles(id),
  content_hash       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, number),
  unique (id, tenant_id),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  foreign key (appointment_id, tenant_id) references public.appointments(id, tenant_id),
  foreign key (tenant_id, professional_id) references public.tenant_members(tenant_id, user_id),
  constraint medical_records_professional_profile_fkey foreign key (professional_id) references public.profiles(id)
);
create index medical_records_patient_idx on public.medical_records (tenant_id, patient_id, created_at desc);
create index medical_records_tenant_idx on public.medical_records (tenant_id, created_at desc);

create table public.medical_record_amendments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  record_id    uuid not null,
  reason       text not null check (length(reason) >= 5),
  previous     jsonb not null,
  changes      jsonb not null,
  content_hash text not null,
  amended_by   uuid not null references public.profiles(id),
  amended_at   timestamptz not null default now(),
  foreign key (record_id, tenant_id) references public.medical_records(id, tenant_id)
);
create index medical_record_amendments_idx on public.medical_record_amendments (tenant_id, record_id, amended_at);

create table public.prescriptions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  patient_id      uuid not null,
  record_id       uuid,
  professional_id uuid not null,
  number          text not null,
  kind            text not null default 'glasses' check (kind in ('glasses', 'contact_lens')),
  od_sphere numeric(5,2), od_cylinder numeric(5,2), od_axis smallint check (od_axis between 0 and 180), od_add numeric(4,2),
  od_prism numeric(4,2), od_base text, od_va text,
  oi_sphere numeric(5,2), oi_cylinder numeric(5,2), oi_axis smallint check (oi_axis between 0 and 180), oi_add numeric(4,2),
  oi_prism numeric(4,2), oi_base text, oi_va text,
  dp_binocular numeric(4,1), dp_od numeric(4,1), dp_oi numeric(4,1), height_od numeric(4,1), height_oi numeric(4,1),
  lens_type   text check (lens_type in ('monofocal', 'bifocal', 'progresivo', 'ocupacional', 'descanso', 'contacto')),
  material    text check (material in ('CR-39', 'policarbonato', 'Trivex', 'alto_indice')),
  treatments  text[] not null default '{}',
  notes       text,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (tenant_id, number),
  unique (id, tenant_id),
  foreign key (patient_id, tenant_id) references public.patients(id, tenant_id),
  foreign key (record_id, tenant_id) references public.medical_records(id, tenant_id),
  constraint prescriptions_professional_profile_fkey foreign key (professional_id) references public.profiles(id)
);
create index prescriptions_patient_idx on public.prescriptions (tenant_id, patient_id, issued_at desc);

-- -----------------------------------------------------------------------------
-- Triggers: numbering, freeze signed records, timeline, audit
-- -----------------------------------------------------------------------------
create or replace function private.medical_record_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.number is null or new.number = '' then new.number := private.next_number(new.tenant_id, 'medical_record', 'HC'); end if;
  return new;
end $$;
create trigger medical_records_defaults before insert on public.medical_records for each row execute function private.medical_record_defaults();

create or replace function private.prescription_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.number is null or new.number = '' then new.number := private.next_number(new.tenant_id, 'prescription', 'RX'); end if;
  if new.expires_at is null then new.expires_at := new.issued_at + interval '12 months'; end if;
  return new;
end $$;
create trigger prescriptions_defaults before insert on public.prescriptions for each row execute function private.prescription_defaults();

create or replace function private.freeze_signed_record()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('signed', 'amended') and coalesce(current_setting('app.amending', true), '') <> 'on' then
    raise exception 'RECORD_SIGNED' using errcode = '42501', hint = 'Las historias firmadas solo se modifican mediante una enmienda.';
  end if;
  if new.tenant_id <> old.tenant_id or new.patient_id <> old.patient_id then
    raise exception 'RECORD_IMMUTABLE_KEYS' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger medical_records_freeze before update on public.medical_records for each row execute function private.freeze_signed_record();

create or replace function private.forbid_delete_clinical()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'CLINICAL_DELETE_FORBIDDEN' using errcode = '42501';
end $$;
create trigger medical_records_no_delete before delete on public.medical_records for each row execute function private.forbid_delete_clinical();
create trigger amendments_no_change before update or delete on public.medical_record_amendments for each row execute function private.forbid_mutation();
create trigger prescriptions_no_delete before delete on public.prescriptions for each row execute function private.forbid_delete_clinical();

create trigger medical_records_audit after insert or update on public.medical_records for each row execute function private.audit_row();
create trigger prescriptions_audit after insert or update on public.prescriptions for each row execute function private.audit_row();
create trigger amendments_audit after insert on public.medical_record_amendments for each row execute function private.audit_row();

create or replace function private.clinical_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'medical_records' then
    if tg_op = 'INSERT' then
      insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
      values (new.tenant_id, new.patient_id, 'record.created', 'Consulta iniciada', jsonb_build_object('record_id', new.id), auth.uid());
    elsif new.status = 'signed' and old.status = 'draft' then
      insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
      values (new.tenant_id, new.patient_id, 'record.signed', 'Historia clínica firmada ' || new.number, jsonb_build_object('record_id', new.id), auth.uid());
    end if;
  elsif tg_table_name = 'prescriptions' then
    insert into public.patient_activities (tenant_id, patient_id, type, title, metadata, actor_id)
    values (new.tenant_id, new.patient_id, 'prescription.created', 'Fórmula creada ' || new.number, jsonb_build_object('prescription_id', new.id), auth.uid());
  end if;
  return new;
end $$;
create trigger medical_records_timeline after insert or update of status on public.medical_records for each row execute function private.clinical_timeline();
create trigger prescriptions_timeline after insert on public.prescriptions for each row execute function private.clinical_timeline();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.medical_records enable row level security;
alter table public.medical_record_amendments enable row level security;
alter table public.prescriptions enable row level security;
revoke all on public.medical_records, public.medical_record_amendments, public.prescriptions from anon;

create policy mr_select on public.medical_records for select to authenticated
  using (private.has_permission(tenant_id, 'medical_records.read'));
create policy mr_insert on public.medical_records for insert to authenticated
  with check (private.can_write(tenant_id, 'medical_records.create', branch_id) and professional_id = auth.uid());
create policy mr_update on public.medical_records for update to authenticated
  using (private.can_write(tenant_id, 'medical_records.create', branch_id) and (professional_id = auth.uid() or private.has_permission(tenant_id, 'medical_records.amend')))
  with check (private.can_write(tenant_id, 'medical_records.create', branch_id));

create policy amend_select on public.medical_record_amendments for select to authenticated
  using (private.has_permission(tenant_id, 'medical_records.read'));
create policy amend_insert on public.medical_record_amendments for insert to authenticated
  with check (private.can_write(tenant_id, 'medical_records.amend') and amended_by = auth.uid());

-- Sales reps / opticians may read the prescription without access to the full clinical history.
create policy rx_select on public.prescriptions for select to authenticated
  using (private.has_permission(tenant_id, 'prescriptions.read'));
create policy rx_insert on public.prescriptions for insert to authenticated
  with check (private.can_write(tenant_id, 'prescriptions.create') and professional_id = auth.uid());

-- -----------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER: they run with the caller's RLS)
-- -----------------------------------------------------------------------------
create or replace function private.record_hash(r public.medical_records)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to((to_jsonb(r) - 'status' - 'signed_at' - 'signed_by' - 'content_hash' - 'updated_at')::text, 'UTF8')), 'hex')
$$;
grant execute on function private.record_hash(public.medical_records) to authenticated, service_role;

create or replace function public.sign_medical_record(p_record uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.medical_records;
  rx jsonb;
  v_rx uuid;
begin
  select * into r from public.medical_records where id = p_record for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status <> 'draft' then raise exception 'RECORD_SIGNED' using errcode = 'P0001'; end if;
  if not private.has_permission(r.tenant_id, 'medical_records.sign', r.branch_id) or r.professional_id <> auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if coalesce(r.chief_complaint, '') = '' then raise exception 'RECORD_INCOMPLETE' using errcode = 'P0001', hint = 'Falta el motivo de consulta.'; end if;

  update public.medical_records
     set status = 'signed', signed_at = now(), signed_by = auth.uid(), content_hash = private.record_hash(r)
   where id = p_record;

  -- Issue the prescription from the final refraction, if one was recorded.
  rx := r.exam -> 'refraction';
  if rx is not null and (rx -> 'od' ->> 'sphere' is not null or rx -> 'oi' ->> 'sphere' is not null) then
    insert into public.prescriptions (tenant_id, patient_id, record_id, professional_id, kind,
      od_sphere, od_cylinder, od_axis, od_add, od_prism, od_base, od_va,
      oi_sphere, oi_cylinder, oi_axis, oi_add, oi_prism, oi_base, oi_va,
      dp_binocular, dp_od, dp_oi, height_od, height_oi, lens_type, material, treatments)
    values (r.tenant_id, r.patient_id, r.id, r.professional_id,
      case when r.record_type = 'contact_lens' then 'contact_lens' else 'glasses' end,
      nullif(rx -> 'od' ->> 'sphere', '')::numeric, nullif(rx -> 'od' ->> 'cylinder', '')::numeric, nullif(rx -> 'od' ->> 'axis', '')::smallint,
      nullif(rx -> 'od' ->> 'add', '')::numeric, nullif(rx -> 'od' ->> 'prism', '')::numeric, nullif(rx -> 'od' ->> 'base', ''), nullif(rx -> 'od' ->> 'va', ''),
      nullif(rx -> 'oi' ->> 'sphere', '')::numeric, nullif(rx -> 'oi' ->> 'cylinder', '')::numeric, nullif(rx -> 'oi' ->> 'axis', '')::smallint,
      nullif(rx -> 'oi' ->> 'add', '')::numeric, nullif(rx -> 'oi' ->> 'prism', '')::numeric, nullif(rx -> 'oi' ->> 'base', ''), nullif(rx -> 'oi' ->> 'va', ''),
      nullif(r.exam -> 'dp' ->> 'binocular', '')::numeric, nullif(r.exam -> 'dp' ->> 'od', '')::numeric, nullif(r.exam -> 'dp' ->> 'oi', '')::numeric,
      nullif(r.exam -> 'heights' ->> 'od', '')::numeric, nullif(r.exam -> 'heights' ->> 'oi', '')::numeric,
      nullif(r.lens_recommendation ->> 'type', ''), nullif(r.lens_recommendation ->> 'material', ''),
      coalesce(array(select jsonb_array_elements_text(r.lens_recommendation -> 'treatments')), '{}'))
    returning id into v_rx;
  end if;

  if r.appointment_id is not null then
    update public.appointments set status = 'completed' where id = r.appointment_id and status in ('checked_in', 'waiting', 'in_consultation');
  end if;
  return jsonb_build_object('record_id', p_record, 'prescription_id', v_rx);
end $$;

create or replace function public.amend_medical_record(p_record uuid, p_reason text, p_changes jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  r public.medical_records;
  allowed text[] := array['chief_complaint','current_illness','personal_history','family_history','ocular_history','allergies',
    'medications','surgeries','habits','symptoms','external_exam','observations','exam','diagnoses','plan','recommendations','lens_recommendation'];
  k text;
  prev jsonb := '{}'::jsonb;
  v_id uuid;
begin
  select * into r from public.medical_records where id = p_record for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if r.status = 'draft' then raise exception 'RECORD_NOT_SIGNED' using errcode = 'P0001'; end if;
  if not private.has_permission(r.tenant_id, 'medical_records.amend', r.branch_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if length(coalesce(p_reason, '')) < 5 then raise exception 'AMEND_REASON_REQUIRED' using errcode = 'P0001'; end if;

  for k in select jsonb_object_keys(p_changes) loop
    if not k = any (allowed) then raise exception 'AMEND_FIELD_NOT_ALLOWED: %', k using errcode = 'P0001'; end if;
    prev := prev || jsonb_build_object(k, to_jsonb(r) -> k);
  end loop;

  perform set_config('app.amending', 'on', true);
  update public.medical_records m set
    chief_complaint = coalesce(p_changes ->> 'chief_complaint', m.chief_complaint),
    current_illness = coalesce(p_changes ->> 'current_illness', m.current_illness),
    personal_history = coalesce(p_changes ->> 'personal_history', m.personal_history),
    family_history = coalesce(p_changes ->> 'family_history', m.family_history),
    ocular_history = coalesce(p_changes ->> 'ocular_history', m.ocular_history),
    allergies = coalesce(p_changes ->> 'allergies', m.allergies),
    medications = coalesce(p_changes ->> 'medications', m.medications),
    surgeries = coalesce(p_changes ->> 'surgeries', m.surgeries),
    habits = coalesce(p_changes ->> 'habits', m.habits),
    symptoms = coalesce(p_changes ->> 'symptoms', m.symptoms),
    external_exam = coalesce(p_changes ->> 'external_exam', m.external_exam),
    observations = coalesce(p_changes ->> 'observations', m.observations),
    exam = coalesce(p_changes -> 'exam', m.exam),
    diagnoses = coalesce(p_changes -> 'diagnoses', m.diagnoses),
    plan = coalesce(p_changes ->> 'plan', m.plan),
    recommendations = coalesce(p_changes ->> 'recommendations', m.recommendations),
    lens_recommendation = coalesce(p_changes -> 'lens_recommendation', m.lens_recommendation),
    status = 'amended'
  where id = p_record
  returning * into r;
  update public.medical_records set content_hash = private.record_hash(r) where id = p_record returning * into r;
  perform set_config('app.amending', 'off', true);

  insert into public.medical_record_amendments (tenant_id, record_id, reason, previous, changes, content_hash, amended_by)
  values (r.tenant_id, r.id, p_reason, prev, p_changes, r.content_hash, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.sign_medical_record(uuid), public.amend_medical_record(uuid, text, jsonb) from public, anon;
grant execute on function public.sign_medical_record(uuid), public.amend_medical_record(uuid, text, jsonb) to authenticated;
