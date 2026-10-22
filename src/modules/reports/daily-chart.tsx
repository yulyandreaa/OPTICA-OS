"use client";
import { useState } from "react";
import { formatCompactMoney, formatMoney } from "@/lib/format";

/** Single-series column chart (magnitude → one hue). Hover tooltip per bar; data table for screen readers. */
export function DailyChart({ data }: { data: { day: string; total: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.total));
  const niceMax = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const ticks = [0, niceMax / 2, niceMax];
  const H = 200;
  const fmtDay = (d: string) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <figure className="grid gap-2">
      <div className="relative grid grid-cols-[52px_1fr] gap-2">
        <div className="relative" style={{ height: H }} aria-hidden>
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] text-muted-foreground tabular" style={{ top: H - (t / niceMax) * H }}>{formatCompactMoney(t)}</span>)}
        </div>
        <div className="relative" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <div key={t} aria-hidden className="absolute inset-x-0 border-t border-border/70" style={{ top: H - (t / niceMax) * H }} />)}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div key={d.day} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                <div className="w-full rounded-t-[4px] bg-brand transition-opacity"
                  style={{ height: Math.max(d.total > 0 ? 2 : 0, (d.total / niceMax) * H), opacity: hover === null || hover === i ? 1 : 0.45 }} />
              </div>
            ))}
          </div>
          {hover !== null && data[hover] && (
            <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lift"
              style={{ left: `${((hover + 0.5) / data.length) * 100}%`, top: Math.max(0, H - (data[hover].total / niceMax) * H - 64) }}>
              <p className="font-medium">{fmtDay(data[hover].day)}</p>
              <p className="tabular">{formatMoney(data[hover].total)}</p>
              <p className="text-muted-foreground">{data[hover].count} ventas</p>
            </div>
          )}
        </div>
      </div>
      <div className="ml-[60px] flex text-[11px] text-muted-foreground" aria-hidden>
        {data.map((d, i) => <span key={d.day} className="flex-1 text-center">{i % labelEvery === 0 ? fmtDay(d.day) : ""}</span>)}
      </div>
      <table className="sr-only">
        <caption>Ventas por día</caption>
        <thead><tr><th>Día</th><th>Total</th><th>Ventas</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.total}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
