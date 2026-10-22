-- Lens recommendation becomes free text written by the optometrist (lens_recommendation.text),
-- because each optical store words lenses, materials and treatments differently.
-- Signing now copies that text to prescriptions.notes, so the printed formula and lab orders carry it.
-- Old records keep their structured type / material / treatments values untouched.

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
      dp_binocular, dp_od, dp_oi, height_od, height_oi, lens_type, material, treatments, notes)
    values (r.tenant_id, r.patient_id, r.id, r.professional_id,
      case when r.record_type = 'contact_lens' then 'contact_lens' else 'glasses' end,
      nullif(rx -> 'od' ->> 'sphere', '')::numeric, nullif(rx -> 'od' ->> 'cylinder', '')::numeric, nullif(rx -> 'od' ->> 'axis', '')::smallint,
      nullif(rx -> 'od' ->> 'add', '')::numeric, nullif(rx -> 'od' ->> 'prism', '')::numeric, nullif(rx -> 'od' ->> 'base', ''), nullif(rx -> 'od' ->> 'va', ''),
      nullif(rx -> 'oi' ->> 'sphere', '')::numeric, nullif(rx -> 'oi' ->> 'cylinder', '')::numeric, nullif(rx -> 'oi' ->> 'axis', '')::smallint,
      nullif(rx -> 'oi' ->> 'add', '')::numeric, nullif(rx -> 'oi' ->> 'prism', '')::numeric, nullif(rx -> 'oi' ->> 'base', ''), nullif(rx -> 'oi' ->> 'va', ''),
      nullif(r.exam -> 'dp' ->> 'binocular', '')::numeric, nullif(r.exam -> 'dp' ->> 'od', '')::numeric, nullif(r.exam -> 'dp' ->> 'oi', '')::numeric,
      nullif(r.exam -> 'heights' ->> 'od', '')::numeric, nullif(r.exam -> 'heights' ->> 'oi', '')::numeric,
      nullif(r.lens_recommendation ->> 'type', ''), nullif(r.lens_recommendation ->> 'material', ''),
      coalesce(array(select jsonb_array_elements_text(r.lens_recommendation -> 'treatments')), '{}'),
      nullif(btrim(r.lens_recommendation ->> 'text'), ''))
    returning id into v_rx;
  end if;

  if r.appointment_id is not null then
    update public.appointments set status = 'completed' where id = r.appointment_id and status in ('checked_in', 'waiting', 'in_consultation');
  end if;
  return jsonb_build_object('record_id', p_record, 'prescription_id', v_rx);
end $$;
