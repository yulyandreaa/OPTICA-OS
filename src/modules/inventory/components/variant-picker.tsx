"use client";
import { Command as CommandPrimitive } from "cmdk";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { searchVariantsAction, type VariantOption } from "../actions";
import { formatQty } from "../constants";

/** Type a name, SKU or barcode; shows the units available in `branchId`. The server does the search. */
export function VariantPicker({ branchId, onPick, placeholder = "Busca por nombre, SKU o código de barras", invalid, autoFocus, exclude = [] }: {
  branchId: string; onPick: (v: VariantOption) => void; placeholder?: string; invalid?: boolean; autoFocus?: boolean; exclude?: string[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<VariantOption[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => startSearch(async () => setOptions(await searchVariantsAction(query, branchId))), 200);
    return () => clearTimeout(t);
  }, [query, branchId, open]);
  const visible = options.filter((o) => !exclude.includes(o.id));

  return (
    <CommandPrimitive shouldFilter={false} loop className="relative" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      <div className="relative">
        {searching ? <Loader2 className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          : <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />}
        <CommandPrimitive.Input value={query} onValueChange={(v) => { setQuery(v); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          placeholder={placeholder} autoFocus={autoFocus} aria-invalid={invalid} autoComplete="off"
          className={cn("h-9 w-full rounded-lg border border-input bg-surface pr-3 pl-8 text-sm shadow-soft outline-none placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive")} />
      </div>
      {open && (
        <CommandPrimitive.List onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {!searching && visible.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{query ? "Sin productos con ese nombre, SKU o código." : "Escribe para buscar."}</p>}
          {visible.map((o) => (
            <CommandItem key={o.id} value={o.id} onSelect={() => { onPick(o); setQuery(""); setOpen(false); }}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                <span className="block font-mono text-xs text-muted-foreground">{o.sku}</span>
              </span>
              <span className={cn("text-xs tabular", o.quantity > 0 ? "text-muted-foreground" : "text-destructive")}>{formatQty(o.quantity)} disp.</span>
            </CommandItem>
          ))}
        </CommandPrimitive.List>
      )}
    </CommandPrimitive>
  );
}
