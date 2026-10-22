# Despliegue

## Entornos
| Entorno | App | Base de datos | Seeds |
|---|---|---|---|
| development | `next dev` local | Proyecto Supabase *dev* | `db:seed:demo` permitido |
| staging | Vercel Preview | Proyecto Supabase *staging* | demo permitido |
| production | Vercel Production | Proyecto Supabase *prod* | **prohibido** (`APP_ENV=production` bloquea el seed) |

Variables por entorno en Vercel (`vercel env`). Nunca compartir `DATABASE_URL` ni service role entre entornos.

## CI/CD
`.github/workflows/ci.yml`: install → lint → typecheck → tests (incluye RLS en PGlite) → build. Deploy automático de Vercel por rama; producción desde `main`.

Migraciones: `npm run db:migrate` con el `DATABASE_URL` del entorno, ejecutado como paso manual aprobado (o job de CI con secreto) **antes** de promover el deploy.

## Backups y recuperación
- **DB**: Supabase PITR (plan Pro+) — objetivo **RPO ≤ 5 min**; backups diarios automáticos como respaldo.
- **Storage**: replicación/backup periódico del bucket de documentos clínicos (Fase 3).
- **RTO objetivo**: 4 h.

### Procedimiento de recuperación
1. Declarar incidente; poner tenants en `read_only` si hay riesgo de corrupción.
2. Restaurar PITR a un proyecto nuevo al instante previo al incidente.
3. Validar con `npm run db:status` y `npm test` (DATABASE_URL del restaurado).
4. Apuntar `NEXT_PUBLIC_SUPABASE_URL`/llaves de Vercel al proyecto restaurado y redeploy.
5. Post-mortem; los `audit_logs` permiten reconstruir cambios.

## Observabilidad (preparado)
Logs JSON estructurados (`scope`, `code`, `tenantId`, `x-request-id`) sin PHI. Integración Sentry pendiente con scrubbing de datos clínicos.
