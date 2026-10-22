"use client";
import { Loader2, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/** URL-driven search (server does the filtering; nothing is loaded client-side). */
export function PatientSearch({ placeholder = "Nombre, documento o celular", label = "Buscar pacientes" }: { placeholder?: string; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") === value) return;
      const next = new URLSearchParams(params);
      if (value) next.set("q", value); else next.delete("q");
      next.delete("cursor");
      next.delete("pagina");
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    }, 250);
    return () => clearTimeout(t);
  }, [value, params, pathname, router]);

  return (
    <div className="relative w-full sm:max-w-xs">
      {pending ? <Loader2 className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        : <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-lg border border-input bg-surface pr-3 pl-8 text-sm shadow-soft outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
    </div>
  );
}
