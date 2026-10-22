# Multitenancy

## Modelo
```
tenant (Óptica Nova Vision SAS)
 ├─ branches (Chapinero, Cedritos)
 ├─ tenant_members (usuario ↔ tenant, estado)
 │    └─ user_roles (rol, branch_id | NULL = todas las sedes)
 ├─ subscriptions → plans → plan_features (límites/flags)
 └─ datos de negocio (patients, appointments, …) con tenant_id [+ branch_id]
```

## Resolución del tenant
1. La sesión (cookie Supabase) identifica al usuario.
2. `profiles.active_tenant_id` indica la empresa activa. Cambiarla pasa por un trigger que exige membresía activa.
3. Si un usuario pertenece a varias empresas, el selector del sidebar llama `switchTenantAction` (server).
4. **Nunca** se lee `tenant_id` de query params, body o headers.

## Alcance por sede
- `user_roles.branch_id = NULL` → el permiso aplica a todas las sedes.
- `branch_id = X` → solo sede X. RLS: `private.has_permission(tenant_id, 'appointments.read', branch_id)`.
- Pacientes son de la empresa (compartidos entre sedes); citas, horarios e inventario son por sede.
- La sede activa (`profiles.active_branch_id`) filtra vistas; usuarios con alcance global pueden ver “Todas las sedes”.

## Reglas para nuevas tablas (checklist)
1. ¿Pertenece a un tenant? → `tenant_id uuid not null references tenants`.
2. ¿Pertenece a una sede? → `branch_id` + FK compuesta `(branch_id, tenant_id) → branches(id, tenant_id)`.
3. Referencias a otras entidades del tenant con FK compuesta `(x_id, tenant_id)`.
4. Índice que empiece por `tenant_id`.
5. `enable row level security` + políticas `select/insert/update` con `private.has_permission`/`can_write`.
6. Trigger `private.audit_row()` si es clínica, financiera, de permisos o configuración.
7. Test de aislamiento en `tests/rls`.

## Planes y límites
Los límites (`MAX_BRANCHES`, `MAX_USERS`) se aplican con triggers en la BD (`PLAN_LIMIT_*`), no en la UI. Flags por plan/tenant/global: `private.feature_enabled(tenant, 'WHATSAPP')`.
