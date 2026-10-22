# ADR-006 — Cache Components y datos por sesión

- **Estado:** aceptado · 2026-10-16

## Contexto
Next.js 16.4 con `cacheComponents: true`: leer `cookies()` fuera de `<Suspense>` es error de build.

## Decisión
- `(dashboard)/layout.tsx` renderiza un **shell estático** (skeleton) y monta el layout autenticado detrás de `<Suspense>`. Resultado: rutas del dashboard en *Partial Prerender* (navegación instantánea + streaming).
- Rutas sueltas que leen la sesión (`/`, `/onboarding`, `/invite/[token]`, `/book/[slug]`, `/admin`, `/auth/update-password`) usan `export const instant = false` (patrón oficial de migración) y se migrarán una a una.
- Datos derivados de la sesión **no** se cachean en servidor entre usuarios. Candidatos futuros a `use cache`: catálogo público de `/book/[slug]` (clave: slug) usando un cliente anónimo sin cookies.
