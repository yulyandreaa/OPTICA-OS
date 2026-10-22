-- "Clientes y pacientes": one person record per company (public.patients keeps its name; every module
-- already points to it). A person can be a customer, a patient, or both, and can be deactivated
-- without losing history. Clinical data stays in medical_records / prescriptions under their own permissions.
--
--   is_customer   set by hand, and automatically when the person gets a sale or a quote
--   is_patient    set by hand, and automatically on an appointment, medical record or prescription
--                 (default true: online booking and older paths create patients)
--   is_active     false = inactive; requires patients.delete. Never removes rows or history.
-- Roles are only ever added automatically, never removed.

alter table public.patients
  add column if not exists is_customer boolean not null default false,
  add column if not exists is_patient boolean not null default true,
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles(id) on delete set null;

-- Backfill from real history (bypasses the archive guard: no auth.uid() in migrations).
update public.patients p set
  is_customer = exists (select 1 from public.sales s where s.patient_id = p.id)
             or exists (select 1 from public.quotes q where q.patient_id = p.id),
  is_patient = exists (select 1 from public.appointments a where a.patient_id = p.id)
            or exists (select 1 from public.medical_records m where m.patient_id = p.id)
            or exists (select 1 from public.prescriptions r where r.patient_id = p.id)
            or not (exists (select 1 from public.sales s where s.patient_id = p.id)
                    or exists (select 1 from public.quotes q where q.patient_id = p.id));

alter table public.patients drop constraint if exists patients_has_role;
alter table public.patients add constraint patients_has_role check (is_customer or is_patient);

create index if not exists patients_directory_idx on public.patients (tenant_id, is_active, created_at desc, id) where deleted_at is null;
create index if not exists patients_email_idx on public.patients (tenant_id, email);

-- Deactivating / reactivating needs the same permission as archiving.
create or replace function private.guard_patient_archive()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if ((old.deleted_at is null and new.deleted_at is not null) or new.is_active is distinct from old.is_active)
     and auth.uid() is not null
     and not private.has_permission(new.tenant_id, 'patients.delete') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id then
    raise exception 'TENANT_IMMUTABLE' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    new.deactivated_at := case when new.is_active then null else now() end;
    new.deactivated_by := case when new.is_active then null else auth.uid() end;
  end if;
  return new;
end $$;

-- Automatic roles. security definer: the seller creating a sale may lack patients.update.
create or replace function private.mark_person_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.patient_id is not null then
    if tg_argv[0] = 'customer' then
      update public.patients set is_customer = true where id = new.patient_id and tenant_id = new.tenant_id and not is_customer;
    else
      update public.patients set is_patient = true where id = new.patient_id and tenant_id = new.tenant_id and not is_patient;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sales_mark_customer on public.sales;
create trigger sales_mark_customer after insert on public.sales for each row execute function private.mark_person_role('customer');
drop trigger if exists quotes_mark_customer on public.quotes;
create trigger quotes_mark_customer after insert on public.quotes for each row execute function private.mark_person_role('customer');
drop trigger if exists appointments_mark_patient on public.appointments;
create trigger appointments_mark_patient after insert on public.appointments for each row execute function private.mark_person_role('patient');
drop trigger if exists medical_records_mark_patient on public.medical_records;
create trigger medical_records_mark_patient after insert on public.medical_records for each row execute function private.mark_person_role('patient');
drop trigger if exists prescriptions_mark_patient on public.prescriptions;
create trigger prescriptions_mark_patient after insert on public.prescriptions for each row execute function private.mark_person_role('patient');

-- Timeline entry names the relationship instead of always saying "patient".
create or replace function private.patient_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.patient_activities (tenant_id, patient_id, type, title, actor_id, occurred_at)
  values (new.tenant_id, new.id, 'patient.created',
          case when new.is_customer and new.is_patient then 'Registrado como cliente y paciente'
               when new.is_customer then 'Registrado como cliente' else 'Registrado como paciente' end,
          auth.uid(), new.created_at);
  return new;
end $$;

-- Role changes and (de)activation leave a readable trace in the person's timeline (audit_logs keeps the full diff).
create or replace function private.person_changes_timeline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active is distinct from old.is_active then
    insert into public.patient_activities (tenant_id, patient_id, type, title, actor_id)
    values (new.tenant_id, new.id, case when new.is_active then 'person.reactivated' else 'person.deactivated' end,
            case when new.is_active then 'Registro reactivado' else 'Registro desactivado' end, auth.uid());
  end if;
  if new.is_customer and not old.is_customer then
    insert into public.patient_activities (tenant_id, patient_id, type, title, actor_id) values (new.tenant_id, new.id, 'person.customer', 'Ahora también es cliente', auth.uid());
  end if;
  if new.is_patient and not old.is_patient then
    insert into public.patient_activities (tenant_id, patient_id, type, title, actor_id) values (new.tenant_id, new.id, 'person.patient', 'Ahora también es paciente', auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists patients_changes_timeline on public.patients;
create trigger patients_changes_timeline after update of is_active, is_customer, is_patient on public.patients
  for each row execute function private.person_changes_timeline();

-- Directory counters (overlapping: someone with both roles counts in each, once in "total").
create or replace function public.people_summary(p_tenant uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*) filter (where is_active),
    'customers', count(*) filter (where is_active and is_customer),
    'patients', count(*) filter (where is_active and is_patient),
    'both', count(*) filter (where is_active and is_customer and is_patient),
    'inactive', count(*) filter (where not is_active)
  )
  from public.patients
  where tenant_id = p_tenant and deleted_at is null
$$;

-- Possible duplicates for the form. Only identification/contact fields, never clinical data.
-- 'document' (same type+number) is a hard duplicate; the rest are hints the user resolves.
create or replace function public.find_person_matches(
  p_tenant uuid, p_document_type text, p_document_number text, p_first_name text, p_last_name text,
  p_birth_date date default null, p_phone text default null, p_email text default null, p_exclude uuid default null
) returns table (id uuid, full_name text, document_type text, document_number text, phone text, email text, is_active boolean, reasons text[])
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.document_type, p.document_number, p.phone, p.email::text, p.is_active,
         array_remove(array[
           case when p.document_type = p_document_type and p.document_number = p_document_number then 'document' end,
           case when p.document_number = p_document_number and p.document_type <> p_document_type then 'document_number' end,
           case when lower(p.first_name) = lower(p_first_name) and lower(p.last_name) = lower(p_last_name)
                 and (p_birth_date is null or p.birth_date is null or p.birth_date = p_birth_date) then 'name' end,
           case when nullif(p_phone, '') is not null and (p.phone = p_phone or p.whatsapp = p_phone) then 'phone' end,
           case when nullif(p_email, '') is not null and p.email = p_email::extensions.citext then 'email' end
         ], null) as reasons
    from public.patients p
   where p.tenant_id = p_tenant and p.deleted_at is null and (p_exclude is null or p.id <> p_exclude)
     and (p.document_number = p_document_number
          or (lower(p.first_name) = lower(p_first_name) and lower(p.last_name) = lower(p_last_name))
          or (nullif(p_phone, '') is not null and (p.phone = p_phone or p.whatsapp = p_phone))
          or (nullif(p_email, '') is not null and p.email = p_email::extensions.citext))
   order by (p.document_number = p_document_number) desc, p.full_name
   limit 5
$$;

revoke all on function public.people_summary(uuid), public.find_person_matches(uuid, text, text, text, text, date, text, text, uuid) from public, anon;
grant execute on function public.people_summary(uuid), public.find_person_matches(uuid, text, text, text, text, date, text, text, uuid) to authenticated;
