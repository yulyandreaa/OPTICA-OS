/** Dígito de verificación DIAN para NIT (módulo 11 con pesos primos). */
const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function nitCheckDigit(nit: string): string | null {
  const digits = nit.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 15) return null;
  let sum = 0;
  [...digits].reverse().forEach((d, i) => { sum += Number(d) * WEIGHTS[i]!; });
  const r = sum % 11;
  return String(r > 1 ? 11 - r : r);
}

export function slugify(value: string) {
  return value
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
