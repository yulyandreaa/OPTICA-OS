import { z } from "zod";

export const bookingCatalogSchema = z.object({
  tenant: z.object({ name: z.string(), slug: z.string(), brand_color: z.string().nullable(), timezone: z.string() }),
  branches: z.array(z.object({ id: z.uuid(), name: z.string(), address: z.string().nullable(), city: z.string().nullable() })),
  services: z.array(z.object({ id: z.uuid(), name: z.string(), duration: z.number(), price: z.number().nullable() })),
  specialists: z.array(z.object({ id: z.uuid(), name: z.string(), branch_id: z.uuid() })),
});
export type BookingCatalog = z.infer<typeof bookingCatalogSchema>;

export const bookingRequestSchema = z.object({
  slug: z.string().min(3).max(48),
  branchId: z.uuid(),
  serviceId: z.uuid(),
  specialistId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  documentType: z.enum(["CC", "TI", "CE", "PA", "PPT", "PEP"]),
  documentNumber: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, "Documento no válido"),
  firstName: z.string().trim().min(1, "Requerido").max(80),
  lastName: z.string().trim().min(1, "Requerido").max(80),
  phone: z.string().trim().regex(/^\+?[0-9\s-]{7,20}$/, "Celular no válido").transform((v) => v.replace(/[\s-]/g, "")),
  email: z.email("Correo no válido").optional().or(z.literal("")),
  acceptPolicy: z.literal(true, { error: "Debes aceptar la política de datos" }),
  website: z.string().max(0).optional(), // honeypot
});
export type BookingRequest = z.input<typeof bookingRequestSchema>;
