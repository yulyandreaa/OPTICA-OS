"use server";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { bookingRequestSchema, type BookingRequest } from "./schemas";

const POLICY_VERSION = "2026-10";

const slotsSchema = z.object({ slug: z.string(), branchId: z.uuid(), serviceId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), specialistId: z.uuid().nullable() });

export async function getSlotsAction(input: z.infer<typeof slotsSchema>) {
  const parsed = slotsSchema.safeParse(input);
  if (!parsed.success) return [];
  if (!(await rateLimit("book:slots", 60, 60_000))) return [];
  const db = await createClient();
  const { data } = await db.rpc("booking_slots", {
    p_slug: parsed.data.slug, p_branch: parsed.data.branchId, p_type: parsed.data.serviceId, p_date: parsed.data.date,
    p_specialist: parsed.data.specialistId ?? undefined,
  });
  // One entry per start time; keep the first available specialist.
  const seen = new Map<string, string>();
  for (const s of data ?? []) if (s.starts_at && s.specialist_id && !seen.has(s.starts_at)) seen.set(s.starts_at, s.specialist_id);
  return [...seen.entries()].map(([startsAt, specialistId]) => ({ startsAt, specialistId }));
}

export async function createBookingAction(input: BookingRequest): Promise<ActionResult<{ startsAt: string }>> {
  const parsed = bookingRequestSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  if (!(await rateLimit("book:create", 5, 10 * 60_000))) return fail("Recibimos demasiadas solicitudes. Inténtalo en unos minutos o escríbenos por WhatsApp.");
  const v = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc("booking_create", {
    p_slug: v.slug, p_branch: v.branchId, p_type: v.serviceId, p_specialist: v.specialistId, p_starts_at: v.startsAt,
    p_document_type: v.documentType, p_document_number: v.documentNumber.toUpperCase(), p_first_name: v.firstName, p_last_name: v.lastName,
    p_phone: v.phone, p_email: v.email ?? "", p_accept_data_policy: v.acceptPolicy, p_policy_version: POLICY_VERSION,
  });
  if (error) return fromError("booking.create", error);
  return ok({ startsAt: (data as { starts_at: string }).starts_at });
}
