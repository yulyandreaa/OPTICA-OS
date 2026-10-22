# ADR-003 — Supabase Auth

- **Estado:** aceptado · 2026-10-16

## Decisión
Supabase Auth (email+contraseña, magic link, recuperación) con `@supabase/ssr` y cookies httpOnly.
- `proxy.ts` refresca la sesión y hace redirecciones *optimistas* con `getClaims()` (verifica firma del JWT).
- La autorización real ocurre en servidor (`getUser()` + RLS); el proxy no es una barrera de seguridad.
- `profiles` 1:1 con `auth.users`, creado por trigger. Columnas sensibles (`is_platform_admin`) no son actualizables por el usuario (grants por columna).
- Redirecciones post-login validadas con `safeNext()` (sin open redirects).

## Consecuencias
Dependencia de Supabase para identidad; mitigada porque el modelo de datos usa `uuid` de usuario estándar y RLS sobre `auth.uid()`, portable a cualquier emisor JWT compatible.
