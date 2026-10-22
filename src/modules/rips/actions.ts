"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, fromError, ok, type ActionResult } from "@/lib/action";
import { addDaysKey, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getRipsProvider } from "@/integrations/rips";
import { mapRips, RIPS_SCHEMA_VERSION } from "@/integrations/rips/mapper";
import type { Json } from "@/lib/supabase/database.types";
import { ripsConfigFrom } from "./config";
import { validateRips } from "@/integrations/rips/validator";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";


export async function generateRipsAction(month: string) {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "rips.manage")) return { ok: false as const, error: "No tienes permiso para generar RIPS." };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false as const, error: "Mes inválido." };
  const db = await createClient();
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = addDaysKey(nextMonth, -1);

  const { data: records } = await db.from("medical_records")
    .select("id, created_at, diagnoses, professional_id, appointment:appointments(type:appointment_types(price)), patient:patients(document_type, document_number, birth_date, sex, health_regime)")
    .eq("tenant_id", ctx.tenant.id).neq("status", "draft")
    .gte("created_at", zonedTimeToUtc(start, "00:00", ctx.timezone).toISOString())
    .lt("created_at", zonedTimeToUtc(nextMonth, "00:00", ctx.timezone).toISOString())
    .order("created_at").limit(5000);

  const config = ripsConfigFrom(ctx.tenant.settings, ctx.tenant.tax_id);
  const payload = mapRips(config, (records ?? []).flatMap((r) => r.patient ? [{
    recordId: r.id, date: r.created_at,
    patient: { documentType: r.patient.document_type, documentNumber: r.patient.document_number, birthDate: r.patient.birth_date, sex: r.patient.sex, healthRegime: r.patient.health_regime },
    professional: { documentType: "CC", documentNumber: null },
    diagnoses: (r.diagnoses ?? []) as { code: string }[],
    value: r.appointment?.type?.price ? Number(r.appointment.type.price) : null,
  }] : []));
  const validation = validateRips(payload);
  const { data, error } = await db.from("rips_submissions").insert({
    tenant_id: ctx.tenant.id, period_start: start, period_end: end, schema_version: RIPS_SCHEMA_VERSION,
    status: validation.valid ? "validated" : "rejected", payload: toJson(payload), validation: toJson(validation), errors_count: validation.errors.length,
    warnings_count: validation.warnings.length, records_count: records?.length ?? 0, idempotency_key: `rips:${month}:${Date.now()}`, created_by: ctx.user.id,
  }).select("id").single();
  if (error) return { ok: false as const, error: "No se pudo guardar el RIPS." };
  revalidatePath("/rips");
  redirect(`/rips/${data.id}`);
}

export async function submitRipsAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "rips.manage")) return fail("No tienes permiso.");
  const db = await createClient();
  const { data: sub } = await db.from("rips_submissions").select("id, status, payload, schema_version, idempotency_key").eq("tenant_id", ctx.tenant.id).eq("id", id).single();
  if (!sub) return fail("No encontramos el envío.");
  if (sub.status !== "validated") return fail("Corrige los errores antes de enviar.");
  const provider = getRipsProvider();
  const started = Date.now();
  try {
    const res = await provider.submit({ tenantId: ctx.tenant.id, payload: sub.payload, version: sub.schema_version, idempotencyKey: sub.idempotency_key });
    await db.from("rips_submissions").update({ status: res.status === "submitted" ? "submitted" : "rejected", provider: provider.name, provider_ref: res.submissionRef, submitted_at: new Date().toISOString() }).eq("id", id);
    await db.from("integration_logs").insert({ tenant_id: ctx.tenant.id, provider: `rips:${provider.name}`, operation: "submit", status: "success", request_id: sub.idempotency_key, duration_ms: Date.now() - started });
  } catch (err) {
    await db.from("integration_logs").insert({ tenant_id: ctx.tenant.id, provider: `rips:${provider.name}`, operation: "submit", status: "error", request_id: sub.idempotency_key, duration_ms: Date.now() - started, error: "provider_error" });
    return fromError("rips.submit", err);
  }
  revalidatePath(`/rips/${id}`);
  return ok(undefined, provider.name === "mock" ? "Enviado al sandbox de RIPS" : "RIPS enviado");
}

const configSchema = z.object({
  providerCode: z.string().trim().regex(/^$|^\d{10,12}$/, "Código REPS de 10–12 dígitos"),
  municipalityCode: z.string().regex(/^\d{5}$/, "DIVIPOLA de 5 dígitos"),
  consultationCode: z.string().trim().min(4).max(10), purposeCode: z.string().trim().min(1).max(4), causeCode: z.string().trim().min(1).max(4),
  defaultConsultationValue: z.coerce.number().min(0),
});

export async function saveRipsConfigAction(input: z.input<typeof configSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "settings.manage")) return fail("Solo un administrador puede cambiar la configuración de RIPS.");
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const db = await createClient();
  const settings = { ...((ctx.tenant.settings ?? {}) as Record<string, unknown>), rips: { ...parsed.data, providerCode: parsed.data.providerCode || null } };
  const { error } = await db.from("tenants").update({ settings }).eq("id", ctx.tenant.id);
  if (error) return fromError("rips.config", error);
  revalidatePath("/rips");
  return ok(undefined, "Configuración guardada");
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
