"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateTenantAction } from "../actions";

const SWATCHES = ["#4f46e5", "#0ea5e9", "#0d9488", "#16a34a", "#db2777", "#ea580c", "#111827"];

export function TenantForm({ tenant }: { tenant: { trade_name: string; legal_name: string; tax_id: string | null; tax_dv: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; brand_color: string | null; timezone: string; slug: string } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState(tenant.brand_color ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    startTransition(async () => {
      const res = await updateTenantAction({
        tradeName: get("tradeName"), legalName: get("legalName"), taxId: get("taxId"), taxDv: get("taxDv"), email: get("email"),
        phone: get("phone"), address: get("address"), city: get("city"), brandColor: color,
        timezone: get("timezone") as "America/Bogota",
      });
      if (!res.ok) { toast.error(res.error); setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""]))); return; }
      setErrors({});
      toast.success(res.message);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6 rounded-xl border bg-surface p-6 shadow-soft">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="tradeName" label="Nombre comercial" error={errors.tradeName}><Input id="tradeName" name="tradeName" defaultValue={tenant.trade_name} /></FormField>
        <FormField id="legalName" label="Razón social" error={errors.legalName}><Input id="legalName" name="legalName" defaultValue={tenant.legal_name} /></FormField>
        <div className="grid grid-cols-[1fr_64px] gap-3">
          <FormField id="taxId" label="NIT" error={errors.taxId}><Input id="taxId" name="taxId" defaultValue={tenant.tax_id ?? ""} className="tabular" /></FormField>
          <FormField id="taxDv" label="DV"><Input id="taxDv" name="taxDv" defaultValue={tenant.tax_dv ?? ""} className="text-center" /></FormField>
        </div>
        <FormField id="email" label="Correo de la empresa" error={errors.email}><Input id="email" name="email" type="email" defaultValue={tenant.email ?? ""} /></FormField>
        <FormField id="phone" label="Teléfono"><Input id="phone" name="phone" defaultValue={tenant.phone ?? ""} /></FormField>
        <FormField id="city" label="Ciudad"><Input id="city" name="city" defaultValue={tenant.city ?? ""} /></FormField>
        <FormField id="address" label="Dirección" className="sm:col-span-2"><Input id="address" name="address" defaultValue={tenant.address ?? ""} /></FormField>
        <FormField id="timezone" label="Zona horaria">
          <NativeSelect id="timezone" name="timezone" defaultValue={tenant.timezone}>
            <option value="America/Bogota">Colombia (Bogotá)</option><option value="America/Lima">Perú (Lima)</option>
            <option value="America/Guayaquil">Ecuador</option><option value="America/Panama">Panamá</option><option value="America/Mexico_City">México</option>
          </NativeSelect>
        </FormField>
        <FormField id="slug" label="Enlace de reservas" hint="Comparte este enlace en Instagram y WhatsApp."><Input id="slug" readOnly value={`/book/${tenant.slug}`} className="font-mono text-xs" /></FormField>
      </div>
      <FormField id="brand" label="Color de marca" error={errors.brandColor} hint="Se usa en la plataforma, la página de reservas y los PDF.">
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((s) => (
            <button key={s} type="button" aria-label={`Color ${s}`} onClick={() => setColor(s)}
              className="size-7 rounded-full ring-offset-2 ring-offset-surface transition-shadow data-[active=true]:ring-2 data-[active=true]:ring-foreground"
              data-active={color.toLowerCase() === s} style={{ background: s }} />
          ))}
          <Input id="brand" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#4f46e5" className="w-28 font-mono text-xs" />
        </div>
      </FormField>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Guardar</Button></div>
    </form>
  );
}
