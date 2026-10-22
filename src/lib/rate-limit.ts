import "server-only";
import { headers } from "next/headers";

/**
 * Fixed-window, in-memory rate limiter. Good enough for a single instance / dev.
 * Swap the store for Upstash/Redis in production (see SECURITY.md) — the call sites don't change.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const id = `${key}:${await clientIp()}`;
  const now = Date.now();
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}
