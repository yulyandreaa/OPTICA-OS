import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/shared/logo";
import { createClient } from "@/lib/supabase/server";
import { BookingWizard } from "@/modules/booking/components/booking-wizard";
import { bookingCatalogSchema } from "@/modules/booking/schemas";

/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

async function loadCatalog(slug: string) {
  const db = await createClient();
  const { data } = await db.rpc("booking_catalog", { p_slug: slug });
  const parsed = bookingCatalogSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function generateMetadata(props: PageProps<"/book/[slug]">): Promise<Metadata> {
  const catalog = await loadCatalog((await props.params).slug);
  return { title: catalog ? `Agenda tu cita · ${catalog.tenant.name}` : "Reservas", robots: { index: true } };
}

export default async function BookingPage(props: PageProps<"/book/[slug]">) {
  const catalog = await loadCatalog((await props.params).slug);
  if (!catalog) notFound();
  const style = { "--brand": catalog.tenant.brand_color ?? "oklch(0.52 0.19 268)" } as CSSProperties;

  return (
    <div className="min-h-dvh bg-background" style={style}>
      <header className="border-b bg-surface">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-5 py-4">
          <div className="grid size-9 place-items-center rounded-xl text-sm font-semibold text-white" style={{ background: "var(--brand)" }}>
            {catalog.tenant.name.slice(0, 1)}
          </div>
          <div>
            <p className="font-semibold">{catalog.tenant.name}</p>
            <p className="text-xs text-muted-foreground">Agenda tu cita en línea</p>
          </div>
        </div>
      </header>
      <section className="overflow-hidden bg-[linear-gradient(to_bottom,#dcdcde,#ced0d2)]">
        <div className="mx-auto grid max-w-4xl items-center gap-2 px-5 pt-8 pb-12 sm:grid-cols-[1fr_1.4fr] sm:pt-6">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-neutral-500 uppercase">Agenda en línea</p>
            <h1 className="mt-1 text-3xl leading-tight font-extralight tracking-tight text-neutral-800 sm:text-4xl">Tu próxima mirada<br /><span className="font-semibold">empieza aquí.</span></h1>
            <p className="mt-3 max-w-xs text-sm text-neutral-600">Elige el servicio, la sede y la hora. Recibirás la confirmación al instante.</p>
          </div>
          <div className="relative aspect-[3/2] w-full">
            <Image src="/frames/aurora-cobalto.jpg" alt="" fill priority sizes="(min-width: 640px) 520px, 100vw"
              className="object-cover [mask-image:radial-gradient(closest-side,black_70%,transparent_100%)]" />
          </div>
        </div>
      </section>
      <main className="mx-auto -mt-10 max-w-xl px-5 pb-8">
        <div className="relative rounded-2xl border bg-surface p-5 shadow-lift sm:p-6">
        {catalog.services.length === 0 || catalog.branches.length === 0 ? (
          <p className="text-center text-muted-foreground">La reserva en línea aún no está disponible. Contáctanos directamente.</p>
        ) : (
          <BookingWizard catalog={catalog} />
        )}
        </div>
      </main>
      <footer className="flex items-center justify-center gap-1.5 pb-8 text-xs text-muted-foreground">
        <LogoMark className="size-4" /> Reservas con Óptica OS
      </footer>
    </div>
  );
}
