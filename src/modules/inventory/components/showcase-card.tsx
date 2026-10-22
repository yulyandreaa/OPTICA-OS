import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { DEMO_CATALOG } from "../catalog/demo-catalog";

/** Compact entry point to the showcase for the home dashboard. */
export function ShowcaseCard() {
  const hero = DEMO_CATALOG[0]!;
  return (
    <Link href="/inventario/vitrina" className="group relative block overflow-hidden rounded-xl border shadow-soft"
      style={{ background: `linear-gradient(to bottom, ${hero.colors[0]!.stage[0]}, ${hero.colors[0]!.stage[1]})` }}>
      <div className="relative aspect-[16/9]">
        <Image src={hero.colors[0]!.image} alt={`Montura ${hero.name}`} fill sizes="(min-width: 1280px) 30vw, 90vw"
          className="object-cover transition duration-700 group-hover:scale-[1.04]" />
      </div>
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div>
          <p className="text-[11px] font-medium tracking-[0.16em] text-neutral-500 uppercase">Vitrina</p>
          <p className="text-2xl font-extralight text-neutral-800 lowercase">modelo {hero.name}</p>
        </div>
        <span className="grid size-8 place-items-center rounded-full bg-white/70 text-neutral-700 backdrop-blur transition group-hover:bg-white"><ArrowUpRight className="size-4" /></span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-4">
        {hero.colors.map((c) => <span key={c.key} className="size-4 rounded-full border border-white/80 shadow-soft" style={{ background: c.swatch }} />)}
        <span className="ml-2 text-xs text-neutral-600">{DEMO_CATALOG.length} modelos · muéstralos en la tablet</span>
      </div>
    </Link>
  );
}
