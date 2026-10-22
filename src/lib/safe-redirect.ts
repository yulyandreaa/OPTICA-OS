/** Only allow same-origin relative paths as post-auth redirects (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/inicio") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
