/**
 * Maps technical errors (Postgres / PostgREST / Auth) to human messages in es-CO.
 * The raw error is logged server-side; the user only sees the friendly text.
 */
type PgLikeError = { code?: string; message?: string; details?: string | null; hint?: string | null };

const BY_MESSAGE: Record<string, string> = {
  PLAN_LIMIT_BRANCHES: "Tu plan actual no permite más sedes. Actualiza tu plan para agregar otra.",
  PLAN_LIMIT_USERS: "Tu plan actual no permite más usuarios activos.",
  TENANT_LIMIT_REACHED: "Alcanzaste el máximo de empresas que puedes crear con esta cuenta.",
  NOT_A_MEMBER: "No perteneces a esa empresa.",
  INVALID_BRANCH: "Esa sede no pertenece a tu empresa.",
  FORBIDDEN: "No tienes permiso para realizar esta acción.",
  SLOT_UNAVAILABLE: "Ese horario acaba de ocuparse. Elige otro, por favor.",
  CONSENT_REQUIRED: "Debes aceptar la política de tratamiento de datos para continuar.",
  INVALID_SERVICE: "El servicio seleccionado no está disponible.",
  RECORD_SIGNED: "La historia ya está firmada. Para corregirla registra una enmienda.",
  RECORD_INCOMPLETE: "Completa el motivo de consulta antes de firmar.",
  AMEND_REASON_REQUIRED: "Explica el motivo de la enmienda.",
  STOCK_INSUFFICIENT: "No hay suficiente stock de este producto en la sede.",
  STOCK_DIRECT_EDIT_FORBIDDEN: "El stock solo cambia con movimientos de inventario.",
  DISCOUNT_FORBIDDEN: "No tienes permiso para aplicar descuentos.",
  DISCOUNT_TOO_HIGH: "El descuento supera el valor del producto.",
  PAYMENT_EXCEEDS_TOTAL: "El pago supera el saldo pendiente de la venta.",
  SALE_EMPTY: "Agrega al menos un producto.",
  SALE_IS_DRAFT: "La venta todavía es un borrador: confírmala antes de registrar pagos.",
  SALE_NOT_DRAFT: "Esta venta ya fue confirmada y no se puede editar como borrador.",
  SALES_RPC_ONLY: "Las ventas y cotizaciones solo se modifican desde sus acciones.",
  CUSTOMER_REQUIRED_FOR_BALANCE: "Para dejar saldo pendiente, selecciona el cliente: la deuda queda a su nombre.",
  PRODUCT_REQUIRED: "Cada línea debe ser un producto o servicio del inventario.",
  PRODUCT_INACTIVE: "Hay un producto inactivo en la venta. Quítalo o actívalo en Inventario.",
  PATIENT_NOT_FOUND: "El cliente seleccionado ya no existe.",
  INVALID_SELLER: "El asesor elegido no puede vender en esta sede.",
  INVALID_PAYMENT_METHOD: "Medio de pago no válido.",
  INVALID_DISCOUNT: "El descuento no es válido.",
  INVALID_DUE_DATE: "La fecha límite de pago no puede ser anterior a hoy.",
  INVALID_VALID_UNTIL: "La fecha de vencimiento no puede ser anterior a hoy.",
  LAB_ORDER_NOT_FOUND: "La orden óptica ya no existe.",
  LAB_ORDER_NOT_LINKABLE: "Esa orden óptica ya tiene una venta, está cerrada o es de otro cliente.",
  QUOTE_LOCKED: "Esta cotización ya no se puede editar.",
  QUOTE_NOT_SENT: "La cotización está en borrador: emítela antes de convertirla en venta.",
  QUOTE_NOT_CONVERTIBLE: "Esta cotización ya no se puede convertir en venta.",
  SALE_CLOSED: "Esta venta está cerrada.",
  QUOTE_EXPIRED: "La cotización venció. Crea una nueva.",
  QC_INCOMPLETE: "Completa todo el control de calidad antes de marcar la orden como lista.",
  BALANCE_PENDING: "El paciente tiene saldo pendiente. Registra el pago antes de entregar.",
  INVALID_TRANSITION: "Ese cambio de estado no es válido.",
  PO_NOT_RECEIVABLE: "Esta orden de compra no se puede recibir en su estado actual.",
  PO_OVER_RECEIVED: "Estás recibiendo más unidades de las pedidas.",
  LOT_REQUIRED: "Este producto maneja lotes: indica el lote.",
  LOT_INSUFFICIENT: "Ese lote no tiene suficientes unidades.",
  LOT_EXPIRED: "Las unidades disponibles de este producto están vencidas.",
  PRODUCT_NOT_STOCKED: "Este producto no maneja inventario (por ejemplo, un servicio o un lente que se fabrica por orden).",
  PRODUCT_HAS_STOCK: "El producto todavía tiene unidades en alguna sede. Sácalas con un movimiento antes de quitarle el inventario.",
  COSTS_FORBIDDEN: "No tienes permiso para ver ni modificar costos.",
  BRANCH_NOT_FOUND: "La sede ya no existe.",
  BRANCH_LAST: "Tu óptica necesita al menos una sede: no puedes eliminar la única que tienes.",
  PRODUCT_HAS_HISTORY: "Este producto ya tiene movimientos, compras o ventas registradas: no se puede eliminar. Desactívalo para que deje de aparecer.",
  PRODUCT_NOT_FOUND: "El producto ya no existe.",
  VARIANT_REQUIRED: "Agrega al menos una variante.",
  CATEGORY_NOT_FOUND: "La categoría elegida no existe en tu óptica.",
  REASON_REQUIRED: "Explica el motivo del movimiento.",
  INVALID_QUANTITY: "La cantidad no es válida.",
  INVALID_MOVEMENT: "Ese tipo de movimiento no se puede registrar a mano.",
  TRANSFER_EMPTY: "Agrega al menos un producto al traslado.",
  TRANSFER_SAME_BRANCH: "La sede de destino debe ser distinta a la de origen.",
  TRANSFER_LOCKED: "El traslado ya se envió y no se puede modificar.",
  TRANSFER_RPC_ONLY: "El estado del traslado solo cambia al enviarlo, recibirlo o cancelarlo.",
  "Invalid login credentials": "Correo o contraseña incorrectos.",
  "Email not confirmed": "Debes confirmar tu correo antes de ingresar. Revisa tu bandeja de entrada.",
  "User already registered": "Ya existe una cuenta con este correo.",
};

const BY_CONSTRAINT: Record<string, string> = {
  patients_document_uq: "Ya existe un paciente registrado con este documento.",
  tenants_slug_key: "Ese identificador de empresa ya está en uso. Prueba con otro.",
  tenants_tax_id_uq: "Ya existe una empresa registrada con este NIT.",
  branches_tenant_id_code_key: "Ya existe una sede con ese código.",
  appointments_no_overlap: "El especialista ya tiene una cita en ese horario.",
  product_variants_attrs_uq: "Ya existe una variante con el mismo color y atributos en este producto.",
  product_variants_tenant_id_sku_key: "Ese SKU ya está en uso en otro producto.",
  product_variants_barcode_uq: "Ese código de barras ya está registrado en otro producto.",
  product_categories_name_uq: "Ya existe una categoría con ese nombre.",
  product_categories_tenant_id_code_key: "Ya existe una categoría con ese nombre.",
};

export function humanizeError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const msg = e.message ?? "";

  // Stock errors carry the product name in the hint ("No hay suficiente stock de Aurora · Negro en esta sede.").
  if (e.hint && /^(STOCK_INSUFFICIENT|LOT_REQUIRED|LOT_INSUFFICIENT|LOT_EXPIRED)$/.test(msg)) return e.hint;
  for (const [key, text] of Object.entries(BY_MESSAGE)) if (msg.includes(key)) return text;
  for (const [key, text] of Object.entries(BY_CONSTRAINT)) if (msg.includes(key) || e.details?.includes(key)) return text;

  switch (e.code) {
    case "23505": return "Este registro ya existe.";
    case "23503": return "El registro está relacionado con información que no existe o no puedes usar.";
    case "23514": return "Algunos datos no tienen un formato válido.";
    case "42501": return "No tienes permiso para realizar esta acción.";
    case "PGRST116": return "No encontramos lo que buscas.";
  }
  if (msg.toLowerCase().includes("row-level security")) return "No tienes permiso para realizar esta acción.";
  return "Algo salió mal. Inténtalo de nuevo en unos segundos.";
}

export function logError(scope: string, error: unknown, extra?: Record<string, unknown>) {
  // Structured, PHI-free log line. `extra` must never contain clinical data.
  const e = (error ?? {}) as PgLikeError;
  console.error(JSON.stringify({ level: "error", scope, code: e.code, message: e.message, ...extra }));
}
