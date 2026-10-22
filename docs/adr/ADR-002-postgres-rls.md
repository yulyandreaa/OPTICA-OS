# ADR-002 — Aislamiento multitenant con PostgreSQL RLS

- **Estado:** aceptado · 2026-10-16

## Contexto
Cientos/miles de ópticas comparten base de datos. Mezclar datos entre tenants (y más aún historias clínicas) es inaceptable.

## Decisión
- Base de datos compartida, **`tenant_id` obligatorio** en toda tabla de negocio y `branch_id` donde aplica.
- **RLS habilitado en todas las tablas** de `public`. Políticas basadas en funciones `private.is_member`, `private.has_permission(tenant, permiso, sede)` y `private.can_write` (bloquea escritura si el tenant está en `read_only`).
- Las funciones son `SECURITY DEFINER` con `search_path=''` en el esquema `private` (no expuesto por PostgREST), evitando recursión de RLS.
- **FKs compuestas** `(x_id, tenant_id) → (id, tenant_id)` garantizan que una cita no pueda apuntar a un paciente de otro tenant aunque se conozca su UUID.
- La app usa siempre el cliente de Supabase **con la sesión del usuario** (RLS aplica). El service role solo se usa en `/admin`, webhooks y seeds.
- El tenant activo se resuelve en servidor (`profiles.active_tenant_id`), validado por trigger. Nunca se acepta `tenant_id` del navegador.
- Defensa en profundidad: además de RLS, las server actions verifican permisos con `can()` y filtran `.eq("tenant_id", ctx.tenant.id)`.

## Alternativas descartadas
- *Schema por tenant*: migraciones N veces, pooling costoso, analítica de plataforma compleja.
- *Base por tenant*: costo prohibitivo para ópticas pequeñas.

## Verificación
`tests/rls/*.test.ts` (sección 115 del requerimiento): lectura/escritura cruzada entre tenants, por sede, por rol, auto-promoción, auditoría inmutable, límites de plan.
