"use client";
import {
  AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronDown, FileText, Glasses, Loader2, Minus, PackageSearch, Percent, Plus, Save, Trash2,
  UserRound, Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProductThumb } from "@/modules/inventory/components/stock";
import { LAB_STATUS, type LabStatus } from "@/modules/labs/constants";
import {
  createSaleAction, deleteSaleDraftAction, openLabOrdersAction, saveSaleDraftAction, searchSaleProductsAction,
  type CustomerHit, type OpenLabOrder, type SaleProduct,
} from "../actions";
import { lineTotals } from "../constants";
import { CustomerPicker, NewCustomerDialog } from "./customer-picker";
import { PaymentDialog, type PaymentPlan } from "./payment-dialog";
import { ProductPicker } from "./product-picker";

/**
 * A discount is typed as a percentage, a peso amount, or by writing the unit price the customer pays ("price").
 * The catalog price stays as the list price; the server always receives the peso discount per line.
 */
type DiscountMode = "percent" | "amount" | "price";
export type SaleLine = { product: SaleProduct; quantity: number; discountMode: DiscountMode; discountValue: number };
export type DraftData = { id: string; number: string; branchId: string; customer: CustomerHit | null; sellerId: string; notes: string;
  lines: { product: SaleProduct; quantity: number; discount: number }[] };
type Branch = { id: string; name: string; address: string | null };
type Seller = { id: string; name: string; role: string | null };

const digits = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const gross = (l: SaleLine) => l.quantity * l.product.price;
const discountOf = (l: SaleLine) => Math.max(0, Math.min(gross(l),
  l.discountMode === "percent" ? Math.round((gross(l) * l.discountValue) / 100)
  : l.discountMode === "price" ? (l.product.price - l.discountValue) * l.quantity
  : l.discountValue));
const pct = (n: number) => `${n.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;

/**
 * "Nueva venta": 1 datos (sede, asesor, fecha), 2 cliente, 3 productos; on the right a summary that stays in view and the
 * additional conditions. Totals here preview the database math; the server recalculates everything from the catalog.
 */
export function NewSale({ branches, initialBranchId, sellers, me, today, discountBranches, canCreateCustomer, canLabOrders, initialCustomer, draft }: {
  branches: Branch[]; initialBranchId: string; sellers: Seller[]; me: string; today: string; discountBranches: string[];
  canCreateCustomer: boolean; canLabOrders: boolean; initialCustomer: CustomerHit | null; draft: DraftData | null;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(draft?.branchId ?? initialBranchId);
  const [customer, setCustomer] = useState<CustomerHit | null>(draft?.customer ?? initialCustomer);
  const [sellerId, setSellerId] = useState(draft?.sellerId ?? me);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [lines, setLines] = useState<SaleLine[]>(() => (draft?.lines ?? []).map((l) => ({ product: l.product, quantity: l.quantity, discountMode: "amount", discountValue: l.discount })));
  const [labOrder, setLabOrder] = useState<OpenLabOrder | null>(null);
  const [draftId, setDraftId] = useState(draft?.id ?? null);
  const [draftNumber, setDraftNumber] = useState(draft?.number ?? null);
  const [dirty, setDirty] = useState(false);
  const [paying, setPaying] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [editing, setEditing] = useState<"discount" | "notes" | "order" | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, startSaving] = useTransition();
  const [confirming, startConfirming] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const branch = branches.find((b) => b.id === branchId);
  const seller = sellers.find((s) => s.id === sellerId);
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
  const changeCustomer = (c: CustomerHit | null) => { setCustomer(c); setLabOrder(null); touch(); };

  const add = (p: SaleProduct) => {
    touch();
    setLines((ls) => {
      const existing = ls.find((l) => l.product.variantId === p.variantId);
      if (existing) {
        if (p.available !== null && existing.quantity >= p.available) { toast.error(`No hay más unidades de ${p.name} en ${branch?.name}`); return ls; }
        return ls.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1, product: p } : l));
      }
      return [...ls, { product: p, quantity: 1, discountMode: "percent", discountValue: 0 }];
    });
  };
  const update = (i: number, patch: Partial<SaleLine>) => { touch(); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  const remove = (i: number) => { touch(); setLines((ls) => ls.filter((_, j) => j !== i)); };
  const inCart = (variantId: string) => lines.find((l) => l.product.variantId === variantId)?.quantity ?? 0;
  // "Descuento general": the same % on every line, so the discount is always visible line by line.
  const applyGlobal = (p: number) => { touch(); setLines((ls) => ls.map((l) => ({ ...l, discountMode: "percent", discountValue: p }))); setEditing(null); };

  const totals = useMemo(() => lines.reduce((acc, l) => {
    const d = discountOf(l);
    const t = lineTotals(l.quantity, l.product.price, d, l.product.taxRate);
    return { gross: acc.gross + gross(l), discount: acc.discount + d, tax: acc.tax + t.tax, total: acc.total + t.total, units: acc.units + l.quantity };
  }, { gross: 0, discount: 0, tax: 0, total: 0, units: 0 }), [lines]);
  const uniformPct = lines.length > 0 && lines.every((l) => l.discountMode === "percent" && l.discountValue === lines[0]!.discountValue) ? lines[0]!.discountValue : null;
  const short = lines.filter((l) => l.product.available !== null && l.quantity > l.product.available);
  const blocked = lines.length === 0 || short.length > 0 || refreshing;
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
    setDirty(false); toast.success(res.message); router.push("/ventas");
  });
  const confirm = (plan: PaymentPlan) => startConfirming(async () => {
    const res = await createSaleAction({
      branchId, patientId: customer?.id ?? null, sellerId, notes: notes.trim() || undefined, draftId: draftId ?? undefined, labOrderId: labOrder?.id,
      items, payments: plan.payments, dueDate: plan.dueDate, paymentTerms: plan.paymentTerms, idempotencyKey,
    });
    if (!res.ok) { toast.error(res.error); return; } // same key on retry: never two sales
    setDirty(false); setPaying(false); setIdempotencyKey(crypto.randomUUID());
    toast.success("Venta registrada");
    router.push(`/ventas/${res.data.id}?registrada=1`);
  });

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:pb-0">
      <div className="grid min-w-0 gap-5">
        <Step n={1} title="Datos de la venta" subtitle="Selecciona la sede, el asesor y el cliente.">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Sede" required>
              <RichSelect icon={Building2} title={branch?.name ?? ""} subtitle={branch?.address} label="Sede" value={branchId} disabled={refreshing || branches.length < 2}
                options={branches.map((b) => ({ value: b.id, label: b.name }))} onChange={(v) => void changeBranch(v)} />
            </Field>
            <Field label="Asesor" required>
              <RichSelect icon={UserRound} title={seller ? `${seller.name}${seller.id === me ? " (tú)" : ""}` : ""} subtitle={seller?.role} label="Asesor" value={sellerId}
                disabled={sellers.length < 2} options={sellers.map((s) => ({ value: s.id, label: s.id === me ? `${s.name} (tú)` : s.name }))}
                onChange={(v) => { setSellerId(v); touch(); }} />
            </Field>
            <Field label="Fecha de venta">
              <div className="flex h-14 items-center gap-3 rounded-xl border bg-muted/30 px-3">
                <CalendarDays className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0"><span className="block text-sm font-medium">{today}</span><span className="block text-xs text-muted-foreground">Se registra al confirmar</span></span>
              </div>
            </Field>
          </div>
        </Step>

        <Step n={2} title="Cliente" subtitle="Busca un cliente existente o regístralo si es necesario."
          action={canCreateCustomer && <Button variant="outline" size="sm" onClick={() => setCreatingCustomer(true)}><Plus /> Nuevo cliente</Button>}>
          <CustomerPicker value={customer} onChange={changeCustomer} />
          {canCreateCustomer && <NewCustomerDialog open={creatingCustomer} onOpenChange={setCreatingCustomer} initial="" onCreated={(c) => { changeCustomer(c); setCreatingCustomer(false); }} />}
        </Step>

        <Step n={3} title="Productos y servicios" subtitle="Busca y agrega los productos del inventario o servicios comercializables."
          action={<span className="rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">Existencias de {branch?.name}</span>}>
          <ProductPicker branchId={branchId} inCart={inCart} onAdd={add} />
          {lines.length === 0 ? (
            <div className="grid place-items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
              <PackageSearch className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium">Aún no hay productos en la venta</p>
              <p className="max-w-sm text-xs text-muted-foreground">Búscalos por nombre, SKU o marca, o escanea el código de barras y presiona Enter.</p>
            </div>
          ) : (
            <div className="@container overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[minmax(0,1fr)_116px_96px_128px_100px_28px] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground @2xl:grid">
                <span>Producto</span><span>Precio unitario</span><span className="text-center">Cantidad</span><span>Descuento</span><span className="text-right">Subtotal</span><span />
              </div>
              <ul className="divide-y" aria-label="Productos de la venta">
                {lines.map((l, i) => {
                  const d = discountOf(l);
                  const t = lineTotals(l.quantity, l.product.price, d, l.product.taxRate);
                  const over = l.product.available !== null && l.quantity > l.product.available;
                  return (
                    <li key={l.product.variantId} className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 @2xl:gap-x-2 @2xl:grid-cols-[minmax(0,1fr)_116px_96px_128px_100px_28px] @2xl:items-center">
                      <div className="col-span-2 flex min-w-0 items-center gap-3 @2xl:col-span-1">
                        <ProductThumb imageUrl={l.product.image} colorHex={l.product.colorHex} kind={l.product.kind} className="size-11" />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm leading-snug font-medium" title={l.product.name}>{l.product.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{[l.product.sku, l.product.detail].filter(Boolean).join(" · ")}</p>
                          <StockPill available={l.product.available} over={over} />
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive @2xl:hidden" aria-label={`Quitar ${l.product.name}`} onClick={() => remove(i)}><Trash2 /></Button>
                      </div>
                      <Cell label="Precio unitario">
                        {canDiscount ? (
                          <UnitPriceInput list={l.product.price} unit={l.product.price - d / l.quantity} label={l.product.name}
                            onChange={(price) => update(i, price === null ? { discountMode: "percent", discountValue: 0 } : { discountMode: "price", discountValue: price })} />
                        ) : <span className="text-sm tabular">{formatMoney(l.product.price)}</span>}
                      </Cell>
                      <Cell label="Cantidad" className="@2xl:justify-self-center">
                        <div className="flex w-fit items-center rounded-lg border" role="group" aria-label={`Cantidad de ${l.product.name}`}>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar una" disabled={l.quantity <= 1} onClick={() => update(i, { quantity: l.quantity - 1 })}><Minus /></Button>
                          <span className="w-8 text-center text-sm tabular" aria-live="polite">{l.quantity}</span>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Agregar una" disabled={l.product.available !== null && l.quantity >= l.product.available}
                            onClick={() => update(i, { quantity: l.quantity + 1 })}><Plus /></Button>
                        </div>
                      </Cell>
                      <Cell label="Descuento">
                        {canDiscount ? (
                          <DiscountInput mode={l.discountMode} value={l.discountValue} amount={d} gross={gross(l)} label={l.product.name}
                            onChange={(mode, value) => update(i, { discountMode: mode, discountValue: value })} />
                        ) : <span className="text-xs text-muted-foreground">Sin permiso</span>}
                      </Cell>
                      <Cell label="Subtotal" className="@2xl:text-right">
                        <span className="text-sm font-semibold tabular">{formatMoney(t.total)}</span>
                        {d > 0 && <span className="block text-xs text-muted-foreground line-through tabular">{formatMoney(gross(l))}</span>}
                      </Cell>
                      <Button type="button" variant="ghost" size="icon-sm" className="hidden text-muted-foreground hover:text-destructive @2xl:inline-flex" aria-label={`Quitar ${l.product.name}`} onClick={() => remove(i)}><Trash2 /></Button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" onClick={() => document.getElementById("sale-product-search")?.focus()}
                className="flex w-full items-center justify-center gap-2 border-t py-2.5 text-sm font-medium text-brand hover:bg-muted/50">
                <Plus className="size-4" /> Agregar otro producto o servicio
              </button>
            </div>
          )}
        </Step>
      </div>

      <aside className="grid gap-5 xl:sticky xl:top-20">
        <section className="rounded-2xl border bg-surface shadow-soft">
          <header className="flex items-center justify-between gap-2 px-5 pt-5">
            <h2 className="text-base font-semibold">Resumen de la venta</h2>
            {draftNumber && <StatusBadge tone="warning" dot={false}>Borrador · {draftNumber}</StatusBadge>}
          </header>
          <dl className="grid gap-2 px-5 py-4 text-sm">
            <Info icon={UserRound} label="Cliente" value={customer?.full_name ?? "Venta de mostrador"} muted={!customer} />
            <Info icon={Building2} label="Sede" value={branch?.name ?? ""} />
            <Info icon={UserRound} label="Asesor" value={seller ? `${seller.name}${seller.id === me ? " (tú)" : ""}` : ""} />
            <Info icon={CalendarDays} label="Fecha" value={today} />
          </dl>
          <details className="group border-t px-5 py-3" open={lines.length > 0 && lines.length <= 4}>
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
              <span>Productos ({lines.length})</span>
              <span className="flex items-center gap-1.5 tabular">{formatMoney(totals.gross)}<ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></span>
            </summary>
            <ul className="mt-3 grid gap-3">
              {lines.map((l) => (
                <li key={l.product.variantId} className="flex items-center gap-3 text-sm">
                  <ProductThumb imageUrl={l.product.image} colorHex={l.product.colorHex} kind={l.product.kind} className="size-9" />
                  <span className="min-w-0 flex-1"><span className="block truncate">{l.product.name}</span><span className="text-xs text-muted-foreground tabular">{l.quantity} × {formatMoney(l.product.price)}</span></span>
                  <span className="tabular">{formatMoney(gross(l))}</span>
                </li>
              ))}
              {lines.length === 0 && <li className="text-xs text-muted-foreground">Agrega productos para verlos aquí.</li>}
            </ul>
          </details>
          <dl className="grid gap-2 border-t px-5 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal (precios de lista)</dt><dd className="tabular">{formatMoney(totals.gross)}</dd></div>
            <div className={cn("flex justify-between", totals.discount > 0 ? "text-success" : "text-muted-foreground")}>
              <dt>Descuento{totals.discount > 0 && ` (−${pct((totals.discount / totals.gross) * 100)})`}</dt><dd className="tabular">{totals.discount ? `− ${formatMoney(totals.discount)}` : formatMoney(0)}</dd>
            </div>
          </dl>
          <div className="mx-5 flex items-baseline justify-between rounded-xl bg-muted/50 px-4 py-3">
            <span className="text-sm font-semibold">Total a cobrar</span><span className="text-2xl font-semibold tabular">{formatMoney(totals.total)}</span>
          </div>
          <p className="px-5 pt-1.5 text-right text-xs text-muted-foreground tabular">Incluye IVA por {formatMoney(totals.tax)}</p>
          {short.length > 0 && (
            <p role="alert" className="mx-5 mt-3 flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />
              Ajusta las cantidades: {short.map((l) => l.product.name).join(", ")} sin unidades suficientes en {branch?.name}.</p>
          )}
          <div className="grid gap-2 p-5">
            <Button size="lg" disabled={blocked || saving} onClick={() => setPaying(true)}>Continuar al pago <ArrowRight /></Button>
            <Button variant="outline" disabled={saving || (lines.length === 0 && !customer)} onClick={saveDraft}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} {draftId ? "Actualizar borrador" : "Guardar borrador"}
            </Button>
            {(draftId || lines.length > 0) && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={saving} onClick={discard}>{draftId ? "Descartar borrador" : "Vaciar venta"}</Button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-surface shadow-soft">
          <h2 className="px-5 pt-5 pb-2 text-sm font-semibold">Condiciones adicionales</h2>
          <ul className="divide-y px-5 pb-2 text-sm">
            {canDiscount && (
              <Condition icon={Percent} label="Descuento general" value={uniformPct ? `${pct(uniformPct)} aplicado` : totals.discount > 0 ? "Por producto" : "Ninguno"}
                action={uniformPct ? "Editar" : "Agregar"} onAction={() => setEditing(editing === "discount" ? null : "discount")} disabled={!lines.length}>
                {editing === "discount" && <GlobalDiscount initial={uniformPct ?? 0} onApply={applyGlobal} />}
              </Condition>
            )}
            <Condition icon={Wallet} label="Condiciones de pago" value="Se eligen al pagar" />
            <Condition icon={FileText} label="Observaciones" value={notes.trim() ? "1 observación" : "Sin observaciones"}
              action={notes.trim() ? "Editar" : "Agregar"} onAction={() => setEditing(editing === "notes" ? null : "notes")}>
              {editing === "notes" && (
                <Textarea autoFocus rows={3} className="mt-2" value={notes} maxLength={500} onChange={(e) => { setNotes(e.target.value); touch(); }}
                  placeholder="Ej.: entregar con estuche rígido; el cliente recoge el sábado" />
              )}
            </Condition>
            {canLabOrders && (
              <Condition icon={Glasses} label="Orden óptica" value={labOrder ? labOrder.number : customer ? "Sin vincular" : "Elige el cliente"}
                action={labOrder ? "Quitar" : "Vincular"} disabled={!customer}
                onAction={() => (labOrder ? setLabOrder(null) : setEditing("order"))} />
            )}
          </ul>
        </section>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-surface/95 px-4 py-3 shadow-soft backdrop-blur xl:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{totals.units} {totals.units === 1 ? "unidad" : "unidades"}{totals.discount > 0 && ` · − ${formatMoney(totals.discount)}`}</p>
          <p className="text-lg font-semibold tabular">{formatMoney(totals.total)}</p>
        </div>
        <Button disabled={blocked || saving} onClick={() => setPaying(true)}>Continuar al pago <ArrowRight /></Button>
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} total={totals.total} itemsCount={lines.length} customerName={customer?.full_name ?? null}
        branchName={branch?.name ?? ""} pending={confirming} onConfirm={confirm} />
      {customer && <LinkOrderDialog open={editing === "order"} onOpenChange={(o) => setEditing(o ? "order" : null)} customer={customer}
        onPick={(o) => { setLabOrder(o); setEditing(null); touch(); }} />}
    </div>
  );
}

function Step({ n, title, subtitle, action, children }: { n: number; title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-2xl border bg-surface p-5 shadow-soft">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white">{n}</span>
          <div><h2 className="font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><span className="text-[13px] font-medium text-foreground/80">{label}{required && <span className="text-destructive"> *</span>}</span>{children}</div>;
}

/** Two-line select (title + subtitle) over a native select, so keyboard and screen readers work as usual. */
function RichSelect({ icon: Icon, title, subtitle, label, value, options, onChange, disabled }: {
  icon: typeof Building2; title: string; subtitle?: string | null; label: string; value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className={cn("relative flex h-14 items-center gap-3 rounded-xl border bg-surface px-3", !disabled && "focus-within:ring-3 focus-within:ring-ring/40 hover:bg-muted/40")}>
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}</span>
      {!disabled && <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
      {!disabled && (
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}

function Cell({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={cn("grid content-start gap-1", className)}><span className="text-[11px] font-medium text-muted-foreground @2xl:hidden">{label}</span><div>{children}</div></div>;
}

function StockPill({ available, over }: { available: number | null; over: boolean }) {
  if (available === null) return <span className="mt-1 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-brand">Por encargo</span>;
  return (
    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", over ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
      <span className="size-1.5 rounded-full bg-current" />{over ? `Solo ${available} disponibles` : `${available} disponibles`}
    </span>
  );
}

function Info({ icon: Icon, label, value, muted }: { icon: typeof Building2; label: string; value: string; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[20px_72px_minmax(0,1fr)] items-center gap-2">
      <Icon className="size-4 text-muted-foreground" /><dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium", muted && "font-normal text-muted-foreground")}>{value}</dd>
    </div>
  );
}

function Condition({ icon: Icon, label, value, action, onAction, disabled, children }: {
  icon: typeof Building2; label: string; value: string; action?: string; onAction?: () => void; disabled?: boolean; children?: React.ReactNode;
}) {
  return (
    <li className="py-2.5">
      <div className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-2">
        <Icon className="size-4 text-muted-foreground" /><span>{label}</span>
        <span className="truncate text-xs text-muted-foreground">{value}</span>
        {action ? <button type="button" disabled={disabled} onClick={onAction} className="text-xs font-medium text-brand hover:underline disabled:text-muted-foreground disabled:no-underline">{action}</button> : <span />}
      </div>
      {children}
    </li>
  );
}

function GlobalDiscount({ initial, onApply }: { initial: number; onApply: (p: number) => void }) {
  const [v, setV] = useState(initial ? String(initial) : "");
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="relative w-24">
        <Input autoFocus aria-label="Porcentaje de descuento para toda la venta" inputMode="numeric" className="h-8 pr-6 text-right tabular" value={v}
          onChange={(e) => setV(String(Math.min(100, digits(e.target.value)) || ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onApply(digits(v)); } }} />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
      <Button type="button" size="sm" onClick={() => onApply(digits(v))}>Aplicar a todo</Button>
      {initial > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onApply(0)}>Quitar</Button>}
    </div>
  );
}

/** Open optical orders of this customer without a sale; the chosen one is linked when the sale is confirmed. */
function LinkOrderDialog({ open, onOpenChange, customer, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; customer: CustomerHit; onPick: (o: OpenLabOrder) => void }) {
  const [orders, setOrders] = useState<OpenLabOrder[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void openLabOrdersAction(customer.id).then((r) => { if (alive) setOrders(r); });
    return () => { alive = false; };
  }, [open, customer.id]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setOrders(null); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular orden óptica</DialogTitle>
          <DialogDescription>Órdenes abiertas de {customer.full_name} que todavía no tienen venta. Si la venta lleva lentes nuevos, crea la orden después de confirmar.</DialogDescription>
        </DialogHeader>
        {orders === null ? <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /> : orders.length === 0 ? (
          <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">Este cliente no tiene órdenes abiertas sin venta.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {orders.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => onPick(o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted">
                  <Glasses className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1"><span className="block font-mono text-xs font-medium">{o.number}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[o.frame_description, o.lens_description].filter(Boolean).join(" · ") || "Sin descripción"}</span></span>
                  <StatusBadge tone={LAB_STATUS[o.status as LabStatus]?.tone}>{LAB_STATUS[o.status as LabStatus]?.label ?? o.status}</StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Unit price the customer pays. Starts at the list (catalog) price; writing a lower one turns the difference into the
 * line's discount. It can't go above the list price (that would be a surcharge, which sales don't support).
 */
function UnitPriceInput({ list, unit, label, onChange }: { list: number; unit: number; label: string; onChange: (price: number | null) => void }) {
  const [text, setText] = useState<string | null>(null); // what's being typed; null = show the computed price
  const typed = text === null ? null : digits(text);
  const tooHigh = typed !== null && typed > list;
  return (
    <div className="relative w-full max-w-32 pb-4">
      <span className="pointer-events-none absolute top-4 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input aria-label={`Precio por unidad de ${label}`} inputMode="numeric" className={cn("h-8 pl-6 text-right text-sm tabular", tooHigh && "border-destructive")}
        value={text ?? Math.round(unit).toLocaleString("es-CO")}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const n = digits(v);
          if (v.trim() === "") onChange(null);
          else if (n <= list) onChange(n);
        }}
        onBlur={() => setText(null)} />
      <p className={cn("absolute right-0 bottom-0 text-[11px] whitespace-nowrap tabular", tooHigh ? "text-destructive" : "text-muted-foreground")}>
        {tooHigh ? `Máximo ${formatMoney(list)}` : Math.round(unit) < list ? <>Lista <span className="line-through">{formatMoney(list)}</span></> : "Precio de lista"}
      </p>
    </div>
  );
}

/** Discount per line in % or $ (a price typed in "Precio unitario" shows here as its $ equivalent). */
function DiscountInput({ mode, value, amount, gross: lineGross, label, onChange }: {
  mode: DiscountMode; value: number; amount: number; gross: number; label: string; onChange: (m: DiscountMode, v: number) => void;
}) {
  const shownMode = mode === "price" ? "amount" : mode;
  const shownValue = mode === "price" ? amount : value;
  // Switching % ⇄ $ keeps the same discount instead of wiping it.
  const switchTo = (m: "percent" | "amount") => {
    if (m === shownMode) return;
    onChange(m, m === "amount" ? amount : lineGross ? (amount / lineGross) * 100 : 0); // exact %, shown rounded
  };
  return (
    <div className="relative flex items-center gap-1.5 pb-4">
      <div className="relative w-16">
        <Input aria-label={`Descuento de ${label}`} inputMode="numeric" className="h-8 pr-2 text-right text-sm tabular" placeholder="0"
          value={shownValue ? (shownMode === "amount" ? shownValue.toLocaleString("es-CO") : shownValue.toLocaleString("es-CO", { maximumFractionDigits: 1 })) : ""}
          onChange={(e) => onChange(shownMode, shownMode === "percent" ? Math.min(100, digits(e.target.value)) : digits(e.target.value))} />
      </div>
      <div className="flex shrink-0 rounded-lg border p-0.5" role="group" aria-label={`Tipo de descuento de ${label}`}>
        {(["percent", "amount"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={shownMode === m} onClick={() => switchTo(m)}
            className={cn("h-6 w-6 rounded-md text-xs font-medium", shownMode === m ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted")}>{m === "percent" ? "%" : "$"}</button>
        ))}
      </div>
      {amount > 0 && (
        <p className="absolute bottom-0 left-0 text-[11px] whitespace-nowrap text-success tabular">
          {shownMode === "percent" ? `− ${formatMoney(amount)}` : pct((amount / lineGross) * 100)}
        </p>
      )}
    </div>
  );
}
