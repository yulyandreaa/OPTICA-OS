"use client";
import { ArrowLeftRight, Loader2, Mail, Phone, Search } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createPatientAction } from "@/modules/patients/actions";
import { DOCUMENT_TYPES } from "@/modules/patients/schemas";
import { searchCustomersAction, type CustomerHit } from "../actions";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Picks a person from the Clientes y pacientes directory. Contact data only, nothing clinical. */
export function CustomerPicker({ value, onChange }: { value: CustomerHit | null; onChange: (c: CustomerHit | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      void searchCustomersAction(q).then((r) => { if (alive) { setHits(r); setLoading(false); } });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{initials(value.full_name)}</span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-2 font-medium">{value.full_name}
            <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Cliente activo</span></p>
          <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>{value.document_type} {value.document_number}</span>
            {value.phone && <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" />{value.phone}</span>}
            {value.email && <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="size-3.5 shrink-0" /><span className="truncate">{value.email}</span></span>}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { onChange(null); setQ(""); setHits(null); }}><ArrowLeftRight /> Cambiar</Button>
      </div>
    );
  }

  const typed = q.trim().length >= 2;
  return (
    <div className="grid gap-2">
      <div className="relative">
        {loading ? <Loader2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          : <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, documento, teléfono o correo…" aria-label="Buscar cliente" className="h-10 pl-9" />
      </div>
      {typed && hits && (
        <ul className="divide-y overflow-hidden rounded-xl border" role="listbox" aria-label="Clientes encontrados">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onChange(h)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{initials(h.full_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{h.document_type} {h.document_number}{h.phone ? ` · ${h.phone}` : ""}</span>
                </span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No encontramos a nadie con “{q.trim()}”. Puedes registrarlo con “Nuevo cliente”.</li>}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Sin cliente, la venta queda como venta de mostrador y debe pagarse completa.</p>
    </div>
  );
}

/** Minimal customer registration in the shared directory (duplicate documents are refused by the directory itself). */
export function NewCustomerDialog({ open, onOpenChange, initial, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; initial: string; onCreated: (c: CustomerHit) => void }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [consent, setConsent] = useState(false);
  const digits = /^\d{5,}$/.test(initial.trim()) ? initial.trim() : "";
  const words = digits ? [] : initial.trim().split(/\s+/).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar cliente nuevo</DialogTitle>
          <DialogDescription>Queda en Clientes y pacientes. Si el documento ya existe, te avisamos para no duplicar a la persona.</DialogDescription>
        </DialogHeader>
        <form key={String(open)} className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const get = (k: string) => String(fd.get(k) ?? "").trim();
          startTransition(async () => {
            const res = await createPatientAction({
              relation: "customer", documentType: get("documentType") as keyof typeof DOCUMENT_TYPES, documentNumber: get("documentNumber"),
              firstName: get("firstName"), lastName: get("lastName"), phone: get("phone"), whatsapp: get("phone"), email: get("email"),
              contactPreference: "whatsapp", acceptDataPolicy: true,
            });
            if (!res.ok) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
            toast.success("Cliente registrado");
            onCreated({ id: res.data.id, full_name: `${get("firstName")} ${get("lastName")}`, document_type: get("documentType"),
              document_number: get("documentNumber").toUpperCase(), phone: get("phone") || null, email: get("email") || null });
          });
        }}>
          <FormField id="nc-type" label="Tipo de documento">
            <NativeSelect id="nc-type" name="documentType" defaultValue="CC">
              {Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="nc-doc" label="Número de documento" error={errors.documentNumber?.[0]}>
            <Input id="nc-doc" name="documentNumber" required defaultValue={digits} inputMode="numeric" autoComplete="off" />
          </FormField>
          <FormField id="nc-first" label="Nombres" error={errors.firstName?.[0]}>
            <Input id="nc-first" name="firstName" required defaultValue={words.slice(0, Math.max(1, words.length - 1)).join(" ")} autoComplete="off" />
          </FormField>
          <FormField id="nc-last" label="Apellidos" error={errors.lastName?.[0]}>
            <Input id="nc-last" name="lastName" required defaultValue={words.length > 1 ? words[words.length - 1] : ""} autoComplete="off" />
          </FormField>
          <FormField id="nc-phone" label="Celular" optional error={errors.phone?.[0]}>
            <Input id="nc-phone" name="phone" inputMode="tel" autoComplete="off" />
          </FormField>
          <FormField id="nc-email" label="Correo" optional error={errors.email?.[0]}>
            <Input id="nc-email" name="email" type="email" autoComplete="off" />
          </FormField>
          <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
            <Checkbox checked={consent} onCheckedChange={(c) => setConsent(c === true)} className="mt-0.5" />
            <span>El cliente autoriza el tratamiento de sus datos personales según la política de la óptica (Ley 1581 de 2012).</span>
          </label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending || !consent}>{pending && <Loader2 className="animate-spin" />} Registrar y usar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
