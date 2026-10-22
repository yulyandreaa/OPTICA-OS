"use client";
import { Loader2, Minus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { FormSection } from "@/components/shared/form-section";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { recordMovementAction, searchVariantsAction, type VariantOption } from "../actions";
import { formatQty, MANUAL_MOVEMENTS, type ManualMovement } from "../constants";
import { movementSchema } from "../schemas";
import { VariantPicker } from "./variant-picker";

/** Manual stock movement. The database validates permission, branch, stock and lots; this form only guides. */
export function MovementForm({ branches, defaultBranchId, initialVariant, canCosts }: {
  branches: { id: string; name: string }[]; defaultBranchId: string; initialVariant?: VariantOption; canCosts: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [variant, setVariant] = useState<VariantOption | undefined>(initialVariant);
  const [type, setType] = useState<ManualMovement>("count");
  const [sign, setSign] = useState<1 | -1>(1);
  const [qty, setQty] = useState("");
  const [lot, setLot] = useState("");
  const [expires, setExpires] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const n = qty === "" ? undefined : Number(qty);
  const delta = n === undefined || !variant ? undefined
    : type === "count" ? n - variant.quantity : type === "adjustment" ? sign * n : type === "initial" ? n : -n;
  const incoming = (delta ?? 0) > 0;
  const after = variant && delta !== undefined ? variant.quantity + delta : undefined;

  const changeBranch = (id: string) => {
    setBranchId(id);
    if (variant) startTransition(async () => {
      const [fresh] = await searchVariantsAction(variant.sku, id, variant.id);
      setVariant(fresh ?? { ...variant, quantity: 0 });
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      branch_id: branchId, variant_id: variant?.id ?? "", type,
      quantity: type === "count" ? undefined : n === undefined ? undefined : type === "adjustment" ? sign * n : n,
      counted: type === "count" ? n : undefined,
      lot_code: lot.trim(), expires_on: expires,
      unit_cost: canCosts && type === "initial" && cost ? Number(cost.replace(/[^\d]/g, "")) : undefined,
      notes, idempotency_key: key,
    };
    const parsed = movementSchema.safeParse(payload);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
    if (variant?.trackLots && incoming && !lot.trim()) next.lot_code = "Este producto maneja lotes: indica el lote";
    if (variant && after !== undefined && after < 0) next.quantity = `Solo hay ${formatQty(variant.quantity)} disponibles en esta sede`;
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;
    startTransition(async () => {
      const res = await recordMovementAction(parsed.data);
      if (!res.ok) {
        toast.error(res.error);
        setKey(crypto.randomUUID()); // a failed attempt didn't record anything: the next one is a new request
        return;
      }
      toast.success(res.message);
      router.push(`/inventario/${variant!.productId}?tab=movimientos`);
      router.refresh();
    });
  };

  const current = MANUAL_MOVEMENTS.find((m) => m.key === type)!;
  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border bg-surface p-6 shadow-soft sm:p-8">
      <FormSection title="Producto y sede" description="El movimiento afecta solo a la sede elegida.">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
          <FormField id="variant" label="Producto" error={errors.variant_id}>
            {variant ? (
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{variant.label}</span>
                  <span className="block text-xs text-muted-foreground"><span className="font-mono">{variant.sku}</span> · {formatQty(variant.quantity)} disponibles en esta sede{variant.trackLots ? " · maneja lotes" : ""}</span>
                </span>
                <button type="button" onClick={() => setVariant(undefined)} aria-label="Cambiar producto" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
              </div>
            ) : <VariantPicker branchId={branchId} onPick={setVariant} invalid={!!errors.variant_id} autoFocus />}
          </FormField>
          <FormField id="branch" label="Sede">
            <NativeSelect id="branch" value={branchId} onChange={(e) => changeBranch(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Tipo de movimiento" description="Las ventas, compras y traslados registran sus movimientos solos.">
        <div role="radiogroup" aria-label="Tipo de movimiento" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {MANUAL_MOVEMENTS.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={type === m.key} onClick={() => { setType(m.key); setErrors({}); }}
              className={cn("rounded-xl border px-3 py-2.5 text-left text-sm transition-colors", type === m.key ? "border-brand bg-brand-soft font-medium" : "hover:bg-muted")}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{current.hint}</p>
      </FormSection>

      <FormSection title="Cantidad">
        <div className="grid gap-4 sm:grid-cols-3">
          {type === "adjustment" && (
            <FormField id="sign" label="Dirección">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {([1, -1] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSign(s)} aria-pressed={sign === s}
                    className={cn("inline-flex items-center justify-center gap-1 rounded-md py-1 text-sm", sign === s ? "bg-surface font-medium shadow-soft" : "text-muted-foreground")}>
                    {s === 1 ? <><Plus className="size-3.5" /> Sumar</> : <><Minus className="size-3.5" /> Restar</>}
                  </button>
                ))}
              </div>
            </FormField>
          )}
          <FormField id="qty" label={type === "count" ? "Unidades contadas" : "Unidades"} error={errors.quantity ?? errors.counted}>
            <Input id="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!!(errors.quantity ?? errors.counted)} />
          </FormField>
          {variant && after !== undefined && (
            <div className="self-end rounded-lg bg-muted px-3 py-2 text-sm">
              {delta === 0 ? "Sin diferencia: no se registrará movimiento." : <>Quedarán <b className="tabular">{formatQty(after)}</b> ({delta! > 0 ? "+" : ""}{formatQty(delta)})</>}
            </div>
          )}
        </div>
        {variant?.trackLots && (
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="lot" label="Lote" error={errors.lot_code} hint={incoming ? undefined : "Vacío = sale primero el que vence antes"} optional={!incoming}>
              <Input id="lot" className="font-mono uppercase" value={lot} onChange={(e) => setLot(e.target.value)} aria-invalid={!!errors.lot_code} />
            </FormField>
            {incoming && (
              <FormField id="expires" label="Vencimiento" optional error={errors.expires_on}>
                <Input id="expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        {canCosts && type === "initial" && (
          <FormField id="cost" label="Costo unitario" optional hint="Si lo indicas, recalcula el costo promedio" className="sm:max-w-xs">
            <Input id="cost" inputMode="numeric" value={cost ? Number(cost).toLocaleString("es-CO") : ""} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} />
          </FormField>
        )}
      </FormSection>

      <FormSection title="Motivo" description="Queda en el historial con tu nombre, la fecha y la hora.">
        <FormField id="notes" label="Motivo o referencia" error={errors.notes}>
          <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} aria-invalid={!!errors.notes}
            placeholder={type === "count" ? "Conteo mensual de vitrina" : type === "damage" ? "Varilla rota al exhibir" : "Describe el motivo"} />
        </FormField>
      </FormSection>

      <div className="flex flex-col-reverse gap-2 pt-6 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Registrar movimiento</Button>
      </div>
    </form>
  );
}
