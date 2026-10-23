"use client";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { NativeSelect } from "@/components/shared/native-select";
import { PatientSearch } from "@/modules/patients/components/patient-search";
import { PAYMENT_OPTIONS, STATUS_OPTIONS, type TabKey } from "../list-params";

/** URL-driven filters for the operations list; every change goes back to page 1 and combines with the search box. */
export function SalesFilters({ tab, branches, sellers, branchValue, allowAllBranches }: {
  tab: TabKey; branches: { id: string; name: string }[]; sellers: { id: string; name: string }[]; branchValue: string; allowAllBranches: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [resetKey, setResetKey] = useState(0); // remounts the search box so "Limpiar" also empties its text

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("pagina");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };
  const clear = () => {
    const next = new URLSearchParams();
    for (const k of ["tab", "periodo", "desde", "hasta"]) { const v = params.get(k); if (v) next.set(k, v); }
    setResetKey((k) => k + 1);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };
  const statuses = STATUS_OPTIONS[tab];
  const active = ["q", "estado", "pago", "asesor", "sede"].some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center" aria-busy={pending}>
      <PatientSearch key={resetKey} placeholder="Número, cliente, documento, producto o asesor" label="Buscar operaciones" />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {branches.length > 1 && (
          <NativeSelect aria-label="Sede" value={branchValue} onChange={(e) => set("sede", e.target.value)} className="h-8 sm:w-40">
            {allowAllBranches && <option value="todas">Todas las sedes</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        )}
        {statuses.length > 0 && (
          <NativeSelect aria-label="Estado" value={params.get("estado") ?? ""} onChange={(e) => set("estado", e.target.value)} className="h-8 sm:w-44">
            <option value="">Todos los estados</option>
            {statuses.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </NativeSelect>
        )}
        {(tab === "ventas" || tab === "anulaciones") && (
          <NativeSelect aria-label="Estado de pago" value={params.get("pago") ?? ""} onChange={(e) => set("pago", e.target.value)} className="h-8 sm:w-44">
            <option value="">Cualquier estado de pago</option>
            {PAYMENT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </NativeSelect>
        )}
        {sellers.length > 1 && (
          <NativeSelect aria-label="Asesor" value={params.get("asesor") ?? ""} onChange={(e) => set("asesor", e.target.value)} className="h-8 sm:w-44">
            <option value="">Todos los asesores</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        )}
        {active && (
          <button type="button" onClick={clear}
            className="col-span-2 inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:col-span-1">
            <X className="size-4" /> Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
