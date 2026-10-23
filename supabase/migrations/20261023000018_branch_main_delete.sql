-- Branches: choose the main one and delete (archive) the ones no longer used.
-- Deleting is a soft delete (deleted_at): sales, movements and appointments keep pointing to it.
-- Rules: a company always keeps at least one branch, the main one can't be deleted (choose another first),
-- and a branch with units, transfers in transit, upcoming appointments or users assigned only to it is blocked.

-- A deleted branch frees its code for a new one.
alter table public.branches drop constraint if exists branches_tenant_id_code_key;
create unique index if not exists branches_tenant_id_code_key on public.branches (tenant_id, code) where deleted_at is null;

create or replace function public.set_main_branch(p_tenant uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_write(p_tenant, 'branches.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.branches where id = p_branch and tenant_id = p_tenant and deleted_at is null and status = 'active') then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Unset first: the partial unique index allows only one main branch at a time.
  update public.branches set is_main = false where tenant_id = p_tenant and is_main and id <> p_branch;
  update public.branches set is_main = true where id = p_branch and not is_main;
end $$;

/** Why a branch can't be deleted, or null when it can. Used by the page (to explain) and by delete_branch. */
create or replace function public.branch_delete_blocker(p_tenant uuid, p_branch uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.is_member(p_tenant) then 'FORBIDDEN'
    when (select count(*) from public.branches where tenant_id = p_tenant and deleted_at is null) <= 1 then 'BRANCH_LAST'
    when exists (select 1 from public.branches where id = p_branch and tenant_id = p_tenant and is_main) then 'BRANCH_IS_MAIN'
    when exists (select 1 from public.inventory_levels where tenant_id = p_tenant and branch_id = p_branch and quantity <> 0) then 'BRANCH_HAS_STOCK'
    when exists (select 1 from public.inventory_transfers where tenant_id = p_tenant and (from_branch_id = p_branch or to_branch_id = p_branch)
                   and status in ('requested', 'approved', 'in_transit')) then 'BRANCH_HAS_TRANSFERS'
    when exists (select 1 from public.appointments where tenant_id = p_tenant and branch_id = p_branch and starts_at >= now()
                   and status in ('scheduled', 'confirmed', 'checked_in', 'waiting', 'in_consultation')) then 'BRANCH_HAS_APPOINTMENTS'
    when exists (select 1 from public.user_roles r where r.tenant_id = p_tenant and r.branch_id = p_branch
                   and not exists (select 1 from public.user_roles o where o.tenant_id = p_tenant and o.user_id = r.user_id
                                     and (o.branch_id is null or o.branch_id <> p_branch))) then 'BRANCH_HAS_USERS'
  end;
$$;

create or replace function public.delete_branch(p_tenant uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_blocker text;
begin
  if not private.can_write(p_tenant, 'branches.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform 1 from public.branches where tenant_id = p_tenant and deleted_at is null for update; -- serialize against a concurrent delete
  if not exists (select 1 from public.branches where id = p_branch and tenant_id = p_tenant and deleted_at is null) then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_blocker := public.branch_delete_blocker(p_tenant, p_branch);
  if v_blocker is not null then raise exception '%', v_blocker using errcode = 'P0001'; end if;

  -- Branch-scoped roles of users who also work elsewhere go away with the branch.
  delete from public.user_roles where tenant_id = p_tenant and branch_id = p_branch;
  update public.branches set deleted_at = now(), status = 'inactive' where id = p_branch;
end $$;

revoke execute on function public.set_main_branch(uuid, uuid), public.branch_delete_blocker(uuid, uuid), public.delete_branch(uuid, uuid) from public, anon;
grant execute on function public.set_main_branch(uuid, uuid), public.branch_delete_blocker(uuid, uuid), public.delete_branch(uuid, uuid) to authenticated;
