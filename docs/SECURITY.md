# Seguridad

## Principios
Security first · least privilege · defensa en profundidad · la BD es la última barrera, no la única.

## Controles implementados
| Área | Control |
|---|---|
| Aislamiento | RLS en todas las tablas; FKs compuestas por tenant; tenant resuelto en servidor ([ADR-002](adr/ADR-002-postgres-rls.md)) |
| Autorización | RBAC granular (`permissions`, `role_permissions`, `user_roles` con alcance por sede); `can()` en actions + RLS |
| Escalamiento de privilegios | `is_platform_admin`, `status`, `slug` no actualizables por clientes (grants por columna); `user_roles` solo con `roles.manage`; un no-propietario no puede invitar propietarios |
| Autenticación | Supabase Auth, cookies httpOnly/secure (gestionadas por `@supabase/ssr`), `getClaims()` en proxy, `getUser()` en servidor |
| Redirecciones | `safeNext()` solo acepta rutas relativas |
| Validación | Zod en servidor para toda entrada; constraints `check` en BD |
| Rate limiting | `rateLimit()` en login, registro, magic link, reset, onboarding y reserva pública (in-memory; reemplazar por Upstash/Redis en producción — misma interfaz) |
| Anti-bots | Honeypot en `/book` + límite por IP |
| Enumeración | Magic link y reset responden igual exista o no la cuenta |
| Invitaciones | Token aleatorio de 192 bits; solo se guarda su SHA-256; un solo uso; ligado al email invitado; expira en 7 días |
| Auditoría | `audit_logs` append-only (trigger bloquea UPDATE/DELETE); registra usuario, IP, user-agent, request-id, old/new (con redacción de columnas sensibles) |
| CSRF | Server Actions de Next.js validan `Origin` vs host; no hay endpoints con cookies que acepten formularios cross-site |
| Secretos | Solo en env del servidor; `SUPABASE_SERVICE_ROLE_KEY` se usa únicamente en `lib/supabase/admin.ts` (`server-only`) |
| Logs | Estructurados, sin PHI (`logError` solo recibe códigos/metadata) |
| Super admin | `/admin` separado, verifica `is_platform_admin`, audita cada acceso y no consulta tablas clínicas |
| Público anónimo | `anon` sin privilegios sobre tablas; solo RPCs acotadas (`booking_*`, `invitation_preview`) que no devuelven datos de pacientes |

## Datos clínicos (Fase 3)
- Historia clínica firmada = inmutable; correcciones vía `amendments` versionadas con hash.
- Sin borrado físico desde la interfaz; política de retención configurable.
- Documentos en Storage privado `tenant/{tenantId}/patients/{patientId}/…` con URLs firmadas temporales.

## Pendiente antes de producción
- Rate limiter distribuido (Upstash) · CSP estricta · Sentry con scrubbing de PHI · rotación de secretos documentada · pentest externo · revisión legal (Ley 1581/2012, Res. 1995/1999, Res. 866/2021).

## Reportar vulnerabilidades
seguridad@<dominio> — respuesta en 72 h.
