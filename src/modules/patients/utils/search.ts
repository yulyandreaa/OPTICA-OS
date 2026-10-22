/**
 * One indexed predicate per kind of input instead of OR-ing every column:
 * e-mail → email prefix; ≥4 digits → document prefix or phone; otherwise → name (trigram index).
 * Document numbers with letters (passports) also match by prefix.
 */
export function searchFilter(raw: string) {
  const q = raw.replace(/[%_,()*\\]/g, " ").trim();
  if (q.includes("@")) return { kind: "email" as const, value: q.toLowerCase() };
  if (/^[A-Za-z]{1,3}-?\d{4,}$/.test(q)) return { kind: "document" as const, value: q.toUpperCase() };
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && !/[A-Za-zÀ-ÿ]/.test(q)) return { kind: "number" as const, value: digits };
  return { kind: "name" as const, value: q };
}
