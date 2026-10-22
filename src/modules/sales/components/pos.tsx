"use client";
import { Barcode, FileText, Loader2, Minus, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatDiopter } from "@/modules/clinical/constants";
import { searchPatientsAction } from "@/modules/patients/actions";
import { createQuoteAction, createSaleAction, latestPrescriptionAction } from "../actions";
import { lineTotals, PAYMENT_METHODS, type PaymentMethod } from "../constants";
import type { PosProduct } from "../repositories";

interface Line { product: PosProduct; quantity: number; discount: number }
type Rx = Awaited<ReturnType<typeof latestPrescriptionAction>>;
type PatientHit = Awaited<ReturnType<typeof searchPatientsAction>>[number];

const CATEGORY_ORDER = ["frames", "ophthalmic_lenses", "sunglasses", "contact_lenses", "solutions", "accessories", "services", "other"];

export function Pos({ mode, catalog, canDiscount, initialPatient, initialVariantId }: {
  mode: "sale" | "quote"; catalog: PosProduct[]; canDiscount: boolean; initialPatient?: { id: string; name: string } | null; initialVariantId?: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() => {
    const p = initialVariantId ? catalog.find((c) => c.variantId === initialVariantId) : undefined;
    return p ? [{ product: p, quantity: 1, discount: 0 }] : [];
  });
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(initialPatient ?? null);
  const [rx, setRx] = useState<Rx>(null);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientHits, setPatientHits] = useState<PatientHit[]>([]);
  const [payments, setPayments] = useState<{ method: PaymentMethod; amount: string }[]>([{ method: "cash", amount: "" }]);
  const [pending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    if (!patient) return;
    let alive = true;
    void latestPrescriptionAction(patient.id).then((r) => { if (alive) setRx(r); });
    return () => { alive = false; };
  }, [patient]);
  useEffect(() => {
    if (patientQuery.trim().length < 2) return;
    const t = setTimeout(() => { void searchPatientsAction(patientQuery).then(setPatientHits); }, 200);
    return () => clearTimeout(t);
  }, [patientQuery]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of catalog) seen.set(p.categoryCode, p.category);
    return [...seen.entries()].sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [catalog]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((p) => (!category || p.categoryCode === category) &&
      (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode === q || (p.color ?? "").toLowerCase().includes(q))).slice(0, 60);
  }, [catalog, query, category]);

  const add = (p: PosProduct) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.product.variantId === p.variantId);
      const inCart = existing?.quantity ?? 0;
      if (mode === "sale" && p.stocked && (p.stock ?? 0) <= inCart) { toast.error(`Sin stock de ${p.name} en esta sede`); return ls; }
      return existing ? ls.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { product: p, quantity: 1, discount: 0 }];
    });
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = query.trim();
    const exact = catalog.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase()) ?? (visible.length === 1 ? visible[0] : undefined);
    if (exact) { add(exact); setQuery(""); }
  };

  const totals = useMemo(() => lines.reduce((acc, l) => {
    const t = lineTotals(l.quantity, l.product.price, l.discount, l.product.taxRate);
    return { gross: acc.gross + l.quantity * l.product.price, discount: acc.discount + l.discount, tax: acc.tax + t.tax, total: acc.total + t.total };
  }, { gross: 0, discount: 0, tax: 0, total: 0 }), [lines]);

  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const cash = payments.filter((p) => p.method === "cash").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const change = Math.max(0, paid - totals.total);
  const balance = Math.max(0, totals.total - paid);

  const reset = () => { setLines([]); setPayments([{ method: "cash", amount: "" }]); setIdempotencyKey(crypto.randomUUID()); };

  const submit = () => startTransition(async () => {
    const items = lines.map((l) => ({ variantId: l.product.variantId, quantity: l.quantity, discount: l.discount }));
    if (mode === "quote") {
      if (!patient) { toast.error("Selecciona el paciente para la cotización"); return; }
      const res = await createQuoteAction({ patientId: patient.id, prescriptionId: rx?.id ?? null, items });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(res.message);
      router.push(`/cotizaciones/${res.data.id}`);
      return;
    }
    // Cash change is returned to the patient; only the amount due is recorded.
    let excess = change;
    const pays = payments.filter((p) => Number(p.amount) > 0).map((p) => {
      let amount = Number(p.amount);
      if (p.method === "cash" && excess > 0) { const cut = Math.min(excess, amount); amount -= cut; excess -= cut; }
      return { method: p.method, amount };
    }).filter((p) => p.amount > 0);
    if (excess > 0) { toast.error("El pago con medios distintos a efectivo no puede superar el total"); return; }
    const res = await createSaleAction({ patientId: patient?.id ?? null, prescriptionId: rx?.id ?? null, items, payments: pays, idempotencyKey });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(change > 0 ? `Venta registrada · Cambio ${formatMoney(change)}` : res.message);
    reset();
    router.push(`/ventas/${res.data.id}`);
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      {/* Catalog */}
      <section className="grid content-start gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
            placeholder="Escanea el código de barras o busca por nombre, SKU o color…" className="h-11 pl-9 text-base" aria-label="Buscar producto" />
          <Barcode className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCategory(null)} className={cn("rounded-full border px-3 py-1 text-xs", !category ? "border-foreground/20 bg-surface font-medium shadow-soft" : "text-muted-foreground")}>Todo</button>
          {categories.map(([code, name]) => (
            <button key={code} type="button" onClick={() => setCategory(code)} className={cn("rounded-full border px-3 py-1 text-xs", category === code ? "border-foreground/20 bg-surface font-medium shadow-soft" : "text-muted-foreground")}>{name}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
          {visible.map((p) => {
            const out = mode === "sale" && p.stocked && (p.stock ?? 0) <= 0;
            return (
              <button key={p.variantId} type="button" onClick={() => add(p)} disabled={out}
                className="group overflow-hidden rounded-xl border bg-surface text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-45 disabled:hover:translate-y-0">
                <div className="relative grid aspect-[3/2] place-items-center" style={{ background: p.image ? "linear-gradient(#dcdcde,#ced0d2)" : "var(--muted)" }}>
                  {p.image ? <Image src={p.image} alt="" fill sizes="220px" className="object-cover" />
                    : p.colorHex ? <span className="size-10 rounded-full border-4 border-white shadow-soft" style={{ background: p.colorHex }} />
                    : <span className="text-xs text-muted-foreground">{p.category}</span>}
                  {p.stocked && <span className={cn("absolute top-2 right-2 rounded-full px-1.5 text-[10px] font-medium tabular", (p.stock ?? 0) <= 1 ? "bg-danger-soft text-destructive" : "bg-white/80 text-neutral-600")}>{p.stock} u.</span>}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.color ?? p.sku}</p>
                  <p className="mt-1 text-sm font-semibold tabular">{formatMoney(p.price)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Ticket */}
      <aside className="sticky top-20 grid h-fit gap-3 rounded-2xl border bg-surface p-4 shadow-lift">
        {/* Patient */}
        {patient ? (
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate text-sm font-medium">{patient.name}</span>
              <button type="button" aria-label="Quitar paciente" onClick={() => { setPatient(null); setRx(null); }} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            </div>
            {rx && (
              <p className="mt-1.5 text-xs text-muted-foreground tabular">
                <FileText className="mr-1 inline size-3" />{rx.number}: OD {formatDiopter(rx.od_sphere)} {rx.od_cylinder ? `${formatDiopter(rx.od_cylinder)}×${rx.od_axis}` : ""} · OI {formatDiopter(rx.oi_sphere)} {rx.oi_cylinder ? `${formatDiopter(rx.oi_cylinder)}×${rx.oi_axis}` : ""}{rx.od_add ? ` · Add ${formatDiopter(rx.od_add)}` : ""}{rx.lens_type ? ` · ${rx.lens_type}` : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="relative">
            <Input value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} placeholder={mode === "quote" ? "Paciente (obligatorio)" : "Paciente (opcional)"} aria-label="Buscar paciente" />
            {patientQuery.trim().length >= 2 && patientHits.length > 0 && (
              <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border bg-popover p-1 shadow-lift">
                {patientHits.map((h) => (
                  <button key={h.id} type="button" onClick={() => { setPatient({ id: h.id, name: h.full_name }); setPatientQuery(""); setPatientHits([]); }}
                    className="flex w-full justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                    <span className="truncate">{h.full_name}</span><span className="text-xs text-muted-foreground tabular">{h.document_number}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lines */}
        <ul className="grid max-h-[300px] gap-2 overflow-y-auto">
          {lines.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Escanea o toca un producto para agregarlo</li>}
          {lines.map((l, i) => (
            <li key={l.product.variantId} className="grid gap-1.5 rounded-xl border p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.product.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{l.product.color ?? l.product.sku} · {formatMoney(l.product.price)}</p>
                </div>
                <p className="text-sm font-semibold tabular">{formatMoney(lineTotals(l.quantity, l.product.price, l.discount, l.product.taxRate).total)}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-lg border">
                  <button type="button" aria-label="Menos" className="grid size-7 place-items-center" onClick={() => setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}><Minus className="size-3" /></button>
                  <span className="w-7 text-center text-sm tabular">{l.quantity}</span>
                  <button type="button" aria-label="Más" className="grid size-7 place-items-center" onClick={() => add(l.product)}><Plus className="size-3" /></button>
                </div>
                {canDiscount && (
                  <Input aria-label="Descuento" inputMode="numeric" placeholder="Desc. $" className="h-7 w-24 text-xs" value={l.discount || ""}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, discount: Math.min(Number(e.target.value.replace(/\D/g, "")) || 0, x.quantity * x.product.price) } : x))} />
                )}
                <button type="button" aria-label="Quitar" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
              </div>
            </li>
          ))}
        </ul>

        {/* Totals */}
        <dl className="grid gap-1 border-t pt-3 text-sm">
          <div className="flex justify-between text-muted-foreground"><dt>Subtotal</dt><dd className="tabular">{formatMoney(totals.gross)}</dd></div>
          {totals.discount > 0 && <div className="flex justify-between text-muted-foreground"><dt>Descuentos</dt><dd className="tabular">−{formatMoney(totals.discount)}</dd></div>}
          <div className="flex justify-between text-muted-foreground"><dt>IVA incluido</dt><dd className="tabular">{formatMoney(totals.tax)}</dd></div>
          <div className="flex justify-between text-lg font-semibold"><dt>Total</dt><dd className="tabular">{formatMoney(totals.total)}</dd></div>
        </dl>

        {mode === "sale" && lines.length > 0 && (
          <div className="grid gap-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase">Pagos</p>
              <div className="flex gap-1">
                <button type="button" className="rounded-md border px-2 py-0.5 text-[11px] hover:bg-muted" onClick={() => setPayments([{ method: "cash", amount: String(totals.total) }])}>Total</button>
                <button type="button" className="rounded-md border px-2 py-0.5 text-[11px] hover:bg-muted" onClick={() => setPayments([{ method: payments[0]?.method ?? "cash", amount: String(Math.round(totals.total / 2 / 1000) * 1000) }])}>Anticipo 50%</button>
              </div>
            </div>
            {payments.map((p, i) => (
              <div key={i} className="flex gap-2">
                <NativeSelect aria-label="Medio de pago" value={p.method} className="h-9 w-36" onChange={(e) => setPayments((ps) => ps.map((x, j) => j === i ? { ...x, method: e.target.value as PaymentMethod } : x))}>
                  {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
                <Input aria-label="Valor" inputMode="numeric" placeholder="$ 0" className="tabular" value={p.amount}
                  onChange={(e) => setPayments((ps) => ps.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/\D/g, "") } : x))} />
                {payments.length > 1 && <Button variant="ghost" size="icon" aria-label="Quitar pago" onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}><X /></Button>}
              </div>
            ))}
            <button type="button" className="justify-self-start text-xs text-brand hover:underline" onClick={() => setPayments((ps) => [...ps, { method: "card", amount: balance ? String(balance) : "" }])}>+ Pago mixto</button>
            <div className="flex justify-between text-sm">
              {change > 0 && cash >= change ? <><span className="text-success">Cambio</span><span className="font-semibold text-success tabular">{formatMoney(change)}</span></>
                : <><span className="text-muted-foreground">{balance > 0 ? "Saldo pendiente" : "Pagado"}</span><span className={cn("font-semibold tabular", balance > 0 && "text-[oklch(0.5_0.12_60)]")}>{formatMoney(balance)}</span></>}
            </div>
          </div>
        )}

        <Button size="lg" className="h-11" disabled={pending || lines.length === 0} onClick={submit}>
          {pending && <Loader2 className="animate-spin" />}
          {mode === "quote" ? "Crear cotización" : balance > 0 && paid > 0 ? `Registrar con anticipo · saldo ${formatMoney(balance)}` : paid === 0 ? "Registrar a crédito" : "Cobrar"}
        </Button>
      </aside>
    </div>
  );
}
