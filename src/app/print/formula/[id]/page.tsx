import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LogoMark } from "@/components/shared/logo";
import { ageFrom, formatDate } from "@/lib/format";
import { can } from "@/modules/authz/permissions";
import { RxTable } from "@/modules/clinical/components/rx-table";
import { LENS_MATERIALS, LENS_TYPES, TREATMENTS } from "@/modules/clinical/constants";
import { getPrescription } from "@/modules/clinical/repositories";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/modules/tenants/services/context";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Fórmula", robots: { index: false } };
/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

export default async function PrintPrescription(props: PageProps<"/print/formula/[id]">) {
  const { id } = await props.params;
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  if (!can(ctx.grants, "prescriptions.read")) notFound();
  const rx = await getPrescription(await createClient(), ctx.tenant.id, id);
  if (!rx) notFound();
  const t = ctx.tenant;
  const age = ageFrom(rx.patient?.birth_date);
  return (
    <div className="min-h-dvh bg-muted/40 py-8 print:bg-white print:py-0" style={t.brand_color ? ({ "--brand": t.brand_color } as React.CSSProperties) : undefined}>
      <div className="mx-auto mb-4 flex max-w-[210mm] justify-end print:hidden"><PrintButton /></div>
      <article className="mx-auto flex min-h-[270mm] max-w-[210mm] flex-col bg-white p-[18mm] text-neutral-900 shadow-lift print:min-h-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-brand pb-5">
          <div className="flex items-center gap-3">
            <LogoMark className="size-10" />
            <div>
              <p className="text-lg font-semibold">{t.trade_name}</p>
              <p className="text-xs text-neutral-500">{t.legal_name}{t.tax_id ? ` · NIT ${t.tax_id}-${t.tax_dv ?? ""}` : ""}</p>
              <p className="text-xs text-neutral-500">{[t.address, t.city, t.phone].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-[0.2em] text-neutral-500 uppercase">Fórmula {rx.kind === "contact_lens" ? "de lentes de contacto" : "óptica"}</p>
            <p className="font-mono text-lg font-semibold">{rx.number}</p>
            <p className="text-xs text-neutral-500">{formatDate(rx.issued_at, ctx.timezone, { dateStyle: "long" })}</p>
          </div>
        </header>

        <section className="grid grid-cols-3 gap-4 py-5 text-sm">
          <div className="col-span-2"><p className="text-xs text-neutral-500">Paciente</p><p className="font-medium">{rx.patient?.full_name}</p></div>
          <div><p className="text-xs text-neutral-500">Documento</p><p className="font-medium tabular">{rx.patient?.document_type} {rx.patient?.document_number}</p></div>
          <div><p className="text-xs text-neutral-500">Edad</p><p className="font-medium">{age !== null ? `${age} años` : "—"}</p></div>
          <div><p className="text-xs text-neutral-500">Válida hasta</p><p className="font-medium">{rx.expires_at ? formatDate(rx.expires_at, ctx.timezone) : "—"}</p></div>
        </section>

        <section className="rounded-xl border p-4"><RxTable rx={rx} className="text-base" /></section>

        <section className="grid grid-cols-5 gap-3 py-5 text-sm">
          {[["DP", rx.dp_binocular], ["DP OD", rx.dp_od], ["DP OI", rx.dp_oi], ["Altura OD", rx.height_od], ["Altura OI", rx.height_oi]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{l}</p><p className="font-medium tabular">{v ?? "—"}{v ? " mm" : ""}</p></div>
          ))}
        </section>

        <section className="grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-neutral-500">Tipo de lente</p><p className="font-medium">{LENS_TYPES[rx.lens_type as keyof typeof LENS_TYPES] ?? "—"}</p></div>
          <div><p className="text-xs text-neutral-500">Material</p><p className="font-medium">{LENS_MATERIALS[rx.material as keyof typeof LENS_MATERIALS] ?? "—"}</p></div>
          <div><p className="text-xs text-neutral-500">Tratamientos</p><p className="font-medium">{rx.treatments.map((x) => TREATMENTS[x as keyof typeof TREATMENTS] ?? x).join(", ") || "—"}</p></div>
        </section>
        {rx.notes && <p className="mt-4 text-sm">{rx.notes}</p>}

        <footer className="mt-auto flex items-end justify-between pt-16 text-sm">
          <div className="w-64 border-t pt-2"><p className="font-medium">{rx.professional?.full_name}</p><p className="text-xs text-neutral-500">Optometría · Firma electrónica</p></div>
          <p className="max-w-xs text-right text-[10px] text-neutral-400">Documento generado por {t.trade_name}. Fórmula de uso personal e intransferible.</p>
        </footer>
      </article>
    </div>
  );
}
