# Integraciones

Todas detrás de interfaces (`src/integrations`), seleccionadas por env, con **mock** hasta tener credenciales reales ([ADR-004](adr/ADR-004-provider-abstraction.md)).

| Integración | Interfaz | Env | Estado |
|---|---|---|---|
| Pagos (Wompi, Stripe) | `PaymentProvider` | `PAYMENT_PROVIDER=mock` | Interfaz + mock |
| WhatsApp Cloud API / email / SMS | `NotificationProvider` | `NOTIFICATION_PROVIDER=mock` | Interfaz + mock |
| Facturación electrónica DIAN | `ElectronicInvoiceProvider` | `EINVOICE_PROVIDER=mock` | Interfaz + mock (Fase 7) |
| RIPS / FEV Salud (Minsalud) | `RipsProvider` (+ `RipsValidator`, `RipsMapper` en Fase 8) | `RIPS_PROVIDER=mock`, `RIPS_MINSALUD_BASE_URL` | Interfaz + mock |
| SIIFA | `integrations/siifa` (client, types, mappers, validators, services) | `SIIFA_BASE_URL` | Fase 8 |
| IA | `AIProvider` | `AI_PROVIDER=none` | Desactivado |
| Google Calendar | — | — | Futuro |

## Reglas
1. URLs regulatorias solo desde configuración; nunca hardcodeadas ni inventadas.
2. `idempotencyKey` en pagos, facturación, RIPS, webhooks y órdenes externas.
3. Toda llamada externa crítica se registra en `integration_logs` (provider, operación, status, request_id, duración) con datos sensibles redactados. *(tabla en Fase 7)*
4. Webhooks entrantes se guardan en `webhook_events` y se deduplican por `(provider, event_id)`. *(Fase 5)*
5. Reintentos con backoff vía cola de jobs; un proveedor caído nunca bloquea la app ni destruye una venta.
6. La UI (Configuración → Integraciones) muestra estado (No conectado / Sandbox / Conectado / Error), nunca secretos.
