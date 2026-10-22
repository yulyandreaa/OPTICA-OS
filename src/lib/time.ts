import { connection } from "next/server";

/**
 * Request-time clock for Server Components. `connection()` tells Cache Components this value
 * belongs to the request (never to the prerendered shell).
 */
export async function nowMs() {
  await connection();
  return Date.now();
}

export async function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - (await nowMs())) / 86_400_000));
}
