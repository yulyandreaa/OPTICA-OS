"use client";
import { CalendarRange, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { DatePicker } from "@/components/shared/date-picker";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { PERIOD_OPTIONS, type PeriodKey } from "../period";

/**
 * Period selector; the choice lives in the URL so every section, reload and shared link agree.
 * With `keepParams`, the page's other filters survive a period change (pagination restarts).
 */
export function PeriodFilter({ value, from, to, keepParams = false }: { value: PeriodKey; from: string; to: string; keepParams?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState<PeriodKey>(value);
  const [desde, setDesde] = useState(from);
  const [hasta, setHasta] = useState(to);

  const go = (params: Record<string, string>) => {
    const next = new URLSearchParams(keepParams ? current : undefined);
    for (const k of ["periodo", "desde", "hasta", "pagina"]) next.delete(k);
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const onSelect = (next: PeriodKey) => {
    setKey(next);
    if (next !== "rango") go(next === "mes" ? {} : { periodo: next });
  };
  const rangeValid = desde !== "" && hasta !== "" && desde <= hasta;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarRange className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <NativeSelect aria-label="Período" value={key} onChange={(e) => onSelect(e.target.value as PeriodKey)} className="h-8 pl-8 text-sm">
          {PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </NativeSelect>
      </div>
      {key === "rango" && (
        <>
          <DatePicker value={desde} onChange={setDesde} fromYear={2020} placeholder="Desde" className="h-8 w-auto" />
          <DatePicker value={hasta} onChange={setHasta} fromYear={2020} placeholder="Hasta" className="h-8 w-auto" />
          <Button size="sm" disabled={!rangeValid || pending} onClick={() => go({ periodo: "rango", desde, hasta })}>Aplicar</Button>
        </>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Actualizando" />}
    </div>
  );
}
