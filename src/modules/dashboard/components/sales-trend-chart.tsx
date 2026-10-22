"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NativeSelect } from "@/components/shared/native-select";
import { formatCompactMoney, formatMoney } from "@/lib/format";
import type { Bucket } from "../period";

export interface TrendPoint { bucket: string; net: number; count: number; prev_bucket: string | null; prev_net: number }

/** "1 oct", "16 sept" or "oct 26": short enough for axis labels (es-CO's "1 de oct." is not). */
const fmtBucket = (d: string, bucket: Bucket) => {
  const date = new Date(`${d}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("es-CO", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return bucket === "month" ? `${month} ${d.slice(2, 4)}` : `${date.getUTCDate()} ${month}`;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Net sales over time: current period as a 2px line over a soft area (brand), the comparison period as a
 * 2px gray line. One measure, one axis. Crosshair + tooltip on hover; table for screen readers.
 */
export function SalesTrendChart({ data, bucket, compare, prevLabel }: { data: TrendPoint[]; bucket: Bucket; compare: boolean; prevLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 230, PAD_L = 52, PAD_R = 12, PAD_T = 10, PAD_B = 26;
  const max = Math.max(1, ...data.map((d) => Math.max(d.net, compare ? d.prev_net : 0)));
  const niceMax = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 2 ? 2 : m <= 4 ? 4 : m <= 6 ? 6 : m <= 8 ? 8 : 10) * p; })();
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const plotW = Math.max(0, width - PAD_L - PAD_R), plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / niceMax) * plotH;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const cur = path(data.map((d) => d.net));
  const area = data.length ? `${cur}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 70))));
  const showDots = data.length <= 31;
  const point = hover !== null ? data[hover] : undefined;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(rel * (data.length - 1)))));
  };

  return (
    <figure className="relative min-w-0" ref={ref} style={{ minHeight: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Ventas netas por período" className="overflow-visible">
          <defs>
            <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={width - PAD_R} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={PAD_L - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{formatCompactMoney(t)}</text>
            </g>
          ))}
          {data.map((d, i) => (i % labelEvery === 0 ? (
            <text key={d.bucket} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">{fmtBucket(d.bucket, bucket)}</text>
          ) : null))}
          {compare && <path d={path(data.map((d) => d.prev_net))} fill="none" className="stroke-muted-foreground/50" strokeWidth={2} strokeLinejoin="round" />}
          <path d={area} fill="url(#trend-area)" />
          <path d={cur} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" />
          {showDots && data.map((d, i) => (
            <g key={d.bucket}>
              {compare && <circle cx={x(i)} cy={y(d.prev_net)} r={3} className="fill-muted-foreground/60 stroke-surface" strokeWidth={2} />}
              <circle cx={x(i)} cy={y(d.net)} r={hover === i ? 5 : 3.5} fill="var(--brand)" className="stroke-surface" strokeWidth={2} />
            </g>
          ))}
          {point && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={y(0)} className="stroke-foreground/25" strokeDasharray="3 3" />}
          <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {point && hover !== null && (
        <div className="pointer-events-none absolute z-10 min-w-44 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lift"
          style={{ left: Math.min(Math.max(x(hover), 96), width - 96), top: 0 }}>
          <p className="font-medium">{bucket === "week" ? "Semana del " : ""}{fmtBucket(point.bucket, bucket)}</p>
          <p className="flex justify-between gap-3 tabular"><span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full bg-brand" />Ventas netas</span>{formatMoney(point.net)}</p>
          <p className="flex justify-between gap-3 tabular"><span className="text-muted-foreground">Ventas</span>{point.count}</p>
          {compare && point.prev_bucket && (
            <p className="flex justify-between gap-3 tabular"><span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="size-2 rounded-full bg-muted-foreground/60" />{fmtBucket(point.prev_bucket, bucket)}</span>{formatMoney(point.prev_net)}</p>
          )}
        </div>
      )}
      <table className="sr-only">
        <caption>Ventas netas por {bucket === "day" ? "día" : bucket === "week" ? "semana" : "mes"}{compare ? `, comparadas con ${prevLabel}` : ""}</caption>
        <thead><tr><th>Período</th><th>Ventas netas</th><th>Ventas</th>{compare && <th>Comparación</th>}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.bucket}><td>{d.bucket}</td><td>{d.net}</td><td>{d.count}</td>{compare && <td>{d.prev_net}</td>}</tr>)}</tbody>
      </table>
    </figure>
  );
}

const BUCKETS: { key: Bucket; label: string }[] = [{ key: "day", label: "Por días" }, { key: "week", label: "Por semanas" }, { key: "month", label: "Por meses" }];

/** Legend, compare switch and granularity (in the URL as ?agrupar=) above the chart. */
export function SalesTrend(props: { data: TrendPoint[]; bucket: Bucket; prevLabel: string; allowed: Bucket[] }) {
  const [compare, setCompare] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setBucket = (b: Bucket) => {
    const next = new URLSearchParams(params.toString());
    next.set("agrupar", b);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand" />Período actual</span>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="size-3.5 accent-[var(--brand)]" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          <span className="size-2.5 rounded-full bg-muted-foreground/60" />{props.prevLabel}
        </label>
        {props.allowed.length > 1 && (
          <NativeSelect aria-label="Agrupar" value={props.bucket} onChange={(e) => setBucket(e.target.value as Bucket)} className="h-8 w-auto text-xs">
            {BUCKETS.filter((b) => props.allowed.includes(b.key)).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </NativeSelect>
        )}
      </div>
      <SalesTrendChart data={props.data} bucket={props.bucket} compare={compare} prevLabel={props.prevLabel} />
    </div>
  );
}
