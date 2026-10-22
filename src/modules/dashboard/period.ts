import { addDaysKey } from "@/lib/format";

export type PeriodKey = "hoy" | "7d" | "mes" | "mes_anterior" | "rango";
export type Bucket = "day" | "week" | "month";

export interface Period {
  key: PeriodKey;
  from: string; // YYYY-MM-DD, inclusive, tenant timezone
  to: string;
  prevFrom: string;
  prevTo: string;
  bucket: Bucket;
  label: string;
  prevLabel: string;
}

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "7d", label: "Últimos 7 días" },
  { key: "mes", label: "Mes actual" },
  { key: "mes_anterior", label: "Mes anterior" },
  { key: "rango", label: "Rango personalizado" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function monthStart(key: string) {
  return `${key.slice(0, 8)}01`;
}

function lastDayOfMonth(key: string) {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Same day-of-month one month back, clamped (31 Mar → 28/29 Feb). */
function sameDayPrevMonth(key: string) {
  const prevEnd = lastDayOfMonth(addDaysKey(monthStart(key), -1));
  const day = Math.min(Number(key.slice(8, 10)), Number(prevEnd.slice(8, 10)));
  return `${prevEnd.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** Day columns up to a month, weeks up to ~4 months, months beyond. */
export function bucketFor(days: number): Bucket {
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

const fmt = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-CO", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
const rangeLabel = (from: string, to: string) =>
  from === to ? fmt(from, { day: "numeric", month: "short" }) : `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;

/**
 * Resolves the dashboard period from URL params. The comparison period always has the same shape:
 * yesterday for today, the previous 7 days, the same days of the previous month for month-to-date,
 * the whole month before for "mes anterior", and an equally long window right before a custom range.
 */
export function resolvePeriod(params: { periodo?: string; desde?: string; hasta?: string }, today: string): Period {
  let key = (PERIOD_OPTIONS.some((o) => o.key === params.periodo) ? params.periodo : "mes") as PeriodKey;
  let from: string, to: string, prevFrom: string, prevTo: string;

  if (key === "rango") {
    const valid = params.desde && params.hasta && DATE.test(params.desde) && DATE.test(params.hasta)
      && params.desde <= params.hasta && params.hasta <= today && daysBetween(params.desde, params.hasta) <= MAX_RANGE_DAYS;
    if (!valid) key = "mes";
  }

  switch (key) {
    case "hoy":
      from = to = today;
      prevFrom = prevTo = addDaysKey(today, -1);
      break;
    case "7d":
      from = addDaysKey(today, -6); to = today;
      prevFrom = addDaysKey(today, -13); prevTo = addDaysKey(today, -7);
      break;
    case "mes_anterior": {
      to = addDaysKey(monthStart(today), -1); from = monthStart(to);
      prevTo = addDaysKey(from, -1); prevFrom = monthStart(prevTo);
      break;
    }
    case "rango": {
      from = params.desde!; to = params.hasta!;
      const n = daysBetween(from, to);
      prevTo = addDaysKey(from, -1); prevFrom = addDaysKey(from, -n);
      break;
    }
    default:
      from = monthStart(today); to = today;
      prevFrom = monthStart(addDaysKey(from, -1)); prevTo = sameDayPrevMonth(today);
  }

  const label = key === "hoy" ? "Hoy" : key === "mes" ? `${fmt(from, { month: "long" })} (hasta hoy)` : key === "mes_anterior" ? fmt(from, { month: "long", year: "numeric" }) : rangeLabel(from, to);
  const prevLabel = key === "hoy" ? "ayer" : key === "mes" || key === "mes_anterior" ? `${fmt(prevFrom, { month: "long" })}${key === "mes" ? " (mismos días)" : ""}` : rangeLabel(prevFrom, prevTo);
  return { key, from, to, prevFrom, prevTo, bucket: bucketFor(daysBetween(from, to)), label, prevLabel };
}

/** % change, or null when there is no base to compare against (never a fake +100%). */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
