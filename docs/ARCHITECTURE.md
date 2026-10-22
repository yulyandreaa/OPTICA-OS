# Arquitectura

Modular monolith en Next.js 16 (App Router) + Supabase. Ver [ADR-001](adr/ADR-001-modular-monolith.md).

```
src/
├─ app/                     Rutas (solo composición: leen contexto, llaman repos/actions, renderizan)
│  ├─ (auth)/               login, registro, recuperar contraseña
│  ├─ (dashboard)/          app autenticada (shell + módulos)
│  ├─ book/[slug]           reserva pública (anon, RPCs acotadas)
│  ├─ invite/[token]        aceptar invitación
│  ├─ onboarding/           alta de empresa
│  └─ admin/                super admin SaaS (separado)
├─ modules/<dominio>/
│  ├─ actions/              Server Actions: validan (Zod), autorizan (can), llaman Supabase con sesión
│  ├─ repositories/         Acceso a datos (server-only), consultas tipadas y paginadas
│  ├─ services/             Lógica de negocio / composición
│  ├─ schemas/              Zod (fuente única de validación cliente+servidor)
│  ├─ components/           UI del dominio
│  └─ utils/                Funciones puras (testeadas)
├─ integrations/            PaymentProvider, NotificationProvider, ElectronicInvoiceProvider, RipsProvider, AIProvider
├─ lib/
│  ├─ supabase/             server (RLS) · client · admin (service role) · proxy · database.types
│  ├─ events/bus.ts         Eventos de dominio
│  ├─ jobs/queue.ts         Cola de jobs (in-process → Inngest/Trigger.dev)
│  ├─ errors.ts             Errores humanos (“Ya existe un paciente con este documento”)
│  └─ format.ts             Dinero COP, fechas en zona del tenant
└─ components/              Design system (ui/ = shadcn base-nova sobre Base UI; shared/; app-shell/)
```

## Flujo de una petición

```
Browser ──► proxy.ts (refresca sesión, redirect optimista, x-request-id)
        ──► Server Component (requirePermission → AppContext resuelto en servidor)
        ──► repository (Supabase con JWT del usuario) ──► PostgREST ──► Postgres (RLS)
Mutación: Client Component ──► Server Action (Zod → can() → insert con tenant_id del contexto) ──► RLS ──► triggers (auditoría, timeline)
```

## Contexto de aplicación (`modules/tenants/services/context.ts`)
`getAppContext()` (memoizado por request con `React.cache`) devuelve usuario, tenant activo, sedes visibles, roles, **grants** (`permiso → "all" | Set<sede>`) y suscripción. La UI se filtra con `can(grants, permiso, sede)`; la BD vuelve a verificarlo.

## Eventos y jobs
`publish("AppointmentBooked", …)` → suscriptores (notificaciones, analítica) que encolan jobs con `idempotencyKey`. La cola actual es in-process con reintentos exponenciales; la interfaz `JobQueue` permite cambiar a Inngest/Trigger.dev/BullMQ sin tocar llamadores.

## UI / design system
- Neutros fríos + un acento `--brand` sobreescribible por tenant (white-label). Geist. Espaciado en pasos de 8 px. Sombras `shadow-soft`/`shadow-lift`.
- Componentes: `Panel`, `PageHeader`, `StatCard`, `StatusBadge`, `EmptyState`, `FormField`, `NativeSelect`, skeletons.
- Shell: sidebar filtrado por permisos, topbar con búsqueda ⌘K, selector de sede/empresa, botón universal “+ Nuevo” (atajos ⇧P paciente, ⇧C cita).
- Progressive disclosure: el formulario de paciente pide 3 datos y oculta el resto tras “Más datos”.
