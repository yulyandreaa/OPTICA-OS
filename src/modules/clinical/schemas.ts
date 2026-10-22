import { z } from "zod";

const diopter = z.string().trim().regex(/^$|^[+-]?\d{1,2}(\.\d{1,2})?$/, "Valor dióptrico inválido").refine((v) => v === "" || (Math.abs(Number(v)) <= 30 && (Number(v) * 4) % 1 === 0), "Usa pasos de 0.25");
const axis = z.string().trim().regex(/^$|^\d{1,3}$/, "Eje 0–180").refine((v) => v === "" || Number(v) <= 180, "Eje 0–180");
const short = z.string().trim().max(20).optional();
const eye = z.object({ sphere: diopter.optional(), cylinder: diopter.optional(), axis: axis.optional(), add: diopter.optional(), prism: short, base: short, va: short }).partial()
  .refine((e) => !e.cylinder || Number(e.cylinder) === 0 || !!e.axis, { message: "Un cilindro requiere eje", path: ["axis"] });

export const examSchema = z.object({
  va: z.object({ od: z.record(z.string(), z.string().max(12)).optional(), oi: z.record(z.string(), z.string().max(12)).optional() }).partial().optional(),
  refraction: z.object({ od: eye.optional(), oi: eye.optional() }).optional(),
  lensometry: z.object({ od: eye.optional(), oi: eye.optional() }).optional(),
  dp: z.object({ binocular: short, od: short, oi: short }).partial().optional(),
  heights: z.object({ od: short, oi: short }).partial().optional(),
  keratometry: z.object({ od: z.record(z.string(), z.string().max(10)).optional(), oi: z.record(z.string(), z.string().max(10)).optional() }).partial().optional(),
  iop: z.object({ od: short, oi: short }).partial().optional(),
});

const text = z.string().trim().max(4000).optional().transform((v) => v || null);

export const recordSchema = z.object({
  record_type: z.enum(["optometry", "ophthalmology", "contact_lens", "control"]),
  chief_complaint: text, current_illness: text, personal_history: text, family_history: text, ocular_history: text,
  allergies: text, medications: text, surgeries: text, habits: text, symptoms: text, external_exam: text, observations: text,
  exam: examSchema,
  diagnoses: z.array(z.object({ code: z.string().trim().max(10), label: z.string().trim().max(200) })).max(10),
  plan: text, recommendations: text,
  // `text` is the optometrist's free-text recommendation; type/material/treatments are kept for records made before it.
  lens_recommendation: z.object({
    text: z.string().max(2000, "Máximo 2000 caracteres").optional(),
    type: z.string().optional(), material: z.string().optional(), treatments: z.array(z.string()).max(6).optional(),
  }),
});
export type RecordInput = z.input<typeof recordSchema>;

export const amendSchema = z.object({
  reason: z.string().trim().min(5, "Explica el motivo de la enmienda (mín. 5 caracteres)").max(500),
  changes: recordSchema.partial().omit({ record_type: true }),
});
