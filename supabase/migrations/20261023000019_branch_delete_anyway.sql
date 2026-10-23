-- Deleting a branch no longer asks the owner to clean up first: the database does it in the same transaction.
--   · Main branch → another branch becomes the main one (the first by name).
--   · Pending transfers to/from it are cancelled (units in transit go back to their origin).
--   · Its units move to the main branch with a transfer (sent and received at once), so stock and lots stay traceable.
--   · Upcoming appointments are cancelled with the reason "Sede eliminada".
--   · Users who only worked there are assigned to the main branch; other branch-scoped roles there are removed.
-- The only hard rule left: a company keeps at least one branch.

create or replace function public.branch_delete_blocker(p_tenant uuid, p_branch uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.is_member(p_tenant) then 'FORBIDDEN'
    when (select count(*) from public.branches where tenant_id = p_tenant and deleted_at is null) <= 1 then 'BRANCH_LAST'
  end;
$$;

/** Where things go if p_branch is deleted: the branch that receives them (and becomes main if needed). */
create or replace function private.branch_delete_target(p_tenant uuid, p_branch uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.branches
   where tenant_id = p_tenant and deleted_at is null and id <> p_branch
   order by is_main desc, (status = 'active') desc, name
   limit 1;
$$;

/** What deleting p_branch will do, for the confirmation dialog. */
create or replace function public.branch_delete_impact(p_tenant uuid, p_branch uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with target as (select private.branch_delete_target(p_tenant, p_branch) as id)
  select case when not private.is_member(p_tenant) then null else jsonb_build_object(
    'target', (select name from public.branches where id = (select id from target)),
    'becomes_main', exists (select 1 from public.branches where id = p_branch and is_main),
    'units', (select coalesce(sum(quantity), 0) from public.inventory_levels where tenant_id = p_tenant and branch_id = p_branch and quantity > 0),
    'transfers', (select count(*) from public.inventory_transfers where tenant_id = p_tenant and (from_branch_id = p_branch or to_branch_id = p_branch)
                    and status in ('requested', 'approved', 'in_transit')),
    'appointments', (select count(*) from public.appointments where tenant_id = p_tenant and branch_id = p_branch and starts_at >= now()
                       and status in ('scheduled', 'confirmed', 'checked_in', 'waiting', 'in_consultation')),
    'users', (select count(distinct r.user_id) from public.user_roles r where r.tenant_id = p_tenant and r.branch_id = p_branch
                and not exists (select 1 from public.user_roles o where o.tenant_id = p_tenant and o.user_id = r.user_id
                                  and (o.branch_id is null or o.branch_id <> p_branch)))
  ) end;
$$;

create or replace function public.delete_branch(p_tenant uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_items jsonb; v_transfer uuid; t record;
begin
  if not private.can_write(p_tenant, 'branches.manage') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform 1 from public.branches where tenant_id = p_tenant and deleted_at is null for update; -- serialize against a concurrent delete
  if not exists (select 1 from public.branches where id = p_branch and tenant_id = p_tenant and deleted_at is null) then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_target := private.branch_delete_target(p_tenant, p_branch);
  if v_target is null then raise exception 'BRANCH_LAST' using errcode = 'P0001'; end if;

  if exists (select 1 from public.branches where id = p_branch and is_main) then
    update public.branches set is_main = false where id = p_branch;
    update public.branches set is_main = true, status = 'active' where id = v_target;
  end if;

  for t in select id from public.inventory_transfers where tenant_id = p_tenant and (from_branch_id = p_branch or to_branch_id = p_branch)
             and status in ('requested', 'approved', 'in_transit') loop
    perform public.cancel_transfer(t.id, 'Sede eliminada');
  end loop;

  select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity)) into v_items
    from public.inventory_levels where tenant_id = p_tenant and branch_id = p_branch and quantity > 0;
  if v_items is not null then
    v_transfer := public.create_transfer(jsonb_build_object('tenant_id', p_tenant, 'from_branch_id', p_branch, 'to_branch_id', v_target,
                                                            'items', v_items, 'notes', 'Sede eliminada: existencias trasladadas'));
    perform public.receive_transfer(v_transfer);
  end if;

  update public.appointments set status = 'cancelled', cancellation_reason = 'Sede eliminada'
   where tenant_id = p_tenant and branch_id = p_branch and starts_at >= now()
     and status in ('scheduled', 'confirmed', 'checked_in', 'waiting', 'in_consultation');

  insert into public.user_roles (tenant_id, user_id, role_id, branch_id)
  select r.tenant_id, r.user_id, r.role_id, v_target from public.user_roles r
   where r.tenant_id = p_tenant and r.branch_id = p_branch
     and not exists (select 1 from public.user_roles o where o.tenant_id = p_tenant and o.user_id = r.user_id
                       and (o.branch_id is null or o.branch_id <> p_branch))
  on conflict do nothing;
  delete from public.user_roles where tenant_id = p_tenant and branch_id = p_branch;

  update public.branches set deleted_at = now(), status = 'inactive' where id = p_branch;
end $$;

revoke execute on function public.branch_delete_impact(uuid, uuid) from public, anon;
grant execute on function public.branch_delete_impact(uuid, uuid) to authenticated;
revoke execute on function private.branch_delete_target(uuid, uuid) from public, anon, authenticated;
