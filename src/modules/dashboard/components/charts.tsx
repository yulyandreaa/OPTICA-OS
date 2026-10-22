import { formatCompactMoney, formatMoney } from "@/lib/format";

/**
 * Fixed color per default category (color follows the entity, never its rank). Slots 1–5 were
 * validated together, so segments are drawn in this order; anything else folds into gray "Otros".
 */
const CATEGORY_SLOTS = ["Monturas", "Lentes oftálmicos", "Lentes de contacto", "Accesorios", "Gafas de sol"] as const;
const SLOT_COLOR = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const OTHER_COLOR = "var(--series-other)";

export function groupCategories(rows: { category: string; net: number }[]) {
  const named = CATEGORY_SLOTS.map((name, i) => ({ name, color: SLOT_COLOR[i]!, net: rows.find((r) => r.category === name)?.net ?? 0 })).filter((c) => c.net > 0);
  const other = rows.filter((r) => !CATEGORY_SLOTS.includes(r.category as (typeof CATEGORY_SLOTS)[number])).reduce((a, r) => a + r.net, 0);
  return other > 0 ? [...named, { name: "Otros", color: OTHER_COLOR, net: other }] : named;
}

/** Parts of a whole: donut with the total in the middle and a labeled legend (names + %) beside it. */
export function CategoryDonut({ rows }: { rows: { category: string; net: number }[] }) {
  const parts = groupCategories(rows);
  const total = parts.reduce((a, p) => a + p.net, 0);
  const R = 70, STROKE = 22, C = 2 * Math.PI * R, GAP = parts.length > 1 ? 2 : 0;
  // Start of each segment along the ring (cumulative share of the total).
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + (p.net / total) * C, 0));
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <svg viewBox="0 0 180 180" className="size-44 shrink-0" role="img" aria-label="Ventas netas por categoría">
        <g transform="rotate(-90 90 90)">
          {parts.map((p, i) => (
            <circle key={p.name} cx="90" cy="90" r={R} fill="none" stroke={p.color} strokeWidth={STROKE}
              strokeDasharray={`${Math.max(0, (p.net / total) * C - GAP)} ${C}`} strokeDashoffset={-starts[i]!}>
              <title>{`${p.name}: ${formatMoney(p.net)}`}</title>
            </circle>
          ))}
        </g>
        <text x="90" y="86" textAnchor="middle" className="fill-foreground text-[17px] font-semibold tabular-nums">{formatCompactMoney(total)}</text>
        <text x="90" y="106" textAnchor="middle" className="fill-muted-foreground text-[11px]">Ventas netas</text>
      </svg>
      <ul className="grid w-full min-w-0 grid-cols-1 gap-2.5 text-sm">
        {parts.map((p) => (
          <li key={p.name} className="flex min-w-0 items-center gap-2.5" title={formatMoney(p.net)}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 font-medium tabular">{Math.round((p.net / total) * 100)}%</span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Ventas netas por categoría</caption>
        <tbody>{parts.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.net}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Stable color per branch (by name order, so a filter never repaints a branch). */
export function branchColor(index: number) {
  return SLOT_COLOR[index % SLOT_COLOR.length]!;
}
