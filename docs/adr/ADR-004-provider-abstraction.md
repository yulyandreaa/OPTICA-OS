# ADR-004 — Abstracción de proveedores externos

- **Estado:** aceptado · 2026-10-16

## Decisión
Toda integración externa se define como interfaz en `src/integrations/<dominio>/index.ts` y se selecciona por variable de entorno:

| Interfaz | Env | Implementación inicial |
|---|---|---|
| `PaymentProvider` | `PAYMENT_PROVIDER` | `mock` (Wompi / Stripe después) |
| `NotificationProvider` | `NOTIFICATION_PROVIDER` | `mock` (WhatsApp Cloud API después) |
| `ElectronicInvoiceProvider` | `EINVOICE_PROVIDER` | `mock` |
| `RipsProvider` | `RIPS_PROVIDER` | `mock` (`minsalud` requiere `RIPS_MINSALUD_BASE_URL`) |
| `AIProvider` | `AI_PROVIDER` | `none` |

Reglas:
- **Nunca** se inventan endpoints ni credenciales regulatorias: URLs siempre desde configuración.
- Operaciones críticas llevan `idempotencyKey`.
- Las llamadas externas van por la cola de jobs (`src/lib/jobs/queue.ts`), nunca bloquean la UI; un fallo externo jamás destruye una venta.
- Logs de integración sin PHI.
