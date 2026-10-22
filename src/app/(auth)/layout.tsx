import { CalendarCheck2, Glasses, Sparkles } from "lucide-react";
import { Logo } from "@/components/shared/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</main>
        <Footer />
      </div>
      <ShowcasePanel />
    </div>
  );
}

/** Right-hand brand panel: the product is the hero (premium eyewear stage), UI cards tell the promise. */
function ShowcasePanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[linear-gradient(to_bottom,#dcdcde,#ced0d2)] lg:block">
      <div className="relative flex h-full flex-col p-12 text-neutral-800">
        <div className="max-w-md space-y-4">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 text-xs text-neutral-600 backdrop-blur">
            <Sparkles className="size-3.5 text-brand" /> El sistema operativo de una óptica moderna
          </p>
          <h2 className="text-4xl leading-[1.08] font-light tracking-tight text-balance">
            Vende más, atiende mejor y <span className="font-semibold">no pierdas ni un paciente.</span>
          </h2>
        </div>

        {/* Product film, framed at its native 16:9 and feathered into the backdrop. */}
        <div className="relative -mx-12 flex flex-1 items-center">
          <video
            className="aspect-video w-full object-cover [mask-image:radial-gradient(closest-side,black_68%,transparent_100%)]"
            src="/video/hero.mp4"
            poster="/frames/aurora-cobalto.jpg"
            autoPlay
            muted
            loop
            playsInline
            aria-hidden
          />
          <div className="absolute top-[18%] right-14 flex items-center gap-2 rounded-xl bg-white/85 px-3 py-2 text-xs shadow-lift backdrop-blur">
            <CalendarCheck2 className="size-4 text-brand" /> Cita confirmada por WhatsApp
          </div>
        </div>

        <div className="grid grid-cols-[1.25fr_1fr] gap-3">
          <div className="rounded-2xl bg-white/75 p-4 shadow-lift backdrop-blur-md">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-600">Buenos días, Andrés 👋</span>
              <span className="text-xs text-neutral-400">Hoy</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[["18", "citas"], ["3", "listas"], ["10", "por recuperar"]].map(([v, l]) => (
                <div key={l} className="rounded-xl bg-white/80 p-2.5">
                  <p className="text-lg font-semibold tabular">{v}</p>
                  <p className="truncate text-[11px] text-neutral-500">{l}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-lift">
            <div className="flex items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success"><Glasses className="size-4.5" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">Tus gafas están listas</p>
                <p className="truncate text-xs text-muted-foreground">Aurora · Azul cobalto</p>
              </div>
            </div>
            <div className="mt-4 flex gap-1">{[1, 1, 1, 1].map((_, i) => <span key={i} className="h-1 flex-1 rounded-full bg-success" />)}</div>
            <p className="mt-2 text-[11px] text-muted-foreground">Listas para recoger en Chapinero</p>
          </div>
        </div>

        <p className="mt-6 text-xs text-neutral-500">Datos clínicos cifrados en tránsito · Aislamiento por empresa · Auditoría completa</p>
      </div>
    </aside>
  );
}

async function Footer() {
  "use cache";
  return <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Óptica OS · Hecho en Colombia</p>;
}
