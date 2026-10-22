import { Check } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/shared/logo";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { TRACK_STEPS, trackStep } from "@/modules/labs/constants";

export const metadata: Metadata = { title: "Seguimiento de tus gafas", robots: { index: false } };
/** Public, token-scoped; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

interface Tracked { number: string; status: string; estimated_at: string | null; tenant: string; brand_color: string | null; branch: string; branch_address: string | null; branch_phone: string | null; first_name: string }

export default async function TrackPage(props: PageProps<"/track/[token]">) {
  const { token } = await props.params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const { data } = await (await createClient()).rpc("track_lab_order", { p_token: token });
  const t = data as Tracked | null;
  if (!t) notFound();
  const step = trackStep(t.status);
  const ready = t.status === "received";
  return (
    <div className="min-h-dvh bg-background" style={{ "--brand": t.brand_color ?? "oklch(0.52 0.19 268)" } as CSSProperties}>
      <section className="bg-[linear-gradient(to_bottom,#dcdcde,#ced0d2)]">
        <div className="mx-auto max-w-xl px-5 pt-8">
          <p className="text-[11px] font-medium tracking-[0.18em] text-neutral-500 uppercase">{t.tenant} · Pedido {t.number}</p>
          <h1 className="mt-1 text-3xl font-extralight tracking-tight text-neutral-800">
            {ready ? <>¡{t.first_name}, tus gafas <span className="font-semibold">están listas!</span></> : t.status === "delivered" ? <>Gafas <span className="font-semibold">entregadas</span></> : <>Hola {t.first_name}, <span className="font-semibold">así va tu pedido</span></>}
          </h1>
        </div>
        <div className="relative mx-auto aspect-[3/1.4] max-w-xl"><Image src="/frames/aurora-cobalto.jpg" alt="" fill priority sizes="576px" className="object-cover [mask-image:radial-gradient(closest-side,black_70%,transparent_100%)]" /></div>
      </section>
      <main className="mx-auto -mt-6 grid max-w-xl gap-4 px-5 pb-10">
        <ol className="relative grid gap-0 rounded-2xl border bg-surface p-5 shadow-lift">
          {TRACK_STEPS.map((s, i) => (
            <li key={s} className="relative flex gap-3 pb-5 last:pb-0">
              {i < TRACK_STEPS.length - 1 && <span className={cn("absolute top-6 left-[11px] h-[calc(100%-12px)] w-0.5", i < step ? "bg-[var(--brand)]" : "bg-border")} />}
              <span className={cn("relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 text-white", i <= step ? "border-[var(--brand)] bg-[var(--brand)]" : "border-border bg-surface")}>
                {i <= step && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className={cn("pt-0.5 text-sm", i === step ? "font-semibold" : i < step ? "text-foreground" : "text-muted-foreground")}>{s}</span>
            </li>
          ))}
        </ol>
        {t.estimated_at && step < 3 && <p className="text-sm text-muted-foreground">Fecha estimada: <b className="text-foreground">{new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${t.estimated_at}T12:00:00Z`))}</b></p>}
        <p className="text-sm">Sede <b>{t.branch}</b>{t.branch_address ? ` · ${t.branch_address}` : ""}{t.branch_phone ? ` · ${t.branch_phone}` : ""}</p>
      </main>
      <footer className="flex items-center justify-center gap-1.5 pb-8 text-xs text-muted-foreground"><LogoMark className="size-4" /> Óptica OS</footer>
    </div>
  );
}
