# Óptica OS

> El sistema operativo de una óptica moderna — SaaS multitenant para ópticas y salud visual en Colombia.

CRM de pacientes 360° · agenda visual · historia clínica y fórmula · inventario · POS · laboratorio · facturación electrónica · RIPS · automatizaciones · analítica.

## Estado

| Fase | Alcance | Estado |
|---|---|---|
| 01 Foundation | Auth, multitenancy, sedes, RBAC granular, RLS, auditoría, planes/límites, design system, shell | ✅ |
| 02 Pacientes + Agenda | CRM 360°, consentimientos, timeline, agenda día/semana/mes con drag & drop, sala de espera, reserva pública `/book/[slug]` | ✅ |
| 03 Consultas | Historia clínica, refracción OD/OI, firma con hash, enmiendas, fórmula imprimible | ✅ |
| 04 Inventario + Compras | Catálogo y variantes, stock por sede con movimientos inmutables, traslados, proveedores, órdenes de compra y recepción, vitrina | ✅ |
| 05 Ventas + Cotizaciones | POS con código de barras y pagos mixtos, anticipos, cotización → venta, enlace público `/quote/[token]` | ✅ |
| 06 Laboratorio | Órdenes con línea de tiempo, control de calidad obligatorio, entrega con saldo en cero, tracking `/track/[token]` | ✅ |
| 07 Facturación | Factura electrónica independiente de la venta vía `ElectronicInvoiceProvider` (sandbox), reintentos | ✅ (sandbox) |
| 08 RIPS | Mapper + validador FEV-RIPS (Res. 2275/2023, códigos configurables), envío vía `RipsProvider` (sandbox) | ✅ (sandbox) |
| 09 CRM | Pipeline Kanban, leads por origen, tareas | ✅ (automatizaciones/WhatsApp pendientes) |
| 10 Reportes | Ventas, margen, conversión, por categoría/asesor/medio de pago/sede, exportación CSV | ✅ (IA pendiente) |

## Modo local (sin base de datos externa)

```bash
npm install
npm run dev:local          # http://localhost:3012 — Supabase emulado sobre PGlite (.local-db/), con RLS real
npm run dev:local:reset    # borra los datos locales y vuelve a sembrar el demo
```

Cada arranque aplica migraciones pendientes y regenera la agenda del día. Es solo para desarrollo/demos
(`scripts/dev/local-supabase.ts` emula Auth + el subconjunto de PostgREST que usa la app).

## Puesta en marcha con Supabase

```bash
cp .env.example .env.local        # completa las llaves de Supabase y DATABASE_URL (session pooler)
npm install
npm run db:setup                  # migraciones + tipos + seed demo
npm run dev
```

Entra a http://localhost:3000 con **owner@novavision.demo** · `NovaVision2026!`

Otros usuarios demo (misma contraseña): `optometra@`, `optometra2@`, `asesor@`, `recepcion@novavision.demo` (recepción solo ve la sede Chapinero).
La reserva pública demo está en `/book/novavision`.

> En Supabase → Authentication → URL Configuration agrega `http://localhost:3000/auth/callback` como Redirect URL.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run db:migrate` / `db:status` | Aplica / lista migraciones (`supabase/migrations`) |
| `npm run db:types` | Genera `database.types.ts` desde la BD real (`db:types:local` usa PGlite) |
| `npm run db:seed:demo` | Crea Óptica Nova Vision SAS (idempotente; regenera la agenda del día) |
| `npm test` | Unit tests + **tests de aislamiento multitenant** (PGlite en proceso) |
| `npm run lint` · `npm run typecheck` · `npm run build` | Calidad / build |

## Documentación

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — módulos, capas, eventos, jobs
- [MULTITENANCY.md](docs/MULTITENANCY.md) — resolución de tenant, RLS, sedes
- [SECURITY.md](docs/SECURITY.md) — modelo de amenazas y controles
- [DATABASE.md](docs/DATABASE.md) — ERD y tablas
- [INTEGRATIONS.md](docs/INTEGRATIONS.md) — proveedores (DIAN, RIPS, WhatsApp, Wompi)
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — entornos, CI/CD, backups y DR
- [docs/adr](docs/adr) — decisiones de arquitectura
- [PHASE_01_FOUNDATION.md](PHASE_01_FOUNDATION.md)
