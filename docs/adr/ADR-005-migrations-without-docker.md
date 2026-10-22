# ADR-005 — Migraciones y pruebas de BD sin Docker

- **Estado:** aceptado · 2026-10-16

## Contexto
El entorno de desarrollo no tiene Docker; el CLI de Supabase lo requiere para `db start` y `gen types`.

## Decisión
- Migraciones SQL planas en `supabase/migrations/` (compatibles con el CLI de Supabase si se adopta luego), aplicadas por `scripts/db/migrate.ts` con registro y checksum en `private.schema_migrations`. Una migración aplicada nunca se edita: se crea una nueva.
- Pruebas de RLS y generación de tipos corren contra **PGlite** (Postgres real compilado a WASM) en proceso, con un *stub* mínimo de Supabase (`roles anon/authenticated/service_role`, `auth.users`, `auth.uid()`), en `scripts/db/supabase-stub.ts`. Esto permite que CI valide migraciones y aislamiento sin servicios externos.
- Con `DATABASE_URL` definido, los mismos tests corren contra un proyecto Supabase real (usar uno desechable).

## Consecuencias
PGlite no reemplaza a Supabase (no hay Auth API ni Storage), solo valida SQL/RLS. Los tipos (`src/lib/supabase/database.types.ts`) se generan con `npm run db:types` (BD real) o `db:types:local` (PGlite).
