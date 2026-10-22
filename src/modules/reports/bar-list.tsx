import { formatMoney } from "@/lib/format";

/** Ranked horizontal bars (magnitude, one hue) with direct value labels; text stays in ink tokens. */
export function BarList({ items, emptyLabel = "Sin datos en el periodo" }: { items: { label: string; value: number; sub?: string }[]; emptyLabel?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className="grid gap-2.5">
      {items.map((i) => (
        <li key={i.label} className="grid gap-1" title={`${i.label}: ${formatMoney(i.value)}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{i.label}{i.sub && <span className="text-muted-foreground"> · {i.sub}</span>}</span>
            <span className="font-medium tabular">{formatMoney(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
