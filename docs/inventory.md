# Inventario

Migración: `supabase/migrations/20261022000016_inventory_module.sql`. Pruebas: `tests/rls/inventory.test.ts`.

## Modelo

| Concepto | Tabla | Nota |
|---|---|---|
| Producto | `products` | Catálogo único de la empresa, compartido por todas las sedes. `attributes` guarda los campos de su tipo. |
| Categoría | `product_categories` | Administrable. `kind` (frame, ophthalmic_lens, contact_lens, supply, service) define los campos del formulario. |
| Variante | `product_variants` | Combinación comercializable (color, calibre, poder…). SKU y código de barras únicos por empresa; SKU automático por tipo (`MON-000001`, `LC-…`). No se repite color + atributos dentro de un producto. |
| Costo | `variant_costs` | Separado del catálogo: solo lo lee quien tiene `inventory.costs`. |
| Existencia | `inventory_levels` | Cantidad y mínimo por variante y sede. Solo la cambian los movimientos. |
| Lote | `inventory_lots` | Cantidad por sede, variante y lote, con vencimiento. Solo para productos con `track_lots`. |
| Movimiento | `inventory_movements` | Inmutable. Tipos: initial, purchase, sale, return, adjustment, damage, loss, transfer_out, transfer_in. |
| Traslado | `inventory_transfers` + items | Enviar → en tránsito → recibir (o cancelar). |

Los lentes oftálmicos que se fabrican por orden no llevan inventario (`is_stocked = false`): la graduación va en la fórmula y la orden óptica, no en el catálogo.

## Reglas que hace cumplir la base de datos

- El stock solo cambia con un movimiento (el disparador `apply_inventory_movement` actualiza existencias y lotes).
- Ningún movimiento deja una sede o un lote por debajo de cero (`STOCK_INSUFFICIENT`, `LOT_INSUFFICIENT`). La fila de existencia queda bloqueada durante la operación, así que dos ventas simultáneas no venden la misma unidad.
- `idempotency_key` en movimientos manuales, recepciones de compra (`p_key`), productos nuevos y traslados: un reintento devuelve el resultado anterior.
- Las entradas de productos con lote exigen el lote (`LOT_REQUIRED`). Las salidas sin lote indicado descuentan primero el que vence antes; las ventas no toman lotes vencidos (`LOT_EXPIRED`).
- Editar un producto nunca cambia el stock. La existencia inicial solo se registra al crear el producto, como movimiento `initial`.
- Un traslado enviado no se puede modificar; su estado solo cambia con `receive_transfer` o `cancel_transfer`. Cancelar uno en tránsito devuelve las unidades al origen.
- Productos con historial no se borran: se desactivan.

## Costo y valoración

Costo promedio ponderado por variante, para toda la empresa (sedes + unidades en tránsito):

    nuevo costo = (unidades actuales × costo actual + unidades que entran × costo de entrada) ÷ (unidades actuales + unidades que entran)

Lo recalculan las compras recibidas y las cargas iniciales con costo. Cada salida registra el costo promedio del momento; la venta lo guarda en `sale_items.unit_cost` para calcular márgenes.

**Valor del inventario** = Σ unidades × costo promedio de las referencias con stock. Las referencias con unidades y sin costo no se suman, y la pantalla dice cuántas son.

## Indicadores de la pantalla principal (`inventory_summary`)

| Indicador | Definición |
|---|---|
| Referencias activas | Variantes activas de productos activos (incluye servicios). Se muestran aparte las que controlan existencias. |
| Unidades en stock | Suma de unidades físicas (> 0) en las sedes del filtro. No incluye las que están en tránsito, que se muestran aparte. |
| Stock bajo | Referencias activas con unidades por encima de 0 y en o por debajo del mínimo. Las agotadas (≤ 0) se cuentan aparte. |
| Valor del inventario | Ver arriba. Requiere `inventory.costs`. |

Con "Todas las sedes", el mínimo de una referencia es la suma de los mínimos de cada sede. El tablero del administrador usa la misma definición (`inventory_stock`).

## Permisos

| Permiso | Permite |
|---|---|
| `inventory.read` | Ver catálogo, existencias e historial (sin costos) |
| `inventory.manage` | Crear y editar productos y categorías |
| `inventory.adjust` | Conteos, ajustes, cargas iniciales, daños, pérdidas y mínimos por sede |
| `inventory.transfer` | Enviar, recibir y cancelar traslados |
| `inventory.costs` | Ver y modificar costos, valor del inventario y márgenes (nuevo) |

El Administrador tiene todos. El Asesor comercial solo tiene `inventory.read`.

## Dependencias pendientes

- **Devoluciones y anulaciones de ventas**: el tipo de movimiento `return` ya existe, pero Ventas todavía no tiene la acción de anular o devolver. Cuando se construya, debe registrar movimientos `return` con la referencia de la venta, y no editar existencias.
- **Margen por línea de venta**: `sale_items.unit_cost` sigue visible para quien tiene `sales.read`. Protegerlo es parte del módulo de Ventas y Reportes.
- **Fotos de productos**: no hay almacenamiento de archivos configurado. Por ahora se guarda un enlace a la imagen.
- **Migración a Supabase en la nube**: las migraciones 13 a 16 solo están aplicadas en la base local.
