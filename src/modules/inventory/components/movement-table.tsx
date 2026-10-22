import { ArrowDownLeft, ArrowUpRight, History } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatQty, MOVEMENT_LABEL, variantLabel } from "../constants";
import type { MovementRow } from "../repositories";

const REFERENCE_HREF: Record<string, (id: string) => string> = {
  sale: (id) => `/ventas/${id}`, purchase_order: (id) => `/compras/${id}`, transfer: () => "/inventario/traslados",
};

/** Kardex rows: real movements only (nothing is filled in). Costs arrive as null for users without inventory.costs. */
export function MovementTable({ rows, tz, showProduct = true, showCost, emptyText = "Aún no hay movimientos registrados." }: {
  rows: MovementRow[]; tz: string; showProduct?: boolean; showCost: boolean; emptyText?: string;
}) {
  if (rows.length === 0) return <EmptyState compact icon={History} title="Sin movimientos" description={emptyText} />;
  return (
    <ul className="divide-y">
      {rows.map((m) => {
        const qty = Number(m.quantity);
        const lots = (Array.isArray(m.lot_allocations) ? m.lot_allocations : []) as { lot_code: string; quantity: number }[];
        const variant = variantLabel({ color_name: m.color_name, attributes: m.variant_attributes });
        const href = m.reference_type && m.reference_id ? REFERENCE_HREF[m.reference_type]?.(m.reference_id) : undefined;
        return (
          <li key={m.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", qty > 0 ? "bg-success-soft text-success" : "bg-danger-soft text-destructive")}>
              {qty > 0 ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{MOVEMENT_LABEL[m.type ?? ""] ?? m.type}</span>
                {href && m.reference_label && <Link href={href} className="font-mono text-xs text-brand hover:underline">{m.reference_label}</Link>}
                <span className="text-xs text-muted-foreground">{m.branch_name}</span>
              </p>
              <p className="truncate text-muted-foreground">
                {showProduct && <Link href={`/inventario/${m.product_id}`} className="hover:text-foreground">{m.product_name}</Link>}
                {variant && `${showProduct ? " · " : ""}${variant}`}
                <span className="ml-1 font-mono text-xs">{m.sku}</span>
              </p>
              {m.notes && <p className="text-muted-foreground">{m.notes}</p>}
              {lots.length > 0 && <p className="text-xs text-muted-foreground">Lotes: {lots.map((l) => `${l.lot_code} (${formatQty(l.quantity)})`).join(", ")}</p>}
              <p className="text-xs text-muted-foreground">
                {formatDate(m.created_at!, tz, { day: "numeric", month: "short", year: "numeric" })} · {formatTime(m.created_at!, tz)}{m.author_name ? ` · ${m.author_name}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className={cn("font-semibold tabular", qty > 0 ? "text-success" : "text-destructive")}>{qty > 0 ? "+" : ""}{formatQty(qty)}</p>
              {showCost && m.unit_cost !== null && Number(m.unit_cost) > 0 && <p className="text-xs text-muted-foreground tabular">{formatMoney(m.unit_cost)} c/u</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
