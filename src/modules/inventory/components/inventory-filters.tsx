"use client";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { BranchSwitcher } from "@/components/app-shell/branch-switcher";
import { NativeSelect } from "@/components/shared/native-select";
import { PatientSearch } from "@/modules/patients/components/patient-search";
import { AVAILABILITY } from "../constants";

/** URL-driven filters for the product list; every change goes back to page 1. Combine with the search box. */
export function InventoryFilters({ categories, brands }: { categories: { id: string; name: string }[]; brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [resetKey, setResetKey] = useState(0); // remounts the search box so "Limpiar" also empties its text

  const set = (key: string, value: string, fallback = "") => {
    const next = new URLSearchParams(params);
    if (value && value !== fallback) next.set(key, value); else next.delete(key);
    next.delete("pagina");
    next.delete("filtro");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };
  const availability = params.get("disponibilidad") ?? (params.get("filtro") === "bajo" ? "low" : params.get("filtro") === "agotado" ? "out" : "todas");
  const active = ["q", "categoria", "marca", "estado", "disponibilidad", "filtro"].some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-3 border-b p-4" aria-busy={pending}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <PatientSearch key={resetKey} placeholder="Nombre, SKU, marca, modelo, código de barras…" label="Buscar productos" />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="col-span-2 sm:col-span-1"><BranchSwitcher /></div>
          <NativeSelect aria-label="Categoría" value={params.get("categoria") ?? ""} onChange={(e) => set("categoria", e.target.value)} className="h-8 sm:w-44">
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Disponibilidad" value={availability} onChange={(e) => set("disponibilidad", e.target.value, "todas")} className="h-8 sm:w-44">
            {AVAILABILITY.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </NativeSelect>
          {brands.length > 0 && (
            <NativeSelect aria-label="Marca" value={params.get("marca") ?? ""} onChange={(e) => set("marca", e.target.value)} className="h-8 sm:w-40">
              <option value="">Todas las marcas</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          )}
          <NativeSelect aria-label="Estado" value={params.get("estado") ?? "activos"} onChange={(e) => set("estado", e.target.value, "activos")} className="h-8 sm:w-36">
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Activos e inactivos</option>
          </NativeSelect>
          {active && (
            <button type="button" onClick={() => { setResetKey((k) => k + 1); startTransition(() => router.replace(pathname)); }}
              className="col-span-2 inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground sm:col-span-1">
              <X className="size-4" /> Limpiar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
