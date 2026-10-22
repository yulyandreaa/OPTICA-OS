import { z } from "zod";

export const DOCUMENT_TYPES = {
  CC: "Cédula de ciudadanía", TI: "Tarjeta de identidad", CE: "Cédula de extranjería", PA: "Pasaporte",
  RC: "Registro civil", PEP: "Permiso especial de permanencia", PPT: "Permiso por protección temporal",
  NIT: "NIT", MS: "Menor sin identificación", AS: "Adulto sin identificación", CD: "Carné diplomático", SC: "Salvoconducto",
} as const;
export const HEALTH_REGIMES = {
  contributivo: "Contributivo", subsidiado: "Subsidiado", especial: "Especial", particular: "Particular", no_asegurado: "No asegurado",
} as const;
export const PATIENT_SOURCES = {
  walk_in: "Llegó a la óptica", instagram: "Instagram", facebook: "Facebook", google: "Google", whatsapp: "WhatsApp",
  referral: "Referido", web: "Página web", other: "Otro",
} as const;
export const CONTACT_PREFERENCES = { whatsapp: "WhatsApp", email: "Correo", phone: "Llamada", sms: "SMS", none: "No contactar" } as const;

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const phone = z.string().trim().regex(/^\+?[0-9\s-]{7,20}$/, "Teléfono no válido").optional().or(z.literal("")).transform((v) => (v ? v.replace(/[\s-]/g, "") : null));

export const patientSchema = z.object({
  documentType: z.enum(keys(DOCUMENT_TYPES)),
  documentNumber: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, "Documento no válido"),
  firstName: z.string().trim().min(1, "Requerido").max(80),
  middleName: optionalText(80),
  lastName: z.string().trim().min(1, "Requerido").max(80),
  secondLastName: optionalText(80),
  birthDate: z.string().min(1, { message: "Requerido", abort: true }).regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida")
    .refine((v) => new Date(v) <= new Date(), "La fecha no puede ser futura"),
  sex: z.enum(["M", "F", "I"]).optional().or(z.literal("")).transform((v) => v || null),
  email: z.email("Correo no válido").optional().or(z.literal("")).transform((v) => v || null),
  phone,
  whatsapp: phone,
  address: optionalText(200),
  city: optionalText(80),
  department: optionalText(80),
  occupation: optionalText(120),
  eps: optionalText(120),
  healthRegime: z.enum(keys(HEALTH_REGIMES)).optional().or(z.literal("")).transform((v) => v || null),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: phone,
  contactPreference: z.enum(keys(CONTACT_PREFERENCES)),
  source: z.enum(keys(PATIENT_SOURCES)).optional().or(z.literal("")).transform((v) => v || null),
  homeBranchId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
  notes: optionalText(2000),
  acceptDataPolicy: z.boolean().optional(),
  acceptMarketing: z.boolean().optional(),
});

export type PatientFormInput = z.input<typeof patientSchema>;
export type PatientInput = z.output<typeof patientSchema>;

export const patientListParams = z.object({
  q: z.string().trim().max(80).optional(),
  branch: z.uuid().optional(),
  cursor: z.string().optional(),
  segment: z.enum(["all", "new", "no_visit_12m", "upcoming"]).default("all"),
});
export type PatientListParams = z.infer<typeof patientListParams>;
