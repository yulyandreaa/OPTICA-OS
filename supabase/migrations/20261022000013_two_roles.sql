-- The product exposes two profiles: Administrador (store owner, full access including optometry)
-- and Asesor comercial. The other system roles stay in the catalog (existing members keep working)
-- but can no longer be assigned through invitations.

alter table public.roles add column if not exists is_assignable boolean not null default true;

update public.roles
   set name = 'Administrador', description = 'Dueño de la óptica: acceso total, incluida la atención optométrica'
 where tenant_id is null and code = 'OWNER';

update public.roles
   set is_assignable = (code in ('OWNER', 'SALES_REP'))
 where tenant_id is null;

create or replace function private.invitation_role_assignable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.roles where id = new.role_id and is_assignable) then
    raise exception 'ROLE_NOT_ASSIGNABLE' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists invitations_role_assignable on public.invitations;
create trigger invitations_role_assignable
  before insert or update of role_id on public.invitations
  for each row execute function private.invitation_role_assignable();
