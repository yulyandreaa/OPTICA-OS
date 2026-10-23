# Ventas y cotizaciones — indicadores

Fuente: `public.sales_overview` y `public.sales_operations` (migración `20261023000021_sales_overview.sql`).
Los días se cuentan en la zona horaria de la empresa. El período es el elegido arriba (por defecto, el mes actual).

## Estados

| | Valores | Qué significa |
|---|---|---|
| Estado comercial de la venta (`sales.status`) | Registrada · Devolución parcial · Devuelta · Anulada | Qué pasó con la operación |
| Estado de pago (`sales.payment_status`) | Pendiente · Pago parcial · Pagada · Reembolso parcial · Reembolsada | Cuánto se ha recaudado |
| Estado de la cotización (`quotes.status`) | Borrador · Enviada · Aceptada · Rechazada · Vencida · Convertida en venta | Ciclo comercial de la propuesta |

Los tres son independientes, y tampoco se mezclan con el estado de la orden óptica.
Una cotización enviada, aceptada o en borrador cuya fecha de vencimiento ya pasó se muestra como **Vencida**,
aunque nadie la haya cerrado.

## Fórmulas

- **Venta válida**: estado comercial *Registrada* o *Devolución parcial*. Las anuladas y las devueltas por completo no cuentan.
- **Ventas netas** = Σ (total − IVA) de las ventas válidas registradas en el período.
  Es el valor después de los descuentos de cada línea y sin IVA (los precios incluyen IVA). Es la misma definición del dashboard.
  Cuando existan las devoluciones parciales (etapa 5), su valor se restará aquí.
- **Ventas registradas** = número de ventas válidas del período. Cada venta cuenta una vez: los reintentos no crean ventas duplicadas.
- **Cotizaciones abiertas** = cotizaciones *Enviadas* o *Aceptadas* que siguen vigentes **hoy**. No dependen del período,
  porque responden a "¿qué tengo por cerrar ahora?". Los borradores no cuentan.
- **Conversión de cotizaciones** = convertidas ÷ emitidas, sobre las cotizaciones **emitidas en el período** (cohorte por fecha de emisión;
  emisión = fecha de envío). Se cuentan todas menos los borradores, y se mide cuántas de ellas están convertidas hoy.
  Las cotizaciones emitidas al final del período todavía pueden convertirse, así que la tasa de un período reciente puede subir.
  Por eso no se compara con un período anterior.

## Dinero cobrado y saldos

Las ventas no son recaudo: el dinero cobrado sale de la tabla `payments`, donde cada pago o abono es un registro
que no se puede editar ni borrar. El saldo de una venta es total − pagado. No se puede editar a mano: solo cambia al registrar un pago.
