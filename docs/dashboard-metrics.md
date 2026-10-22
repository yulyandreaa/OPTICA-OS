# Dashboard del administrador — reglas de cálculo

Fuente única: `public.dashboard_summary` (migración `20261022000014_dashboard_summary.sql`).
Lógica de períodos y estados: `src/modules/dashboard/period.ts` y `src/modules/dashboard/services/summary.ts`.

## Acceso
- Requiere el permiso `reports.financial` (rol Administrador). La función lo valida en la base de datos;
  el asesor comercial recibe `FORBIDDEN` aunque llame la función directamente.
- La función es `security invoker`: RLS limita las filas a la empresa y sedes del usuario.
- No usa datos clínicos (historias, diagnósticos, fórmulas). La sección de citas muestra solo agenda.

## Venta válida
`sales.status in ('partial','paid')`. Las ventas `cancelled` (anuladas) y `returned` (devueltas) se excluyen
completas: en el modelo actual la devolución/anulación es un estado de toda la venta, no parcial.
La fecha es `created_at` en la zona horaria de la empresa.

> Limitación: no existe fecha de devolución/anulación; si una venta de septiembre se anula en octubre,
> desaparece de septiembre. Se resolverá con el módulo de anulaciones y devoluciones.

## Indicadores
| Indicador | Fórmula |
|---|---|
| Ventas netas | Σ (`total` − `tax_total`) de ventas válidas del período. Después de descuentos, sin IVA (los precios incluyen IVA). |
| Margen bruto | Σ (`line_total` − `tax_amount` − `unit_cost` × `quantity`) solo sobre líneas con costo (`unit_cost > 0`), dividido por las ventas netas de esas líneas. |
| Recaudo | Σ `payments.amount` registrados en el período sobre ventas válidas. Los pagos son inmutables, no se duplican. Incluye todos los medios (también "Crédito"). |
| Cartera pendiente | Σ `balance` de ventas válidas con saldo > 0, a hoy (no depende del período). |
| Cartera vencida | Cartera de ventas con más de 30 días (aún no existe fecha de vencimiento). |

### Margen: estados
- **No disponible**: ninguna línea vendida tiene costo registrado.
- **Parcial**: algunas líneas no tienen costo (p. ej. ítems de texto libre). Se muestra el margen de lo costeado
  y qué porcentaje de las ventas cubre; nunca se extrapola.
- **Completo**: todas las líneas tienen costo; solo entonces se compara en puntos porcentuales.

## Períodos y comparación
| Período | Rango | Comparado con |
|---|---|---|
| Hoy | hoy | ayer |
| Últimos 7 días | hoy − 6 … hoy | los 7 días anteriores |
| Mes actual (defecto) | día 1 … hoy | mismos días del mes anterior (31 mar → 28/29 feb) |
| Mes anterior | mes completo | el mes previo completo |
| Rango personalizado (≤ 366 días) | desde … hasta | ventana igual justo antes |

La comparación (%) se muestra solo si:
1. el historial de ventas empieza antes del inicio del período anterior, y
2. el período anterior tiene al menos 3 ventas (`MIN_COMPARABLE_SALES`).

Si no, la tarjeta no muestra variación y el dashboard lo explica.

Granularidad por defecto del gráfico: día (≤ 31 días), semana (≤ 120 días), mes (más).

## Bloques de detalle (período seleccionado, solo ventas válidas)
| Bloque | Regla |
|---|---|
| Ventas por categoría | Σ neto de líneas por `sale_items.category`. Colores fijos por categoría (Monturas, Lentes oftálmicos, Lentes de contacto, Accesorios, Gafas de sol); el resto se agrupa en "Otros". |
| Rendimiento por sede | Ventas netas por sede; la variación % usa la misma regla de comparación y exige ≥ 3 ventas de esa sede en el período anterior. Tocar una sede filtra toda la app. |
| Top 5 productos | Neto por variante (o por descripción en ítems de texto libre). |
| Asesores con más ventas | Neto y número de ventas por `sales.seller_id`. |

Agrupación del gráfico (`?agrupar=`): días hasta 92 días, semanas desde 8 días, meses desde 32 días.

## Alertas
| Alerta | Regla | Enlace |
|---|---|---|
| Productos agotados | variantes activas con stock ≤ 0 en la(s) sede(s) | `/inventario?tab=stock&filtro=agotado` |
| Stock bajo | stock > 0 y ≤ mínimo (`inventory_levels.min_quantity`) | `/inventario?tab=stock&filtro=bajo` |
| Órdenes ópticas retrasadas | `estimated_at` < hoy y estado anterior a "recibida en óptica"; detalle de las 3 con más días de retraso | `/ordenes?atrasadas=1` |
| Cartera vencida | ver arriba; detalle de los 3 saldos más altos por cliente | `/ventas?estado=partial&vencidas=1` |
| Cierres de caja pendientes | **pendiente**: el módulo de caja no existe todavía | — |

## Datos de demostración
`tenants.is_demo = true` (lo marca `scripts/db/seed-demo.ts`). El dashboard muestra la etiqueta
"Datos de demostración" para no confundirlos con datos productivos.
