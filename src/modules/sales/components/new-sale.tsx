"use client";
import { AlertTriangle, Loader2, MessageSquarePlus, Minus, PackageSearch, Percent, Plus, Save, ShoppingCart, Trash2, UserRound, Wallet, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProductThumb } from "@/modules/inventory/components/stock";
import { createSaleAction, deleteSaleDraftAction, saveSaleDraftAction, searchSaleProductsAction, type CustomerHit, type SaleProduct } from "../actions";
import { lineTotals } from "../constants";
import { CustomerPicker } from "./customer-picker";
import { PaymentDialog, type PaymentPlan } from "./payment-dialog";
import { ProductPicker } from "./product-picker";

/** A discount is typed as a percentage or a peso amount; the server always receives the peso amount per line. */
type DiscountMode = "percent" | "amount";
export type SaleLine = { product: SaleProduct; quantity: number; discountMode: DiscountMode; discountValue: number };
export type DraftData = { id: string; number: string; branchId: string; customer: CustomerHit | null; sellerId: string; notes: string;
  lines: { product: SaleProduct; quantity: number; discount: number }[] };

const digits = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const gross = (l: SaleLine) => l.quantity * l.product.price;
const discountOf = (l: SaleLine) => Math.min(gross(l), l.discountMode === "percent" ? Math.round((gross(l) * l.discountValue) / 100) : l.discountValue);

/**
 * "Nueva venta": who and where on top, then the products with their discounts; a summary that stays in view on the right.
 * Totals here are a preview with the same math as the database, which recalculates everything from the catalog on save.
 */
export function NewSale({ branches, initialBranchId, sellers, me, discountBranches, canCreateCustomer, initialCustomer, draft }: {
  branches: { id: string; name: string }[]; initialBranchId: string; sellers: { id: string; name: string }[]; me: string;
  discountBranches: string[]; canCreateCustomer: boolean; initialCustomer: CustomerHit | null; draft: DraftData | null;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(draft?.branchId ?? initialBranchId);
  const [customer, setCustomer] = useState<CustomerHit | null>(draft?.customer ?? initialCustomer);
  const [sellerId, setSellerId] = useState(draft?.sellerId ?? me);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [showNotes, setShowNotes] = useState(!!draft?.notes);
  const [lines, setLines] = useState<SaleLine[]>(() => (draft?.lines ?? []).map((l) => ({ product: l.product, quantity: l.quantity, discountMode: "amount", discountValue: l.discount })));
  const [draftId, setDraftId] = useState(draft?.id ?? null);
  const [draftNumber, setDraftNumber] = useState(draft?.number ?? null);
  const [dirty, setDirty] = useState(false);
  const [paying, setPaying] = useState(false);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [globalPct, setGlobalPct] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, startSaving] = useTransition();
  const [confirming, startConfirming] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";
  const canDiscount = discountBranches.includes(branchId);

  const touch = () => setDirty(true);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Availability belongs to the branch: re-read it for every line when the branch changes.
  const changeBranch = async (id: string) => {
    setBranchId(id); touch();
    if (!lines.length) return;
    setRefreshing(true);
    const fresh = await Promise.all(lines.map((l) => searchSaleProductsAction(l.product.sku, id).then((r) => r.find((p) => p.variantId === l.product.variantId))));
    setLines((ls) => ls.map((l, i) => (fresh[i] ? { ...l, product: fresh[i]! } : l)));
    setRefreshing(false);
  };

  const add = (p: SaleProduct) => {
    touch();
    setLines((ls) => {
      const existing = ls.find((l) => l.product.variantId === p.variantId);
      if (existing) {
        if (p.available !== null && existing.quantity >= p.available) { toast.error(`No hay más unidades de ${p.name} en ${branchName}`); return ls; }
        return ls.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1, product: p } : l));
      }
      return [...ls, { product: p, quantity: 1, discountMode: "percent", discountValue: 0 }];
    });
  };
  const update = (i: number, patch: Partial<SaleLine>) => { touch(); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  const remove = (i: number) => { touch(); setLines((ls) => ls.filter((_, j) => j !== i)); };
  const inCart = (variantId: string) => lines.find((l) => l.product.variantId === variantId)?.quantity ?? 0;
  const applyGlobal = (pct: number) => { touch(); setLines((ls) => ls.map((l) => ({ ...l, discountMode: "percent", discountValue: pct }))); setGlobalOpen(false); setGlobalPct(""); };

  const totals = useMemo(() => lines.reduce((acc, l) => {
    const d = discountOf(l);
    const t = lineTotals(l.quantity, l.product.price, d, l.product.taxRate);
    return { gross: acc.gross + gross(l), discount: acc.discount + d, tax: acc.tax + t.tax, total: acc.total + t.total, units: acc.units + l.quantity };
  }, { gross: 0, discount: 0, tax: 0, total: 0, units: 0 }), [lines]);
  const short = lines.filter((l) => l.product.available !== null && l.quantity > l.product.available);
  const badPercent = lines.some((l) => l.discountMode === "percent" && l.discountValue > 100);
  const blocked = lines.length === 0 || short.length > 0 || badPercent || refreshing;
  const items = lines.map((l) => ({ variantId: l.product.variantId, quantity: l.quantity, discount: discountOf(l) }));

  const saveDraft = () => startSaving(async () => {
    const res = await saveSaleDraftAction({ draftId: draftId ?? undefined, branchId, patientId: customer?.id ?? null, sellerId, notes: notes.trim() || undefined, items });
    if (!res.ok) { toast.error(res.error); return; }
    setDraftId(res.data.id); setDraftNumber(res.data.number); setDirty(false);
    toast.success(`Borrador ${res.data.number} guardado. Lo encuentras en Ventas, con estado Borrador.`);
    if (!draftId) router.replace(`/ventas/nueva?borrador=${res.data.id}`, { scroll: false });
  });

  const discard = () => startSaving(async () => {
    if (!draftId) { setLines([]); setDirty(false); return; }
    const res = await deleteSaleDraftAction(draftId);
    if (!res.ok) { toast.error(res.error); return; }
    setDirty(false);
    toast.success(res.message);
    router.push("/ventas");
  });

  const confirm = (plan: PaymentPlan) => startConfirming(async () => {
    const res = await createSaleAction({
      branchId, patientId: customer?.id ?? null, sellerId, notes: notes.trim() || undefined, draftId: draftId ?? undefined, items,
      payments: plan.payments, dueDate: plan.dueDate, paymentTerms: plan.paymentTerms, idempotencyKey,
    });
    if (!res.ok) { toast.error(res.error); return; } // same key on retry: never two sales
    setDirty(false); setPaying(false); setIdempotencyKey(crypto.randomUUID());
    toast.success("Venta registrada");
    router.push(`/ventas/${res.data.id}?registrada=1`);
  });

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:pb-0">
      <div className="grid min-w-0 gap-6">
        {/* 1. Who and where */}
        <section className="grid gap-4 rounded-2xl border bg-surface p-5 shadow-soft">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sede">
              {branches.length > 1 ? (
                <NativeSelect value={branchId} onChange={(e) => void changeBranch(e.target.value)} disabled={refreshing}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </NativeSelect>
              ) : <Static>{branchName}</Static>}
            </Field>
            <Field label="Asesor">
              {sellers.length > 1 ? (
                <NativeSelect value={sellerId} onChange={(e) => { setSellerId(e.target.value); touch(); }}>
                  {sellers.map((s) => <option key={s.id} value={s.id}>{s.id === me ? `${s.name} (tú)` : s.name}</option>)}
                </NativeSelect>
              ) : <Static>{sellers[0]?.name ?? "Tú"}</Static>}
            </Field>
          </div>
          <Field label="Cliente">
            <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); touch(); }} canCreate={canCreateCustomer} />
          </Field>
        </section>

        {/* 2. Products, quantities and discounts */}
        <section className="grid gap-4 rounded-2xl border bg-surface p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Productos y servicios {lines.length > 0 && <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{lines.length}</span>}</h2>
            <span className="text-xs text-muted-foreground">Existencias de {branchName}</span>
          </div>
          <ProductPicker branchId={branchId} inCart={inCart} onAdd={add} />

          {lines.length === 0 ? (
            <div className="grid place-items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
              <PackageSearch className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">Aún no hay productos en la venta</p>
              <p className="max-w-sm text-xs text-muted-foreground">Búscalos arriba por nombre, SKU o marca, o escanea el código de barras y presiona Enter.</p>
            </div>
          ) : (
            <ul className="divide-y rounded-xl border" aria-label="Productos de la venta">
              {lines.map((l, i) => {
                const d = discountOf(l);
                const t = lineTotals(l.quantity, l.product.price, d, l.product.taxRate);
                const over = l.product.available !== null && l.quantity > l.product.available;
                return (
                  <li key={l.product.variantId} className="grid gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <ProductThumb imageUrl={l.product.image} colorHex={l.product.colorHex} kind={l.product.kind} className="size-11" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{l.product.name}{l.product.detail && <span className="font-normal text-muted-foreground"> · {l.product.detail}</span>}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.product.sku} · <span className={cn(over && "font-medium text-destructive")}>
                            {l.product.available === null ? "por encargo" : over ? `solo hay ${l.product.available} en ${branchName}` : `${l.product.available} disponibles`}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold tabular">{formatMoney(t.total)}</p>
                        {d > 0 && <p className="text-xs text-muted-foreground line-through tabular">{formatMoney(gross(l))}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" className="-mr-1 text-muted-foreground hover:text-destructive" aria-label={`Quitar ${l.product.name}`} onClick={() => remove(i)}><Trash2 /></Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 sm:pl-14">
                      <Labeled label="Cantidad">
                        <div className="flex items-center rounded-lg border" role="group" aria-label={`Cantidad de ${l.product.name}`}>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar una" disabled={l.quantity <= 1} onClick={() => update(i, { quantity: l.quantity - 1 })}><Minus /></Button>
                          <span className="w-8 text-center text-sm tabular" aria-live="polite">{l.quantity}</span>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Agregar una" disabled={l.product.available !== null && l.quantity >= l.product.available}
                            onClick={() => update(i, { quantity: l.quantity + 1 })}><Plus /></Button>
                        </div>
                      </Labeled>
                      <Labeled label="Precio unit."><span className="flex h-8 items-center text-sm tabular">{formatMoney(l.product.price)}</span></Labeled>
                      <Labeled label="Descuento">
                        {canDiscount ? (
                          <DiscountInput mode={l.discountMode} value={l.discountValue} amount={d} label={l.product.name}
                            onChange={(mode, value) => update(i, { discountMode: mode, discountValue: value })} />
                        ) : <span className="flex h-8 items-center text-xs text-muted-foreground">Sin permiso para descuentos</span>}
                      </Labeled>
                      <Labeled label="IVA"><span className="flex h-8 items-center text-sm text-muted-foreground tabular">{l.product.taxRate} %</span></Labeled>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {(lines.length > 0 || showNotes) && (
            <div className="flex flex-wrap items-center gap-2">
              {canDiscount && lines.length > 0 && (globalOpen ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-1.5 pl-3">
                  <span className="text-sm">Descuento a toda la venta</span>
                  <div className="relative w-20">
                    <Input autoFocus aria-label="Porcentaje de descuento para toda la venta" inputMode="numeric" className="h-8 pr-6 text-right tabular" value={globalPct}
                      onChange={(e) => setGlobalPct(String(Math.min(100, digits(e.target.value)) || ""))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyGlobal(digits(globalPct)); } }} />
                    <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  <Button type="button" size="sm" onClick={() => applyGlobal(digits(globalPct))}>Aplicar</Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Cerrar" onClick={() => setGlobalOpen(false)}><X /></Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => setGlobalOpen(true)}><Percent /> Descuento a toda la venta</Button>
              ))}
              {totals.discount > 0 && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => applyGlobal(0)}>Quitar descuentos</Button>}
              {!showNotes && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowNotes(true)}><MessageSquarePlus /> Agregar observaciones</Button>}
            </div>
          )}
          {showNotes && (
            <label className="grid gap-1.5 text-[13px] font-medium text-foreground/80">Observaciones
              <Textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} maxLength={500} placeholder="Ej.: entregar con estuche rígido; el cliente recoge el sábado" />
            </label>
          )}
          {badPercent && <p role="alert" className="text-xs text-destructive">Un descuento no puede superar el 100 %.</p>}
        </section>
      </div>

      {/* 3. Summary */}
      <aside className="lg:sticky lg:top-20">
        <div className="rounded-2xl border bg-surface shadow-soft">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><ShoppingCart className="size-4" /> Resumen</h2>
            {draftNumber && <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{draftNumber}</span>}
          </div>
          <div className="grid gap-4 p-5">
            <div className="flex items-center gap-2 text-sm">
              <UserRound className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{customer?.full_name ?? <span className="text-muted-foreground">Venta de mostrador</span>}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{branchName}</span>
            </div>
            <dl className="grid gap-2 text-sm">
              <Row label={`Subtotal · ${totals.units} ${totals.units === 1 ? "unidad" : "unidades"}`} value={formatMoney(totals.gross)} />
              <Row label={totals.discount > 0 ? `Descuentos (${Math.round((totals.discount / totals.gross) * 100)} %)` : "Descuentos"}
                value={totals.discount ? `− ${formatMoney(totals.discount)}` : formatMoney(0)} accent={totals.discount > 0} />
              <Row label="IVA incluido" value={formatMoney(totals.tax)} muted />
              <div className="mt-1 flex items-baseline justify-between border-t pt-3">
                <dt className="font-medium">Total</dt><dd className="text-2xl font-semibold tabular">{formatMoney(totals.total)}</dd>
              </div>
            </dl>
            {short.length > 0 && (
              <p role="alert" className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />
                Ajusta las cantidades: {short.map((l) => l.product.name).join(", ")} sin unidades suficientes en {branchName}.</p>
            )}
            <div className="grid gap-2">
              <Button size="lg" disabled={blocked || saving} onClick={() => setPaying(true)}><Wallet /> Continuar al pago</Button>
              <Button variant="outline" disabled={saving || (lines.length === 0 && !customer)} onClick={saveDraft}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} {draftId ? "Actualizar borrador" : "Guardar borrador"}
              </Button>
              {(draftId || lines.length > 0) && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={saving} onClick={discard}>{draftId ? "Descartar borrador" : "Vaciar venta"}</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Precios con IVA incluido. Al confirmar, el sistema recalcula los totales y revisa de nuevo las existencias.</p>
          </div>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-surface/95 px-4 py-3 shadow-soft backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{totals.units} {totals.units === 1 ? "unidad" : "unidades"}{totals.discount > 0 && ` · − ${formatMoney(totals.discount)}`}</p>
          <p className="text-lg font-semibold tabular">{formatMoney(totals.total)}</p>
        </div>
        <Button disabled={blocked || saving} onClick={() => setPaying(true)}><Wallet /> Continuar al pago</Button>
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} total={totals.total} itemsCount={lines.length} customerName={customer?.full_name ?? null}
        branchName={branchName} pending={confirming} onConfirm={confirm} />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1"><span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>{children}</div>;
}

/** Discount per line in % or $; shows what it is worth in pesos. */
function DiscountInput({ mode, value, amount, label, onChange }: { mode: DiscountMode; value: number; amount: number; label: string; onChange: (m: DiscountMode, v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex shrink-0 rounded-lg border p-0.5" role="group" aria-label={`Tipo de descuento de ${label}`}>
        {(["percent", "amount"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m, 0)}
            className={cn("h-6 w-6 rounded-md text-xs font-medium", mode === m ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted")}>{m === "percent" ? "%" : "$"}</button>
        ))}
      </div>
      <div className="relative w-32">
        <Input aria-label={`Descuento de ${label}`} inputMode="numeric" className="h-8 text-right text-sm tabular" placeholder="0"
          value={value ? (mode === "amount" ? value.toLocaleString("es-CO") : String(value)) : ""}
          onChange={(e) => onChange(mode, mode === "percent" ? Math.min(100, digits(e.target.value)) : digits(e.target.value))} />
        {mode === "percent" && amount > 0 && <p className="absolute top-full right-0 mt-0.5 text-[11px] whitespace-nowrap text-success tabular">− {formatMoney(amount)}</p>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><span className="text-[13px] font-medium text-foreground/80">{label}</span>{children}</div>;
}

function Static({ children }: { children: React.ReactNode }) {
  return <span className="flex h-9 items-center rounded-lg border bg-muted/40 px-3 text-sm">{children}</span>;
}

function Row({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted && "text-muted-foreground")}>
      <dt className={cn(!muted && "text-muted-foreground")}>{label}</dt><dd className={cn("tabular", accent && "font-medium text-success")}>{value}</dd>
    </div>
  );
}
