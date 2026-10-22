-- =============================================================================
-- Phase 01 — Foundation: multitenancy, RBAC, plans, audit.
-- Every tenant-owned table carries tenant_id and has RLS enabled.
-- Helper functions live in the non-exposed `private` schema.
-- =============================================================================

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Request metadata forwarded by PostgREST (null when called from a direct connection).
create or replace function private.request_header(name text)
returns text language sql stable set search_path = '' as $$
  select nullif(current_setting('request.headers', true), '')::json ->> name
$$;

-- -----------------------------------------------------------------------------
-- Plans & features (global catalog, not tenant-owned)
-- -----------------------------------------------------------------------------
create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z_]+$'),
  name          text not null,
  description   text,
  price_monthly numeric(14,2) not null default 0 check (price_monthly >= 0),
  currency      char(3) not null default 'COP',
  is_public     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create table public.features (
  code        text primary key check (code ~ '^[A-Z_]+$'),
  name        text not null,
  description text,
  kind        text not null default 'flag' check (kind in ('flag', 'limit'))
);

-- limit_value: for kind='limit' features (NULL = unlimited).
create table public.plan_features (
  plan_id      uuid not null references public.plans(id) on delete cascade,
  feature_code text not null references public.features(code) on delete cascade,
  limit_value  int check (limit_value is null or limit_value >= 0),
  primary key (plan_id, feature_code)
);

-- -----------------------------------------------------------------------------
-- Tenants & branches
-- -----------------------------------------------------------------------------
create table public.tenants (
  id                      uuid primary key default gen_random_uuid(),
  slug                    extensions.citext not null unique
                          check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$'),
  legal_name              text not null check (length(legal_name) between 2 and 200),
  trade_name              text not null check (length(trade_name) between 2 and 120),
  tax_id_type             text not null default 'NIT' check (tax_id_type in ('NIT', 'CC', 'CE', 'PP')),
  tax_id                  text,
  tax_dv                  text check (tax_dv is null or tax_dv ~ '^[0-9]$'),
  tax_regime              text check (tax_regime in ('responsable_iva', 'no_responsable_iva', 'simple')),
  email                   extensions.citext,
  phone                   text,
  address                 text,
  city                    text,
  department              text,
  country                 char(2) not null default 'CO',
  timezone                text not null default 'America/Bogota',
  currency                char(3) not null default 'COP',
  locale                  text not null default 'es-CO',
  specialty               text not null default 'optometry'
                          check (specialty in ('optometry', 'ophthalmology', 'both')),
  brand_color             text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path               text,
  status                  text not null default 'active' check (status in ('active', 'read_only', 'suspended', 'cancelled')),
  settings                jsonb not null default '{}'::jsonb,
  onboarding_completed_at timestamptz,
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
create unique index tenants_tax_id_uq on public.tenants (tax_id_type, tax_id) where tax_id is not null and deleted_at is null;

create table public.branches (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  name          text not null check (length(name) between 2 and 120),
  code          text not null check (code ~ '^[A-Z0-9-]{2,12}$'),
  address       text,
  city          text,
  department    text,
  phone         text,
  email         extensions.citext,
  timezone      text,
  is_main       boolean not null default false,
  status        text not null default 'active' check (status in ('active', 'inactive')),
  opening_hours jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (tenant_id, code),
  unique (id, tenant_id) -- target for composite FKs (guarantees same-tenant references)
);
create index branches_tenant_idx on public.branches (tenant_id) where deleted_at is null;
create unique index branches_one_main_uq on public.branches (tenant_id) where is_main and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users) & memberships
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null default '',
  email             extensions.citext,
  phone             text,
  avatar_path       text,
  active_tenant_id  uuid references public.tenants(id) on delete set null,
  active_branch_id  uuid references public.branches(id) on delete set null,
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.tenant_members (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  user_id              uuid not null references public.profiles(id) on delete cascade,
  status               text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  job_title            text,
  professional_license text, -- registro / tarjeta profesional (optómetras, oftalmólogos)
  default_branch_id    uuid,
  invited_by           uuid references public.profiles(id) on delete set null,
  joined_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, user_id),
  foreign key (default_branch_id, tenant_id) references public.branches(id, tenant_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id) where status = 'active';

-- -----------------------------------------------------------------------------
-- RBAC
-- -----------------------------------------------------------------------------
create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module      text not null,
  description text not null
);

-- tenant_id NULL => system role template shared by every tenant (managed via migrations only).
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z_]+$'),
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  check (is_system = (tenant_id is null))
);
create unique index roles_code_uq on public.roles (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

-- branch_id NULL => role applies to every branch of the tenant.
create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  branch_id  uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id) references public.tenant_members(tenant_id, user_id) on delete cascade
);
create unique index user_roles_uq on public.user_roles
  (tenant_id, user_id, role_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index user_roles_lookup_idx on public.user_roles (user_id, tenant_id);

-- Invitations: only the SHA-256 hash of the token is stored.
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  email       extensions.citext not null,
  role_id     uuid not null references public.roles(id) on delete cascade,
  branch_id   uuid,
  token_hash  text not null unique,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by  uuid references public.profiles(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (branch_id, tenant_id) references public.branches(id, tenant_id) on delete cascade
);
create index invitations_tenant_idx on public.invitations (tenant_id, status);

-- -----------------------------------------------------------------------------
-- SaaS subscriptions (our billing to the óptica — separate from óptica→patient billing)
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null unique references public.tenants(id) on delete cascade,
  plan_id              uuid not null references public.plans(id),
  status               text not null default 'trialing'
                       check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  trial_ends_at        timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  grace_period_ends_at timestamptz,
  extra_branches       int not null default 0 check (extra_branches >= 0),
  extra_users          int not null default 0 check (extra_users >= 0),
  provider             text, -- 'wompi' | 'stripe' | 'manual'
  provider_ref         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.tenant_feature_overrides (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  feature_code text not null references public.features(code) on delete cascade,
  enabled      boolean not null,
  limit_value  int,
  reason       text,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, feature_code)
);

-- Global kill-switches (e.g. disable WHATSAPP platform-wide during an incident).
create table public.global_feature_flags (
  feature_code text primary key references public.features(code) on delete cascade,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants(id) on delete set null,
  user_id     uuid,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  ip_address  text,
  user_agent  text,
  request_id  text,
  created_at  timestamptz not null default now()
);
create index audit_logs_tenant_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create or replace function private.forbid_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function private.forbid_mutation();

-- Generic row audit. Columns listed in TG_ARGV are redacted.
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_tenant uuid;
  v_id text;
  i int;
begin
  if tg_argv is not null then
    for i in 0 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
      v_old := v_old - tg_argv[i];
      v_new := v_new - tg_argv[i];
    end loop;
  end if;

  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  v_tenant := coalesce(v_new, v_old) ->> 'tenant_id';
  if tg_table_name = 'tenants' then
    v_tenant := coalesce(v_new, v_old) ->> 'id';
  end if;
  v_id := coalesce(v_new, v_old) ->> 'id';

  insert into public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, request_id)
  values (
    v_tenant,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_id,
    v_old,
    v_new,
    split_part(coalesce(private.request_header('x-forwarded-for'), ''), ',', 1),
    private.request_header('user-agent'),
    private.request_header('x-request-id')
  );
  return coalesce(new, old);
end $$;

-- -----------------------------------------------------------------------------
-- Authorization helpers (used by RLS). SECURITY DEFINER so they can read
-- membership tables without recursive RLS evaluation.
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant
      and m.user_id = auth.uid()
      and m.status = 'active'
      and t.status <> 'cancelled'
      and t.deleted_at is null
  )
$$;

-- p_branch NULL => record is tenant-wide; any matching role grants access.
-- Otherwise the role must be tenant-wide (branch_id NULL) or bound to that branch.
create or replace function private.has_permission(p_tenant uuid, p_permission text, p_branch uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.tenant_members m on m.tenant_id = ur.tenant_id and m.user_id = ur.user_id
    join public.tenants t on t.id = ur.tenant_id
    where ur.tenant_id = p_tenant
      and ur.user_id = auth.uid()
      and m.status = 'active'
      and t.status in ('active', 'read_only')
      and t.deleted_at is null
      and rp.permission_code = p_permission
      and (p_branch is null or ur.branch_id is null or ur.branch_id = p_branch)
  )
$$;

-- Write permission: also blocks writes when the tenant is read-only (grace period expired).
create or replace function private.can_write(p_tenant uuid, p_permission text, p_branch uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_tenant, p_permission, p_branch)
     and exists (select 1 from public.tenants t where t.id = p_tenant and t.status = 'active')
$$;

-- Effective limit of a 'limit' feature for a tenant (NULL = unlimited).
create or replace function private.plan_limit(p_tenant uuid, p_feature text)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.limit_value from public.tenant_feature_overrides o
      where o.tenant_id = p_tenant and o.feature_code = p_feature and o.enabled),
    (select pf.limit_value
              + case p_feature when 'MAX_BRANCHES' then s.extra_branches
                               when 'MAX_USERS' then s.extra_users else 0 end
       from public.subscriptions s
       join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_code = p_feature
      where s.tenant_id = p_tenant)
  )
$$;

create or replace function private.feature_enabled(p_tenant uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select g.enabled from public.global_feature_flags g where g.feature_code = p_feature), true)
     and coalesce(
       (select o.enabled from public.tenant_feature_overrides o where o.tenant_id = p_tenant and o.feature_code = p_feature),
       exists (select 1 from public.subscriptions s
                 join public.plan_features pf on pf.plan_id = s.plan_id
                where s.tenant_id = p_tenant and pf.feature_code = p_feature)
     )
$$;

grant execute on function private.is_member(uuid), private.has_permission(uuid, text, uuid),
  private.can_write(uuid, text, uuid), private.plan_limit(uuid, text), private.feature_enabled(uuid, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Plan limit enforcement (DB-level, never only in UI)
-- -----------------------------------------------------------------------------
create or replace function private.enforce_branch_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit int; v_count int;
begin
  v_limit := private.plan_limit(new.tenant_id, 'MAX_BRANCHES');
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.branches
   where tenant_id = new.tenant_id and deleted_at is null and status = 'active';
  if v_count >= v_limit then
    raise exception 'PLAN_LIMIT_BRANCHES' using errcode = 'P0001', hint = 'Actualiza tu plan para agregar más sedes.';
  end if;
  return new;
end $$;

create trigger branches_plan_limit before insert on public.branches
  for each row execute function private.enforce_branch_limit();

create or replace function private.enforce_user_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit int; v_count int;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then return new; end if;
  v_limit := private.plan_limit(new.tenant_id, 'MAX_USERS');
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.tenant_members
   where tenant_id = new.tenant_id and status = 'active';
  if v_count >= v_limit then
    raise exception 'PLAN_LIMIT_USERS' using errcode = 'P0001', hint = 'Actualiza tu plan para agregar más usuarios.';
  end if;
  return new;
end $$;

create trigger tenant_members_plan_limit before insert or update of status on public.tenant_members
  for each row execute function private.enforce_user_limit();

-- -----------------------------------------------------------------------------
-- Profiles: auto-create on signup; guard sensitive columns.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- active tenant/branch must be ones the user actually belongs to.
create or replace function private.guard_profile_context()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active_tenant_id is not null and new.active_tenant_id is distinct from old.active_tenant_id then
    if not exists (select 1 from public.tenant_members m
                    where m.tenant_id = new.active_tenant_id and m.user_id = new.id and m.status = 'active') then
      raise exception 'NOT_A_MEMBER' using errcode = '42501';
    end if;
    new.active_branch_id := null;
  end if;
  if new.active_branch_id is not null and new.active_branch_id is distinct from old.active_branch_id then
    if not exists (select 1 from public.branches b
                    where b.id = new.active_branch_id and b.tenant_id = new.active_tenant_id and b.deleted_at is null) then
      raise exception 'INVALID_BRANCH' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard_context before update on public.profiles
  for each row execute function private.guard_profile_context();

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create trigger tenants_updated_at before update on public.tenants for each row execute function private.set_updated_at();
create trigger branches_updated_at before update on public.branches for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger tenant_members_updated_at before update on public.tenant_members for each row execute function private.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function private.set_updated_at();

-- Audit triggers
create trigger tenants_audit after insert or update or delete on public.tenants for each row execute function private.audit_row();
create trigger branches_audit after insert or update or delete on public.branches for each row execute function private.audit_row();
create trigger tenant_members_audit after insert or update or delete on public.tenant_members for each row execute function private.audit_row();
create trigger user_roles_audit after insert or update or delete on public.user_roles for each row execute function private.audit_row();
create trigger roles_audit after insert or update or delete on public.roles for each row execute function private.audit_row();
create trigger invitations_audit after insert or update or delete on public.invitations for each row execute function private.audit_row('token_hash');
create trigger subscriptions_audit after insert or update or delete on public.subscriptions for each row execute function private.audit_row();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.plans                     enable row level security;
alter table public.features                  enable row level security;
alter table public.plan_features             enable row level security;
alter table public.tenants                   enable row level security;
alter table public.branches                  enable row level security;
alter table public.profiles                  enable row level security;
alter table public.tenant_members            enable row level security;
alter table public.permissions               enable row level security;
alter table public.roles                     enable row level security;
alter table public.role_permissions          enable row level security;
alter table public.user_roles                enable row level security;
alter table public.invitations               enable row level security;
alter table public.subscriptions             enable row level security;
alter table public.tenant_feature_overrides  enable row level security;
alter table public.global_feature_flags      enable row level security;
alter table public.audit_logs                enable row level security;

-- Defense in depth: anon never touches tenant data directly.
revoke all on all tables in schema public from anon;

-- Catalogs readable by signed-in users.
create policy plans_read on public.plans for select to authenticated using (true);
create policy features_read on public.features for select to authenticated using (true);
create policy plan_features_read on public.plan_features for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy global_flags_read on public.global_feature_flags for select to authenticated using (true);

-- Tenants
create policy tenants_select on public.tenants for select to authenticated
  using (private.is_member(id));
create policy tenants_update on public.tenants for update to authenticated
  using (private.can_write(id, 'settings.manage'))
  with check (private.can_write(id, 'settings.manage'));
-- INSERT only via public.create_tenant(); no DELETE from clients.
-- Column-level grant: status/slug/ownership columns are only changed server-side.
revoke update on public.tenants from authenticated;
grant update (legal_name, trade_name, tax_id_type, tax_id, tax_dv, tax_regime, email, phone, address,
              city, department, timezone, specialty, brand_color, logo_path, settings)
  on public.tenants to authenticated;

-- Branches
create policy branches_select on public.branches for select to authenticated
  using (private.is_member(tenant_id));
create policy branches_insert on public.branches for insert to authenticated
  with check (private.can_write(tenant_id, 'branches.manage'));
create policy branches_update on public.branches for update to authenticated
  using (private.can_write(tenant_id, 'branches.manage', id))
  with check (private.can_write(tenant_id, 'branches.manage', id));

-- Profiles: self + co-members of any shared tenant.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.tenant_members mine
      join public.tenant_members theirs on theirs.tenant_id = mine.tenant_id
      where mine.user_id = auth.uid() and mine.status = 'active' and theirs.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_path, active_tenant_id, active_branch_id) on public.profiles to authenticated;

-- Memberships
create policy members_select on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or private.has_permission(tenant_id, 'team.read'));
create policy members_insert on public.tenant_members for insert to authenticated
  with check (private.can_write(tenant_id, 'team.manage'));
create policy members_update on public.tenant_members for update to authenticated
  using (private.can_write(tenant_id, 'team.manage'))
  with check (private.can_write(tenant_id, 'team.manage'));

-- Roles: system templates + tenant custom roles.
create policy roles_select on public.roles for select to authenticated
  using (tenant_id is null or private.is_member(tenant_id));
create policy roles_write on public.roles for all to authenticated
  using (tenant_id is not null and private.can_write(tenant_id, 'roles.manage'))
  with check (tenant_id is not null and is_system = false and private.can_write(tenant_id, 'roles.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and (r.tenant_id is null or private.is_member(r.tenant_id))));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and r.tenant_id is not null and private.can_write(r.tenant_id, 'roles.manage')))
  with check (exists (select 1 from public.roles r where r.id = role_id and r.tenant_id is not null and private.can_write(r.tenant_id, 'roles.manage')));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.has_permission(tenant_id, 'team.read'));
create policy user_roles_write on public.user_roles for all to authenticated
  using (private.can_write(tenant_id, 'roles.manage'))
  with check (
    private.can_write(tenant_id, 'roles.manage')
    and exists (select 1 from public.roles r where r.id = role_id and (r.tenant_id is null or r.tenant_id = user_roles.tenant_id))
  );

-- Invitations
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_permission(tenant_id, 'team.manage'));
create policy invitations_write on public.invitations for all to authenticated
  using (private.can_write(tenant_id, 'team.manage'))
  with check (private.can_write(tenant_id, 'team.manage'));

-- Subscriptions / overrides: readable by members; writes only by service role (SaaS billing).
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (private.is_member(tenant_id));
create policy overrides_select on public.tenant_feature_overrides for select to authenticated
  using (private.is_member(tenant_id));

-- Audit: readable with audit.read; inserts happen only via SECURITY DEFINER triggers.
create policy audit_select on public.audit_logs for select to authenticated
  using (tenant_id is not null and private.has_permission(tenant_id, 'audit.read'));
revoke insert, update, delete on public.audit_logs from authenticated;
