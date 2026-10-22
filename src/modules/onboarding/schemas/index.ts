import { z } from "zod";

export const onboardingSchema = z.object({
  tradeName: z.string().trim().min(2, "Escribe el nombre de tu óptica").max(120),
  legalName: z.string().trim().min(2, "Escribe la razón social").max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/, "Solo minúsculas, números y guiones (3–48)"),
  taxIdType: z.enum(["NIT", "CC", "CE", "PP"]),
  taxId: z.string().trim().regex(/^[0-9]{5,15}$/, "Solo números, sin puntos ni DV").or(z.literal("")),
  taxDv: z.string().regex(/^[0-9]$/).or(z.literal("")),
  taxRegime: z.enum(["responsable_iva", "no_responsable_iva", "simple"]),
  branchName: z.string().trim().min(2, "Nombre de la sede").max(120),
  branchCity: z.string().trim().min(2, "Ciudad").max(80),
  branchAddress: z.string().trim().max(200).optional(),
  branchPhone: z.string().trim().max(30).optional(),
  specialty: z.enum(["optometry", "ophthalmology", "both"]),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const ONBOARDING_STEPS = [
  { key: "company", title: "Tu óptica", fields: ["tradeName", "legalName", "slug"] },
  { key: "tax", title: "Información tributaria", fields: ["taxIdType", "taxId", "taxDv", "taxRegime"] },
  { key: "branch", title: "Primera sede", fields: ["branchName", "branchCity", "branchAddress", "branchPhone"] },
  { key: "specialty", title: "Especialidad", fields: ["specialty"] },
] as const satisfies readonly { key: string; title: string; fields: readonly (keyof OnboardingInput)[] }[];
