import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/shared/logo";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tu cotización", robots: { index: false } };
/** Public, token-scoped; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

interface PublicQuote {
  number: string; status: string; valid_until: string; total: number; tax_total: number; discount_total: number;
  tenant: { name: string; brand_color: string | null; phone: string | null }; branch: { name: string; address: string | null; phone: string | null };
  patient_first_name: string; items: { description: string; quantity: number; unit_price: number; line_total: number; image_url: string | null }[];
}

export default async function PublicQuotePage(props: PageProps<"/quote/[token]">) {
  const { token } = await props.params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const { data } = await (await createClient()).rpc("public_quote", { p_token: token });
  const q = data as PublicQuote | null;
  if (!q) notFound();
  const hero = q.items.find((i) => i.image_url)?.image_url;
  const expired = new Date(`${q.valid_until}T23:59:59`) < new Date();
  return (
    <div className="min-h-dvh bg-background" style={{ "--brand": q.tenant.brand_color ?? "oklch(0.52 0.19 268)" } as CSSProperties}>
      <header className="border-b bg-surface"><div className="mx-auto flex max-w-xl items-center gap-3 px-5 py-4">
        <div className="grid size-9 place-items-center rounded-xl text-sm font-semibold text-white" style={{ background: "var(--brand)" }}>{q.tenant.name.slice(0, 1)}</div>
        <div><p className="font-semibold">{q.tenant.name}</p><p className="text-xs text-muted-foreground">Cotización {q.number}</p></div>
      </div></header>
      {hero && <div className="relative mx-auto aspect-[3/2] max-w-xl bg-[linear-gradient(#dcdcde,#ced0d2)]"><Image src={hero} alt="" fill sizes="576px" className="object-cover" priority /></div>}
      <main className="mx-auto grid max-w-xl gap-4 px-5 py-6">
        <h1 className="text-2xl font-light tracking-tight">Hola {q.patient_first_name}, <span className="font-semibold">esta es tu cotización</span></h1>
        <ul className="divide-y rounded-2xl border bg-surface shadow-soft">
          {q.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{i.description}{i.quantity > 1 ? ` × ${i.quantity}` : ""}</span><span className="tabular">{formatMoney(i.line_total)}</span></li>
          ))}
          <li className="flex justify-between px-4 py-3 text-lg font-semibold"><span>Total</span><span className="tabular">{formatMoney(q.total)}</span></li>
        </ul>
        <p className={expired ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {expired ? "Esta cotización ya venció; escríbenos y te la actualizamos." : `Válida hasta el ${new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${q.valid_until}T12:00:00Z`))}. Precios con IVA incluido.`}
        </p>
        <p className="text-sm">Te esperamos en <b>{q.branch.name}</b>{q.branch.address ? `, ${q.branch.address}` : ""}.</p>
      </main>
      <footer className="flex items-center justify-center gap-1.5 pb-8 text-xs text-muted-foreground"><LogoMark className="size-4" /> Óptica OS</footer>
    </div>
  );
}
