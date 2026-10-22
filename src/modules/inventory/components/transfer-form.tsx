"use client";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { FormSection } from "@/components/shared/form-section";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createTransferAction, type VariantOption } from "../actions";
import { formatQty } from "../constants";
import { transferSchema } from "../schemas";
import { VariantPicker } from "./variant-picker";

type Line = VariantOption & { qty: string };

/** Send units from one branch to another: they leave the origin now and enter the destination when it confirms receipt. */
export function TransferForm({ origins, destinations, defaultFrom, initialVariant }: {
  origins: { id: string; name: string }[]; destinations: { id: string; name: string }[]; defaultFrom: string; initialVariant?: VariantOption;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(destinations.find((d) => d.id !== defaultFrom)?.id ?? "");
  const [lines, setLines] = useState<Line[]>(initialVariant ? [{ ...initialVariant, qty: initialVariant.quantity > 0 ? "1" : "" }] : []);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changeFrom = (id: string) => {
    setFrom(id);
    setLines([]); // availability belongs to the origin: pick again
    if (to === id) setTo(destinations.find((d) => d.id !== id)?.id ?? "");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { from_branch_id: from, to_branch_id: to, notes, idempotency_key: key,
      items: lines.map((l) => ({ variant_id: l.id, quantity: Number(l.qty) })) };
    const parsed = transferSchema.safeParse(payload);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path.join(".")] ??= i.message;
    lines.forEach((l, i) => { if (Number(l.qty) > l.quantity) next[`items.${i}.quantity`] = `Solo hay ${formatQty(l.quantity)} en el origen`; });
    setErrors(next);
    if (Object.keys(next).length || !parsed.success) return;
    startTransition(async () => {
      const res = await createTransferAction(parsed.data);
      if (!res.ok) { toast.error(res.error); setKey(crypto.randomUUID()); return; }
      toast.success(res.message);
      router.push("/inventario/traslados");
      router.refresh();
    });
  };

  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border bg-surface p-6 shadow-soft sm:p-8">
      <FormSection title="Sedes" description="Las unidades salen del origen al enviar y entran al destino cuando allí confirman que llegaron.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="from" label="Sede de origen">
            <NativeSelect id="from" value={from} onChange={(e) => changeFrom(e.target.value)}>
              {origins.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="to" label="Sede de destino" error={errors.to_branch_id}>
            <NativeSelect id="to" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!!errors.to_branch_id}>
              <option value="">Elige la sede</option>
              {destinations.filter((d) => d.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Productos" description="Se muestra lo disponible en la sede de origen.">
        <VariantPicker key={from} branchId={from} exclude={lines.map((l) => l.id)} invalid={!!errors.items}
          onPick={(v) => setLines((ls) => [...ls, { ...v, qty: v.quantity > 0 ? "1" : "" }])} />
        {errors.items && <p role="alert" className="text-xs text-destructive">{errors.items}</p>}
        {lines.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {lines.map((l, i) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.label}</span>
                  <span className="block text-xs text-muted-foreground"><span className="font-mono">{l.sku}</span> · {formatQty(l.quantity)} disponibles</span>
                </span>
                <div className="grid gap-1">
                  <Input aria-label={`Unidades de ${l.label}`} inputMode="numeric" value={l.qty} className="h-8 w-24 text-right tabular"
                    aria-invalid={!!errors[`items.${i}.quantity`]}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, qty: e.target.value.replace(/[^\d]/g, "") } : x))} />
                  {errors[`items.${i}.quantity`] && <span className="text-xs text-destructive">{errors[`items.${i}.quantity`]}</span>}
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label={`Quitar ${l.label}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Notas">
        <FormField id="notes" label="Observaciones" optional>
          <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: reposición para la vitrina de Chapinero" />
        </FormField>
      </FormSection>

      <div className="flex flex-col-reverse items-center gap-2 pt-6 sm:flex-row sm:justify-end">
        {total > 0 && <span className="text-sm text-muted-foreground tabular sm:mr-auto">{formatQty(total)} {total === 1 ? "unidad" : "unidades"} en {lines.length} {lines.length === 1 ? "referencia" : "referencias"}</span>}
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Enviar traslado</Button>
      </div>
    </form>
  );
}
