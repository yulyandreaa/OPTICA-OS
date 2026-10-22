# Phase 01 — Foundation

> Estado: **en implementación** · Fecha: 2026-10-16

## Estado inicial del proyecto

Proyecto nuevo (`create-next-app`). No existía código previo.

| Aspecto | Decisión |
|---|---|
| Framework | Next.js 16.4 (App Router, Turbopack, `proxy.ts` reemplaza a `middleware.ts`) |
| UI | React 19.3, Tailwind CSS 4, shadcn/ui (estilo `base-nova`, primitivas Base UI), Lucide |
| Tipografía | Geist Sans / Geist Mono |
| Datos | Supabase cloud (PostgreSQL 15+, Auth, Storage) |
| Validación | Zod 4 + React Hook Form |
| Migraciones | SQL plano en `supabase/migrations`, aplicadas con `npm run db:migrate` (runner propio sobre `pg`, sin Docker ni Supabase CLI) |
| Tests | Vitest (unit) + tests de RLS contra la BD simulando JWT de usuarios |

## Qué se construye

1. **Arquitectura modular** (`src/modules/*`) con separación UI / servicios / repositorios / integraciones.
2. **Esquema base multitenant**: `tenants`, `branches`, `profiles`, `tenant_members`, `roles`, `permissions`, `role_permissions`, `user_roles`, `invitations`, `plans`, `features`, `plan_features`, `subscriptions`, `tenant_feature_overrides`, `audit_logs`.
3. **RLS en todas las tablas** con funciones `private.*` (`SECURITY DEFINER`, `search_path` vacío):
   - `private.is_member(tenant)` · `private.has_permission(tenant, permiso, sede?)` · `private.plan_limit(tenant, feature)`.
4. **RBAC granular**: 15 roles de sistema, ~50 permisos, asignación por sede (`user_roles.branch_id`; `NULL` = todas las sedes).
5. **Auditoría append-only**: trigger genérico que registra `old/new`, usuario, IP y user-agent (desde los headers de PostgREST). `UPDATE`/`DELETE` sobre `audit_logs` están bloqueados.
6. **Límites de plan en BD** (no en UI): trigger que impide crear más sedes/usuarios que los permitidos por el plan.
7. **Auth**: login, registro, recuperar contraseña, magic link, callback, cierre de sesión.
8. **Onboarding**: crear empresa → datos tributarios → primera sede → especialidad → dashboard. Implementado por la RPC `public.create_tenant()` (transacción única).
9. **Resolución de tenant segura**: el tenant activo vive en `profiles.active_tenant_id` (servidor). Nunca se acepta `tenant_id` del navegador; cada consulta pasa por RLS con la sesión del usuario.
10. **Dashboard shell**: sidebar filtrado por permisos, topbar, selector de sede, Command Bar (⌘K), botón universal “+ Nuevo”, design system con color de acento por tenant.
11. **Seeds**: `db:seed:demo` (Óptica Nova Vision SAS) — nunca en producción.

## Endpoints / Server Actions

| Acción | Módulo | Permiso |
|---|---|---|
| `signInAction`, `signUpAction`, `signOutAction`, `sendMagicLinkAction`, `requestPasswordResetAction`, `updatePasswordAction` | `auth` | público / sesión |
| `createTenantAction` → RPC `create_tenant` | `tenants` | sesión |
| `switchTenantAction` | `tenants` | membresía (validada por trigger) |
| `GET /auth/callback` | `auth` | intercambio de código PKCE |

## Componentes

`AppSidebar`, `Topbar`, `BranchSwitcher`, `CommandBar`, `UniversalAction`, `UserMenu`, `PageHeader`, `EmptyState`, `StatCard`, `OnboardingWizard`, formularios de auth.

## Criterio de terminado

- [x] Migraciones idempotentes versionadas
- [x] RLS + tests de aislamiento (tenant A ≠ tenant B, sede, rol)
- [x] Validación Zod en servidor
- [x] Errores humanos (mapeo de códigos Postgres)
- [x] Skeletons / empty states
- [x] ADRs 001–004
