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
  SALE_CLOSED: "Esta venta está cerrada.",
  QUOTE_EXPIRED: "La cotización venció. Crea una nueva.",
  QC_INCOMPLETE: "Completa todo el control de calidad antes de marcar la orden como lista.",
  BALANCE_PENDING: "El paciente tiene saldo pendiente. Registra el pago antes de entregar.",
  INVALID_TRANSITION: "Ese cambio de estado no es válido.",
  PO_NOT_RECEIVABLE: "Esta orden de compra no se puede recibir en su estado actual.",
  PO_OVER_RECEIVED: "Estás recibiendo más unidades de las pedidas.",
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
};

export function humanizeError(error: unknown): string {
  const e = (error ?? {}) as PgLikeError;
  const msg = e.message ?? "";

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
