-- =============================================================================
-- Reference data (permissions, system roles, plans) + onboarding RPCs.
-- Reference data lives in migrations (not seeds) because the app depends on it.
-- =============================================================================

insert into public.permissions (code, module, description) values
  ('dashboard.view',        'dashboard',       'Ver el inicio'),
  ('patients.read',         'patients',        'Ver pacientes'),
  ('patients.create',       'patients',        'Crear pacientes'),
  ('patients.update',       'patients',        'Editar pacientes'),
  ('patients.delete',       'patients',        'Archivar pacientes'),
  ('patients.export',       'patients',        'Exportar pacientes'),
  ('appointments.read',     'appointments',    'Ver agenda'),
  ('appointments.create',   'appointments',    'Agendar citas'),
  ('appointments.update',   'appointments',    'Modificar y cambiar estado de citas'),
  ('appointments.cancel',   'appointments',    'Cancelar citas'),
  ('schedules.manage',      'appointments',    'Configurar horarios de especialistas'),
  ('medical_records.read',  'medical_records', 'Ver historias clínicas'),
  ('medical_records.create','medical_records', 'Crear historias clínicas'),
  ('medical_records.sign',  'medical_records', 'Firmar historias clínicas'),
  ('medical_records.amend', 'medical_records', 'Enmendar historias firmadas'),
  ('prescriptions.read',    'medical_records', 'Ver fórmulas'),
  ('prescriptions.create',  'medical_records', 'Emitir fórmulas'),
  ('inventory.read',        'inventory',       'Ver inventario'),
  ('inventory.manage',      'inventory',       'Gestionar catálogo de productos'),
  ('inventory.adjust',      'inventory',       'Ajustar stock'),
  ('inventory.transfer',    'inventory',       'Transferir entre sedes'),
  ('suppliers.read',        'purchases',       'Ver proveedores'),
  ('suppliers.manage',      'purchases',       'Gestionar proveedores'),
  ('purchases.read',        'purchases',       'Ver compras'),
  ('purchases.create',      'purchases',       'Crear órdenes de compra'),
  ('purchases.approve',     'purchases',       'Aprobar y recibir compras'),
  ('sales.read',            'sales',           'Ver ventas'),
  ('sales.create',          'sales',           'Registrar ventas'),
  ('sales.discount',        'sales',           'Aplicar descuentos'),
  ('sales.refund',          'sales',           'Devoluciones'),
  ('pos.use',               'sales',           'Usar el punto de venta'),
  ('cash.manage',           'sales',           'Abrir y cerrar caja'),
  ('quotes.read',           'sales',           'Ver cotizaciones'),
  ('quotes.create',         'sales',           'Crear cotizaciones'),
  ('lab_orders.read',       'labs',            'Ver órdenes de laboratorio'),
  ('lab_orders.create',     'labs',            'Crear órdenes de laboratorio'),
  ('lab_orders.update',     'labs',            'Actualizar estado de órdenes'),
  ('lab_orders.qc',         'labs',            'Aprobar control de calidad'),
  ('billing.read',          'billing',         'Ver facturas'),
  ('billing.issue',         'billing',         'Emitir facturas y notas'),
  ('rips.read',             'rips',            'Ver RIPS'),
  ('rips.manage',           'rips',            'Generar y enviar RIPS'),
  ('crm.read',              'crm',             'Ver CRM comercial'),
  ('crm.manage',            'crm',             'Gestionar leads y campañas'),
  ('tasks.manage',          'crm',             'Gestionar tareas'),
  ('reports.read',          'analytics',       'Ver reportes operativos'),
  ('reports.financial',     'analytics',       'Ver reportes financieros'),
  ('team.read',             'team',            'Ver equipo'),
  ('team.manage',           'team',            'Invitar y gestionar usuarios'),
  ('roles.manage',          'team',            'Gestionar roles y permisos'),
  ('branches.manage',       'settings',        'Gestionar sedes'),
  ('settings.manage',       'settings',        'Configurar la empresa'),
  ('integrations.manage',   'settings',        'Configurar integraciones'),
  ('subscription.manage',   'settings',        'Gestionar suscripción'),
  ('audit.read',            'settings',        'Ver auditoría')
on conflict (code) do update set module = excluded.module, description = excluded.description;

-- System role templates
insert into public.roles (tenant_id, code, name, description, is_system) values
  (null, 'OWNER',             'Propietario',          'Acceso total a la empresa', true),
  (null, 'ADMIN',             'Administrador',        'Administra la operación de la empresa', true),
  (null, 'BRANCH_MANAGER',    'Gerente de sede',      'Gestiona una o varias sedes', true),
  (null, 'OPTOMETRIST',       'Optómetra',            'Atención clínica y fórmulas', true),
  (null, 'OPHTHALMOLOGIST',   'Oftalmólogo',          'Atención clínica especializada', true),
  (null, 'SALES_REP',         'Asesor comercial',     'Ventas, cotizaciones y CRM', true),
  (null, 'CASHIER',           'Cajero',               'Cobros y caja', true),
  (null, 'INVENTORY_MANAGER', 'Jefe de inventario',   'Productos, stock, compras', true),
  (null, 'ACCOUNTANT',        'Contador',             'Facturación y reportes financieros', true),
  (null, 'LAB_TECHNICIAN',    'Técnico de laboratorio','Órdenes y control de calidad', true),
  (null, 'RECEPTIONIST',      'Recepción',            'Agenda, check-in y pacientes', true),
  (null, 'MARKETING',         'Marketing',            'Campañas y CRM', true),
  (null, 'VIEWER',            'Solo lectura',         'Consulta sin modificar', true)
on conflict do nothing;

-- Role → permission matrix
with matrix(role_code, perms) as (values
  ('OWNER', null::text[]), -- all permissions
  ('ADMIN', array['dashboard.view','patients.read','patients.create','patients.update','patients.delete','patients.export',
    'appointments.read','appointments.create','appointments.update','appointments.cancel','schedules.manage',
    'prescriptions.read','inventory.read','inventory.manage','inventory.adjust','inventory.transfer',
    'suppliers.read','suppliers.manage','purchases.read','purchases.create','purchases.approve',
    'sales.read','sales.create','sales.discount','sales.refund','pos.use','cash.manage','quotes.read','quotes.create',
    'lab_orders.read','lab_orders.create','lab_orders.update','lab_orders.qc','billing.read','billing.issue',
    'rips.read','rips.manage','crm.read','crm.manage','tasks.manage','reports.read','reports.financial',
    'team.read','team.manage','roles.manage','branches.manage','settings.manage','integrations.manage','audit.read']),
  ('BRANCH_MANAGER', array['dashboard.view','patients.read','patients.create','patients.update',
    'appointments.read','appointments.create','appointments.update','appointments.cancel','schedules.manage',
    'prescriptions.read','inventory.read','inventory.adjust','inventory.transfer','suppliers.read','purchases.read','purchases.create',
    'sales.read','sales.create','sales.discount','sales.refund','pos.use','cash.manage','quotes.read','quotes.create',
    'lab_orders.read','lab_orders.create','lab_orders.update','lab_orders.qc','billing.read','crm.read','crm.manage','tasks.manage',
    'reports.read','team.read']),
  ('OPTOMETRIST', array['dashboard.view','patients.read','patients.create','patients.update',
    'appointments.read','appointments.update','medical_records.read','medical_records.create','medical_records.sign',
    'medical_records.amend','prescriptions.read','prescriptions.create','lab_orders.read','quotes.read','tasks.manage']),
  ('OPHTHALMOLOGIST', array['dashboard.view','patients.read','patients.create','patients.update',
    'appointments.read','appointments.update','medical_records.read','medical_records.create','medical_records.sign',
    'medical_records.amend','prescriptions.read','prescriptions.create','lab_orders.read','rips.read','tasks.manage']),
  ('SALES_REP', array['dashboard.view','patients.read','patients.create','patients.update','appointments.read','appointments.create',
    'prescriptions.read','inventory.read','sales.read','sales.create','pos.use','quotes.read','quotes.create',
    'lab_orders.read','lab_orders.create','crm.read','crm.manage','tasks.manage']),
  ('CASHIER', array['dashboard.view','patients.read','sales.read','sales.create','pos.use','cash.manage','quotes.read','billing.read','inventory.read']),
  ('INVENTORY_MANAGER', array['dashboard.view','inventory.read','inventory.manage','inventory.adjust','inventory.transfer',
    'suppliers.read','suppliers.manage','purchases.read','purchases.create','purchases.approve','reports.read']),
  ('ACCOUNTANT', array['dashboard.view','sales.read','billing.read','billing.issue','rips.read','purchases.read','suppliers.read',
    'reports.read','reports.financial','audit.read']),
  ('LAB_TECHNICIAN', array['dashboard.view','lab_orders.read','lab_orders.update','lab_orders.qc','prescriptions.read']),
  ('RECEPTIONIST', array['dashboard.view','patients.read','patients.create','patients.update',
    'appointments.read','appointments.create','appointments.update','appointments.cancel','lab_orders.read','tasks.manage']),
  ('MARKETING', array['dashboard.view','patients.read','patients.export','crm.read','crm.manage','tasks.manage','reports.read']),
  ('VIEWER', array['dashboard.view','patients.read','appointments.read','inventory.read','sales.read','reports.read'])
)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from matrix m
join public.roles r on r.code = m.role_code and r.tenant_id is null
join public.permissions p on m.perms is null or p.code = any (m.perms)
on conflict do nothing;

-- Features & plans
insert into public.features (code, name, kind) values
  ('MAX_BRANCHES',       'Sedes incluidas', 'limit'),
  ('MAX_USERS',          'Usuarios incluidos', 'limit'),
  ('PATIENT_PORTAL',     'Portal del paciente', 'flag'),
  ('WHATSAPP',           'WhatsApp', 'flag'),
  ('ELECTRONIC_INVOICE', 'Facturación electrónica', 'flag'),
  ('RIPS',               'RIPS / FEV Salud', 'flag'),
  ('LAB_PORTAL',         'Portal de laboratorio', 'flag'),
  ('AUTOMATIONS',        'Automatizaciones', 'flag'),
  ('ADVANCED_ANALYTICS', 'Analítica avanzada', 'flag'),
  ('AI_ASSISTANT',       'Asistente IA', 'flag'),
  ('PUBLIC_API',         'API pública', 'flag'),
  ('WHITE_LABEL',        'Marca blanca', 'flag')
on conflict (code) do nothing;

insert into public.plans (code, name, description, price_monthly, sort_order) values
  ('STARTER',    'Starter',    'Para ópticas que empiezan',          189000, 1),
  ('PRO',        'Pro',        'Para ópticas en crecimiento',        389000, 2),
  ('BUSINESS',   'Business',   'Para cadenas con varias sedes',      890000, 3),
  ('ENTERPRISE', 'Enterprise', 'A la medida de cadenas nacionales',       0, 4)
on conflict (code) do nothing;

with pf(plan_code, feature_code, limit_value) as (values
  ('STARTER','MAX_BRANCHES',1), ('STARTER','MAX_USERS',3),
  ('PRO','MAX_BRANCHES',3), ('PRO','MAX_USERS',10), ('PRO','PATIENT_PORTAL',null), ('PRO','WHATSAPP',null),
  ('PRO','ELECTRONIC_INVOICE',null), ('PRO','RIPS',null), ('PRO','AUTOMATIONS',null),
  ('BUSINESS','MAX_BRANCHES',10), ('BUSINESS','MAX_USERS',40), ('BUSINESS','PATIENT_PORTAL',null), ('BUSINESS','WHATSAPP',null),
  ('BUSINESS','ELECTRONIC_INVOICE',null), ('BUSINESS','RIPS',null), ('BUSINESS','AUTOMATIONS',null), ('BUSINESS','LAB_PORTAL',null),
  ('BUSINESS','ADVANCED_ANALYTICS',null), ('BUSINESS','AI_ASSISTANT',null),
  ('ENTERPRISE','MAX_BRANCHES',null), ('ENTERPRISE','MAX_USERS',null), ('ENTERPRISE','PATIENT_PORTAL',null), ('ENTERPRISE','WHATSAPP',null),
  ('ENTERPRISE','ELECTRONIC_INVOICE',null), ('ENTERPRISE','RIPS',null), ('ENTERPRISE','AUTOMATIONS',null), ('ENTERPRISE','LAB_PORTAL',null),
  ('ENTERPRISE','ADVANCED_ANALYTICS',null), ('ENTERPRISE','AI_ASSISTANT',null), ('ENTERPRISE','PUBLIC_API',null), ('ENTERPRISE','WHITE_LABEL',null)
)
insert into public.plan_features (plan_id, feature_code, limit_value)
select p.id, pf.feature_code, pf.limit_value
from pf join public.plans p on p.code = pf.plan_code
on conflict (plan_id, feature_code) do update set limit_value = excluded.limit_value;

-- =============================================================================
-- RPC: create_tenant — the only path for clients to create a tenant.
-- Runs atomically: tenant + main branch + membership + OWNER role + trial.
-- =============================================================================
create or replace function public.create_tenant(
  p_trade_name  text,
  p_legal_name  text,
  p_slug        text,
  p_tax_id_type text,
  p_tax_id      text,
  p_tax_dv      text,
  p_tax_regime  text,
  p_specialty   text,
  p_branch_name text,
  p_branch_city text,
  p_branch_address text,
  p_branch_phone text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_branch uuid;
  v_owner_role uuid;
  v_plan uuid;
  v_owned int;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  -- Abuse guard: a single account cannot spin up unlimited tenants.
  select count(*) into v_owned from public.tenants where created_by = v_user and deleted_at is null;
  if v_owned >= 5 then
    raise exception 'TENANT_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  select id into v_plan from public.plans where code = 'PRO';

  insert into public.tenants (slug, legal_name, trade_name, tax_id_type, tax_id, tax_dv, tax_regime, specialty, created_by, city)
  values (lower(p_slug), p_legal_name, p_trade_name, coalesce(p_tax_id_type, 'NIT'), nullif(p_tax_id, ''), nullif(p_tax_dv, ''),
          nullif(p_tax_regime, ''), coalesce(p_specialty, 'optometry'), v_user, nullif(p_branch_city, ''))
  returning id into v_tenant;

  -- Subscription first so plan limits resolve for the branch/member triggers.
  insert into public.subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (v_tenant, v_plan, 'trialing', now() + interval '14 days', now(), now() + interval '14 days');

  insert into public.branches (tenant_id, name, code, city, address, phone, is_main)
  values (v_tenant, p_branch_name, 'PRINCIPAL', nullif(p_branch_city, ''), nullif(p_branch_address, ''), nullif(p_branch_phone, ''), true)
  returning id into v_branch;

  insert into public.tenant_members (tenant_id, user_id, status, job_title, default_branch_id, joined_at)
  values (v_tenant, v_user, 'active', 'Propietario', v_branch, now());

  select id into v_owner_role from public.roles where code = 'OWNER' and tenant_id is null;
  insert into public.user_roles (tenant_id, user_id, role_id, branch_id, created_by)
  values (v_tenant, v_user, v_owner_role, null, v_user);

  update public.profiles set active_tenant_id = v_tenant, active_branch_id = v_branch where id = v_user;

  return v_tenant;
end $$;

revoke all on function public.create_tenant(text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_tenant(text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- Effective permissions of the current user in a tenant (for UI gating; RLS still enforces).
create or replace function public.my_permissions(p_tenant uuid)
returns table (permission_code text, branch_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct rp.permission_code, ur.branch_id
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.tenant_members m on m.tenant_id = ur.tenant_id and m.user_id = ur.user_id and m.status = 'active'
  where ur.tenant_id = p_tenant and ur.user_id = auth.uid()
$$;
revoke all on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;

create or replace function public.slug_available(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.tenants where slug = lower(p_slug)::extensions.citext)
$$;
revoke all on function public.slug_available(text) from public, anon;
grant execute on function public.slug_available(text) to authenticated;
