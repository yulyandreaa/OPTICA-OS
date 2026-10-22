"use client";
import { ChevronLeft, ChevronRight, FileText, Ruler, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FrameModel } from "../catalog/demo-catalog";

/** Product stage inspired by premium eyewear configurators: the frame is the hero, the UI whispers. */
export function Showcase({ catalog, quoteHref }: { catalog: FrameModel[]; quoteHref?: (colorKey: string) => string }) {
  const [modelIdx, setModelIdx] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);
  const model = catalog[modelIdx]!;
  const color = model.colors[colorIdx] ?? model.colors[0]!;

  const selectModel = (i: number) => { setModelIdx(i); setColorIdx(0); };
  const step = useCallback((dir: 1 | -1) => {
    if (model.colors.length > 1) setColorIdx((c) => (c + dir + model.colors.length) % model.colors.length);
    else { setModelIdx((m) => (m + dir + catalog.length) % catalog.length); setColorIdx(0); }
  }, [model.colors.length, catalog.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  return (
    <div className="grid gap-4">
      {/* Stage */}
      <section
        aria-label={`${model.name} en ${color.name}`}
        className="relative overflow-hidden rounded-3xl border shadow-soft"
      >
        {/* Stage tint follows the photo (cross-faded) so product and backdrop read as one surface. */}
        {catalog.flatMap((m, mi) => m.colors.map((c, ci) => (
          <div
            key={`bg-${m.slug}-${c.key}`}
            aria-hidden
            className={cn("absolute inset-0 transition-opacity duration-700", mi === modelIdx && ci === colorIdx ? "opacity-100" : "opacity-0")}
            style={{ background: `linear-gradient(to bottom, ${c.stage[0]}, ${c.stage[1]})` }}
          />
        )))}
        <div className="relative grid min-h-[460px] lg:grid-cols-[minmax(260px,340px)_1fr]">
          {/* Info column */}
          <div className="relative z-10 flex flex-col gap-5 p-6 sm:p-8">
            <div>
              <p className="text-[11px] font-medium tracking-[0.18em] text-neutral-500 uppercase">{model.collection} · {model.category}</p>
              <h2 className="mt-2 text-5xl leading-none font-extralight tracking-tight text-neutral-800 lowercase sm:text-6xl">
                <span className="block text-2xl text-neutral-400">modelo</span>{model.name}
              </h2>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-neutral-600">{model.description}</p>
            <dl className="grid max-w-xs grid-cols-3 gap-3 text-xs">
              {[["Lente", model.size.lens], ["Puente", model.size.bridge], ["Varilla", model.size.temple]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/55 p-2.5 backdrop-blur">
                  <dt className="text-neutral-500">{k}</dt>
                  <dd className="text-base font-medium text-neutral-800 tabular">{v}<span className="text-xs text-neutral-400"> mm</span></dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-xs text-neutral-600"><Ruler className="size-3" />{model.shape}</span>
              <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs text-neutral-600">{model.material}</span>
              {model.tags.map((t) => <span key={t} className="rounded-full bg-white/60 px-2.5 py-1 text-xs text-neutral-600">{t}</span>)}
            </div>
            <div className="mt-auto">
              <p className="text-xs text-neutral-500">precio montura</p>
              <p className="text-3xl font-light text-brand tabular">{formatMoney(model.price)}</p>
              <p className="mt-1 font-mono text-[11px] text-neutral-400">{color.key.startsWith(model.sku) ? color.key : `${model.sku}-${color.key.toUpperCase()}`}</p>
            </div>
          </div>

          {/* Product */}
          <div className="relative flex min-h-[300px] items-center justify-center">
            {/* Box matches the photo's 3:2 ratio so the edge mask lands on the photo's own borders. */}
            <div className="relative aspect-[3/2] w-full max-w-[880px]">
            {catalog.flatMap((m, mi) => m.colors.map((c, ci) => {
              const active = mi === modelIdx && ci === colorIdx;
              return (
                <Image
                  key={`${m.slug}-${c.key}`}
                  src={c.image}
                  alt={active ? `Montura ${m.name} color ${c.name}` : ""}
                  aria-hidden={!active}
                  fill
                  priority={mi === 0 && ci === 0}
                  sizes="(min-width: 1024px) 70vw, 100vw"
                  className={cn(
                    "object-contain object-center transition-all duration-700 ease-out [mask-image:radial-gradient(closest-side,black_72%,transparent_100%)]",
                    active ? "scale-100 opacity-100" : "pointer-events-none scale-[1.03] opacity-0",
                  )}
                />
              );
            }))}
            </div>
            <div className="absolute inset-y-0 left-2 flex items-center">
              <button type="button" onClick={() => step(-1)} aria-label="Anterior" className="grid size-9 place-items-center rounded-full bg-white/70 text-neutral-600 shadow-soft backdrop-blur transition hover:bg-white"><ChevronLeft className="size-4" /></button>
            </div>
            <div className="absolute inset-y-0 right-3 flex items-center">
              <button type="button" onClick={() => step(1)} aria-label="Siguiente" className="grid size-9 place-items-center rounded-full bg-white/70 text-neutral-600 shadow-soft backdrop-blur transition hover:bg-white"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        </div>

        {/* Configurator bar */}
        <div className="relative z-10 flex flex-col gap-4 border-t border-black/5 bg-white/45 px-6 py-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-4">
            <p className="text-xs text-neutral-500">
              <span className="block text-[11px] tracking-wide uppercase">Color</span>
              <span className="text-sm font-medium text-neutral-800">{color.name}</span>
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="Color de la montura">
              {model.colors.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={i === colorIdx}
                  aria-label={c.name}
                  title={c.name}
                  onClick={() => setColorIdx(i)}
                  className={cn("size-8 rounded-full border border-black/10 shadow-[inset_0_1px_2px_rgba(0,0,0,.25)] ring-offset-2 ring-offset-[#e9eaed] transition", i === colorIdx ? "scale-110 ring-2 ring-neutral-800" : "hover:scale-105")}
                  style={{ background: `radial-gradient(circle at 35% 30%, color-mix(in oklch, ${c.swatch} 70%, white), ${c.swatch} 70%)` }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} />}>
                <Button variant="outline" className="bg-white/70" disabled><Sparkles /> Probar en el rostro</Button>
              </TooltipTrigger>
              <TooltipContent>Prueba virtual — próximamente</TooltipContent>
            </Tooltip>
            {quoteHref ? (
              <Link href={quoteHref(color.key)} className={buttonVariants()}><FileText /> Agregar a cotización</Link>
            ) : (
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} />}><Button disabled><FileText /> Agregar a cotización</Button></TooltipTrigger>
                <TooltipContent>Catálogo de demostración</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </section>

      {/* Model strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {catalog.map((m, i) => (
          <button
            key={m.slug}
            type="button"
            onClick={() => selectModel(i)}
            aria-pressed={i === modelIdx}
            className={cn("group overflow-hidden rounded-2xl border bg-surface text-left shadow-soft transition", i === modelIdx ? "border-brand ring-3 ring-brand/15" : "hover:-translate-y-0.5 hover:shadow-lift")}
          >
            <div className="relative aspect-[3/2] bg-[#e7e8eb]">
              <Image src={m.colors[0]!.image} alt="" fill sizes="(min-width: 1024px) 16vw, 45vw" className="object-cover transition duration-500 group-hover:scale-105" />
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <div className="flex -space-x-1">{m.colors.slice(0, 5).map((c) => <span key={c.key} className="size-3 rounded-full border border-white" style={{ background: c.swatch }} />)}</div>
              </div>
              <p className="text-xs text-muted-foreground tabular">{formatMoney(m.price)} · {m.shape}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
