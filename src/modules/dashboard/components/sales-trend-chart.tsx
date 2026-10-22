"use client";
import { useState } from "react";
import { formatCompactMoney, formatMoney } from "@/lib/format";
import type { Bucket } from "../period";

export interface TrendPoint { bucket: string; net: number; count: number; prev_bucket: string | null; prev_net: number }

/** "1 oct", "16 sept" or "oct 26": short enough for axis labels (es-CO's "1 de oct." is not). */
const fmtBucket = (d: string, bucket: Bucket) => {
  const date = new Date(`${d}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("es-CO", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return bucket === "month" ? `${month} ${d.slice(2, 4)}` : `${date.getUTCDate()} ${month}`;
};
const bucketName = (b: Bucket) => (b === "day" ? "Día" : b === "week" ? "Semana del" : "Mes");

/**
 * Net sales per bucket (brand) next to the comparison period (neutral gray): one measure, one axis.
 * Two series → legend always visible; hover tooltip per bucket; a table for screen readers.
 */
export function SalesTrendChart({ data, bucket, compare, prevLabel }: { data: TrendPoint[]; bucket: Bucket; compare: boolean; prevLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.net, compare ? d.prev_net : 0)));
  const niceMax = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const ticks = [0, niceMax / 2, niceMax];
  const H = 200;
  const labelEvery = Math.ceil(data.length / 8);
  const h = (v: number) => Math.max(v > 0 ? 2 : 0, (v / niceMax) * H);
  const point = hover !== null ? data[hover] : undefined;

  return (
    <figure className="grid min-w-0 gap-3">
      {compare && (
        <figcaption className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand" />Período actual</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-muted-foreground/35" />Comparación: {prevLabel}</span>
        </figcaption>
      )}
      <div className="relative grid grid-cols-[52px_1fr] gap-2">
        <div className="relative" style={{ height: H }} aria-hidden>
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] text-muted-foreground tabular" style={{ top: H - (t / niceMax) * H }}>{formatCompactMoney(t)}</span>)}
        </div>
        <div className="relative" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <div key={t} aria-hidden className="absolute inset-x-0 border-t border-border/70" style={{ top: H - (t / niceMax) * H }} />)}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {data.map((d, i) => (
              <div key={d.bucket} className="relative flex h-full flex-1 items-end justify-center gap-[2px]" onMouseEnter={() => setHover(i)}>
                {compare && (
                  <div className="w-full max-w-5 rounded-t-[4px] bg-muted-foreground/35 transition-opacity"
                    style={{ height: h(d.prev_net), opacity: hover === null || hover === i ? 1 : 0.45 }} />
                )}
                <div className="w-full max-w-5 rounded-t-[4px] bg-brand transition-opacity"
                  style={{ height: h(d.net), opacity: hover === null || hover === i ? 1 : 0.45 }} />
              </div>
            ))}
          </div>
          {point && hover !== null && (
            <div className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lift"
              style={{ left: `clamp(80px, ${((hover + 0.5) / data.length) * 100}%, calc(100% - 80px))`, top: 0 }}>
              <p className="font-medium">{bucketName(bucket)} {fmtBucket(point.bucket, bucket)}</p>
              <p className="flex justify-between gap-3 tabular"><span className="text-muted-foreground">Ventas netas</span>{formatMoney(point.net)}</p>
              <p className="flex justify-between gap-3 tabular"><span className="text-muted-foreground">Ventas</span>{point.count}</p>
              {compare && point.prev_bucket && (
                <p className="flex justify-between gap-3 tabular"><span className="text-muted-foreground">{fmtBucket(point.prev_bucket, bucket)}</span>{formatMoney(point.prev_net)}</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="ml-[60px] flex overflow-hidden text-[11px] text-muted-foreground" aria-hidden>
        {data.map((d, i) => <span key={d.bucket} className="min-w-0 flex-1 text-center whitespace-nowrap">{i % labelEvery === 0 ? fmtBucket(d.bucket, bucket) : ""}</span>)}
      </div>
      <table className="sr-only">
        <caption>Ventas netas por {bucket === "day" ? "día" : bucket === "week" ? "semana" : "mes"}</caption>
        <thead><tr><th>Período</th><th>Ventas netas</th><th>Ventas</th>{compare && <th>Comparación</th>}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.bucket}><td>{d.bucket}</td><td>{d.net}</td><td>{d.count}</td>{compare && <td>{d.prev_net}</td>}</tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Chart plus the "compare with previous period" switch (on by default). */
export function SalesTrend(props: { data: TrendPoint[]; bucket: Bucket; prevLabel: string }) {
  const [compare, setCompare] = useState(true);
  return (
    <div className="grid gap-3">
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="size-3.5 accent-[var(--brand)]" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
        Comparar con {props.prevLabel}
      </label>
      <SalesTrendChart {...props} compare={compare} />
    </div>
  );
}
