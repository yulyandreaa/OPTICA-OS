import { createHash } from "node:crypto";

/** Invitation tokens are never stored; only their SHA-256 hash. */
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
