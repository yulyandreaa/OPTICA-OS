-- =============================================================================
-- Team invitations. Tokens are generated and SHA-256 hashed by the app; the DB
-- only ever sees the hash. Acceptance is atomic and bound to the invited email.
-- =============================================================================

create or replace function public.invitation_preview(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', t.trade_name,
    'role', r.name,
    'branch', b.name,
    'email', i.email,
    'status', case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end
  )
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id
  join public.roles r on r.id = i.role_id
  left join public.branches b on b.id = i.branch_id
  where i.token_hash = p_token_hash
$$;

create or replace function public.accept_invitation(p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.invitations%rowtype;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = v_user;

  select * into v_inv from public.invitations where token_hash = p_token_hash for update;
  if not found or v_inv.status <> 'pending' then raise exception 'INVITATION_INVALID' using errcode = 'P0001'; end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'INVITATION_EXPIRED' using errcode = 'P0001';
  end if;
  if lower(v_inv.email::text) <> lower(coalesce(v_email, '')) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = '42501';
  end if;

  insert into public.tenant_members (tenant_id, user_id, status, invited_by, default_branch_id, joined_at)
  values (v_inv.tenant_id, v_user, 'active', v_inv.invited_by, v_inv.branch_id, now())
  on conflict (tenant_id, user_id) do update set status = 'active', joined_at = coalesce(public.tenant_members.joined_at, now());

  insert into public.user_roles (tenant_id, user_id, role_id, branch_id, created_by)
  values (v_inv.tenant_id, v_user, v_inv.role_id, v_inv.branch_id, v_inv.invited_by)
  on conflict do nothing;

  update public.invitations set status = 'accepted', accepted_at = now() where id = v_inv.id;
  update public.profiles set active_tenant_id = v_inv.tenant_id where id = v_user;
  return v_inv.tenant_id;
end $$;

revoke all on function public.invitation_preview(text), public.accept_invitation(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
