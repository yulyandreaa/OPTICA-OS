"use client";
import { Loader2, Plus, ScanBarcode, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KIND_LABEL, type Kind } from "@/modules/inventory/constants";
import { ProductThumb } from "@/modules/inventory/components/stock";
import { searchSaleProductsAction, type SaleProduct } from "../actions";

const KIND_FILTERS: (Kind | null)[] = [null, "frame", "ophthalmic_lens", "contact_lens", "supply", "service"];

/**
 * Search box with a dropdown of results from the chosen branch (name, SKU, brand, model, barcode).
 * Every result is one sellable variant, so the variant is always explicit. Enter on an exact barcode/SKU adds it at once.
 */
export function ProductPicker({ branchId, inCart, onAdd }: { branchId: string; inCart: (variantId: string) => number; onAdd: (p: SaleProduct) => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SaleProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      void searchSaleProductsAction(q, branchId, kind ?? undefined).then((r) => { if (alive) { setResults(r); setLoading(false); } });
    }, q ? 220 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, kind, branchId, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const add = (p: SaleProduct) => { onAdd(p); setQ(""); inputRef.current?.focus(); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = q.trim().toLowerCase();
    const exact = results.find((r) => r.barcode?.toLowerCase() === code || r.sku.toLowerCase() === code) ?? (results.length === 1 ? results[0] : undefined);
    if (exact) add(exact);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        {loading ? <Loader2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          : <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />}
        <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          aria-label="Buscar productos y servicios" aria-expanded={open} aria-controls="product-results" role="combobox" autoComplete="off"
          placeholder="Buscar producto por nombre, SKU, marca, modelo o código de barras"
          className="h-11 w-full rounded-xl border border-input bg-surface pr-10 pl-9 text-sm shadow-soft outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40" />
        <ScanBarcode className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>

      {open && (
        <div id="product-results" className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border bg-surface shadow-lg">
          <div className="flex flex-wrap gap-1.5 border-b p-2" role="group" aria-label="Categoría">
            {KIND_FILTERS.map((k) => (
              <button key={k ?? "all"} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", kind === k ? "border-brand bg-brand-soft font-medium text-brand" : "text-muted-foreground hover:bg-muted")}>
                {k ? KIND_LABEL[k] : "Todo"}
              </button>
            ))}
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto" aria-label="Resultados" aria-busy={loading}>
            {results.map((p) => {
              const left = p.available === null ? null : p.available - inCart(p.variantId);
              const out = left !== null && left <= 0;
              return (
                <li key={p.variantId}>
                  <button type="button" onClick={() => add(p)} disabled={out}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60">
                    <ProductThumb imageUrl={p.image} colorHex={p.colorHex} kind={p.kind} className="size-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}{p.detail && <span className="font-normal text-muted-foreground"> · {p.detail}</span>}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[p.brand, p.model, p.sku].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-medium tabular">{formatMoney(p.price)}</span>
                      <Availability left={left} />
                    </span>
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand", out && "invisible")}><Plus className="size-4" /></span>
                  </button>
                </li>
              );
            })}
            {!loading && results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {q ? `No encontramos productos activos con “${q}”.` : "No hay productos activos en esta categoría. Créalos en Inventario."}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Availability({ left }: { left: number | null }) {
  if (left === null) return <span className="block text-xs text-muted-foreground">Por encargo</span>;
  if (left <= 0) return <span className="block text-xs font-medium text-destructive">Sin unidades</span>;
  return <span className={cn("block text-xs tabular", left <= 2 ? "font-medium text-[oklch(0.5_0.12_60)]" : "text-success")}>{left} disponible{left === 1 ? "" : "s"}</span>;
}
