-- Business decision (2026-10-23): sales reps (Asesor comercial) may apply discounts with no cap; every discount is
-- stored on its sale line and audited with the sale.
insert into public.role_permissions (role_id, permission_code)
select r.id, 'sales.discount' from public.roles r where r.code = 'SALES_REP' and r.tenant_id is null
on conflict do nothing;
