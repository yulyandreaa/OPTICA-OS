const DEFAULT_TZ = "America/Bogota";
const LOCALE = "es-CO";

/** Money is carried as string/number from NUMERIC columns; never do float math for totals here. */
export function formatMoney(value: number | string | null | undefined, currency = "COP") {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));
}

export function formatCompactMoney(value: number, currency = "COP") {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value: string | Date, tz = DEFAULT_TZ, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, ...opts }).format(new Date(value));
}

export function formatTime(value: string | Date, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
}

export function ageFrom(birthDate: string | null | undefined, now = new Date()): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

/** Human age: "3 meses" under 2 years (babies), "34 años" otherwise, "recién nacido" under a month. */
export function formatAge(birthDate: string | null | undefined, now = new Date()): string | null {
  const years = ageFrom(birthDate, now);
  if (years === null || years < 0) return null;
  if (years >= 2) return `${years} años`;
  const [y, m, d] = birthDate!.split("-").map(Number) as [number, number, number];
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months--;
  if (months < 1) return "recién nacido";
  return `${months} ${months === 1 ? "mes" : "meses"}`;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/** Local calendar date (YYYY-MM-DD) in a timezone. */
export function localDateKey(value: Date, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

/** UTC instant for a wall-clock time in a timezone (handles fixed-offset zones like Bogotá and DST zones). */
export function zonedTimeToUtc(dateKey: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asTz = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (asTz - guess));
}

/** Minutes since local midnight of an instant in a timezone. */
export function minutesInTz(value: string | Date, tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(value));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return get("hour") * 60 + get("minute");
}

/** Adds days to a YYYY-MM-DD key (calendar arithmetic, timezone-free). */
export function addDaysKey(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado for a YYYY-MM-DD key. */
export function weekdayOfKey(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
