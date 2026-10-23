"use client";
import { AlertTriangle, Building2, Loader2, Minus, Package, Plus, Save, ShoppingCart, Trash2, UserRound, Wallet } from "lucide-react";
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

export type SaleLine = { product: SaleProduct; quantity: number; discount: number };
export type DraftData = { id: string; number: string; branchId: string; customer: CustomerHit | null; sellerId: string; notes: string; lines: SaleLine[] };

const money = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

/**
 * "Nueva venta": branch, customer, products and conditions on the left; a summary that stays in view on the right.
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
  const [lines, setLines] = useState<SaleLine[]>(draft?.lines ?? []);
  const [draftId, setDraftId] = useState(draft?.id ?? null);
  const [draftNumber, setDraftNumber] = useState(draft?.number ?? null);
  const [dirty, setDirty] = useState(false);
  const [paying, setPaying] = useState(false);
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
      return [...ls, { product: p, quantity: 1, discount: 0 }];
    });
  };
  const update = (i: number, patch: Partial<SaleLine>) => { touch(); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); };
  const remove = (i: number) => { touch(); setLines((ls) => ls.filter((_, j) => j !== i)); };
  const inCart = (variantId: string) => lines.find((l) => l.product.variantId === variantId)?.quantity ?? 0;

  const totals = useMemo(() => lines.reduce((acc, l) => {
    const t = lineTotals(l.quantity, l.product.price, l.discount, l.product.taxRate);
    return { gross: acc.gross + l.quantity * l.product.price, discount: acc.discount + l.discount, tax: acc.tax + t.tax, total: acc.total + t.total };
  }, { gross: 0, discount: 0, tax: 0, total: 0 }), [lines]);
  const short = lines.filter((l) => l.product.available !== null && l.quantity > l.product.available);
  const badDiscount = lines.some((l) => l.discount > l.quantity * l.product.price);
  const blocked = lines.length === 0 || short.length > 0 || badDiscount || refreshing;
  const items = lines.map((l) => ({ variantId: l.product.variantId, quantity: l.quantity, discount: l.discount }));

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
        <Section icon={Building2} title="Sede y asesor">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-[13px] font-medium text-foreground/80">Sede de la venta
              {branches.length > 1 ? (
                <NativeSelect value={branchId} onChange={(e) => void changeBranch(e.target.value)} disabled={refreshing}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </NativeSelect>
              ) : <span className="flex h-9 items-center rounded-lg border bg-muted/40 px-3 text-sm font-normal text-foreground">{branchName}</span>}
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium text-foreground/80">Asesor responsable
              {sellers.length > 1 ? (
                <NativeSelect value={sellerId} onChange={(e) => { setSellerId(e.target.value); touch(); }}>
                  {sellers.map((s) => <option key={s.id} value={s.id}>{s.id === me ? `${s.name} (tú)` : s.name}</option>)}
                </NativeSelect>
              ) : <span className="flex h-9 items-center rounded-lg border bg-muted/40 px-3 text-sm font-normal text-foreground">{sellers[0]?.name ?? "Tú"}</span>}
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Las existencias que ves son las de {branchName}. Al confirmar, las unidades salen de esa sede.</p>
        </Section>

        <Section icon={UserRound} title="Cliente">
          <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); touch(); }} canCreate={canCreateCustomer} />
        </Section>

        <Section icon={Package} title="Productos y servicios">
          <ProductPicker branchId={branchId} inCart={inCart} onAdd={add} />
          {lines.length > 0 && (
            <ul className="divide-y rounded-xl border" aria-label="Productos de la venta">
              {lines.map((l, i) => {
                const t = lineTotals(l.quantity, l.product.price, l.discount, l.product.taxRate);
                const over = l.product.available !== null && l.quantity > l.product.available;
                return (
                  <li key={l.product.variantId} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumb imageUrl={l.product.image} colorHex={l.product.colorHex} kind={l.product.kind} className="size-10" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.product.name}{l.product.detail && <span className="font-normal text-muted-foreground"> · {l.product.detail}</span>}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {l.product.sku} · {formatMoney(l.product.price)} c/u · IVA {l.product.taxRate} %
                          {l.product.available !== null && <> · {l.product.available} en {branchName}</>}
                        </p>
                        {over && <p className="mt-0.5 text-xs font-medium text-destructive">Solo hay {l.product.available} en {branchName}.</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                      <div className="flex items-center rounded-lg border" role="group" aria-label={`Cantidad de ${l.product.name}`}>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Quitar una" disabled={l.quantity <= 1} onClick={() => update(i, { quantity: l.quantity - 1 })}><Minus /></Button>
                        <span className="w-8 text-center text-sm tabular" aria-live="polite">{l.quantity}</span>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Agregar una" disabled={l.product.available !== null && l.quantity >= l.product.available}
                          onClick={() => update(i, { quantity: l.quantity + 1 })}><Plus /></Button>
                      </div>
                      {canDiscount && (
                        <div className="relative w-28">
                          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">Desc. $</span>
                          <Input aria-label={`Descuento de ${l.product.name}`} inputMode="numeric" className={cn("h-8 pl-12 text-right text-sm tabular", l.discount > l.quantity * l.product.price && "border-destructive")}
                            value={l.discount ? l.discount.toLocaleString("es-CO") : ""} placeholder="0" onChange={(e) => update(i, { discount: money(e.target.value) })} />
                        </div>
                      )}
                      <span className="w-28 text-right text-sm font-semibold tabular">{formatMoney(t.total)}</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar ${l.product.name}`} onClick={() => remove(i)}><Trash2 /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {badDiscount && <p role="alert" className="text-xs text-destructive">Un descuento supera el valor de su línea.</p>}
        </Section>

        <Section icon={Wallet} title="Condiciones">
          <label className="grid gap-1.5 text-[13px] font-medium text-foreground/80">Observaciones <span className="sr-only">opcional</span>
            <Textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} maxLength={500}
              placeholder="Ej.: entregar con estuche rígido; el cliente recoge el sábado" />
          </label>
          <p className="text-xs text-muted-foreground">El pago, el abono o el saldo con fecha límite se definen en el siguiente paso.</p>
        </Section>
      </div>

      <aside className="lg:sticky lg:top-20">
        <div className="rounded-2xl border bg-surface p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><ShoppingCart className="size-4" /> Resumen de la venta</h2>
            {draftNumber && <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{draftNumber}</span>}
          </div>
          <dl className="grid gap-2 text-sm">
            <Row label={`Subtotal (${lines.reduce((a, l) => a + l.quantity, 0)} ${lines.reduce((a, l) => a + l.quantity, 0) === 1 ? "unidad" : "unidades"})`} value={formatMoney(totals.gross)} />
            <Row label="Descuentos" value={totals.discount ? `− ${formatMoney(totals.discount)}` : formatMoney(0)} />
            <Row label="IVA incluido" value={formatMoney(totals.tax)} muted />
            <div className="mt-1 flex items-baseline justify-between border-t pt-3">
              <dt className="font-medium">Total</dt><dd className="text-2xl font-semibold tabular">{formatMoney(totals.total)}</dd>
            </div>
          </dl>
          {short.length > 0 && (
            <p role="alert" className="mt-3 flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0" />
              Ajusta las cantidades: {short.map((l) => l.product.name).join(", ")} sin unidades suficientes en {branchName}.</p>
          )}
          <div className="mt-4 grid gap-2">
            <Button size="lg" disabled={blocked || saving} onClick={() => setPaying(true)}><Wallet /> Continuar al pago</Button>
            <Button variant="outline" disabled={saving || (lines.length === 0 && !customer)} onClick={saveDraft}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} {draftId ? "Actualizar borrador" : "Guardar borrador"}
            </Button>
            {(draftId || lines.length > 0) && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={saving} onClick={discard}>
                {draftId ? "Descartar borrador" : "Vaciar venta"}
              </Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Precios con IVA incluido, tomados del catálogo. Al confirmar, el sistema recalcula los totales y vuelve a revisar las existencias.</p>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-surface/95 px-4 py-3 shadow-soft backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{lines.length} {lines.length === 1 ? "producto" : "productos"}</p>
          <p className="text-lg font-semibold tabular">{formatMoney(totals.total)}</p>
        </div>
        <Button disabled={blocked || saving} onClick={() => setPaying(true)}><Wallet /> Continuar al pago</Button>
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} total={totals.total} itemsCount={lines.length} customerName={customer?.full_name ?? null}
        branchName={branchName} pending={confirming} onConfirm={confirm} />
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Package; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-2xl border bg-surface p-5 shadow-soft">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" />{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div className={cn("flex justify-between gap-3", muted && "text-muted-foreground")}><dt className={cn(!muted && "text-muted-foreground")}>{label}</dt><dd className="tabular">{value}</dd></div>;
}
