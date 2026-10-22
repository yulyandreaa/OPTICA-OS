"use client";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchSelectOption = { value: string; label: string };

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Options whose label (or any word of it) starts with the text, ignoring accents and case. Keeps the given order. */
export function filterOptions(options: readonly SearchSelectOption[], query: string) {
  const q = normalize(query.trim());
  if (!q) return options;
  return options.filter((o) => {
    const key = normalize(o.label);
    return key.startsWith(q) || key.split(/[\s,-]+/).some((w) => w.startsWith(q));
  });
}

/**
 * Select you can type into: opens a list below the field (same width) and filters it as you type.
 * Erasing the text clears the value; unconfirmed text reverts. Styled like <NativeSelect/>.
 */
export function SearchSelect({ id, value, options, onChange, onBlur, emptyText = "Sin resultados.", invalid, className }: {
  id?: string; value: string | null | undefined; options: readonly SearchSelectOption[];
  onChange: (value: string) => void; onBlur?: () => void; emptyText?: string; invalid?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not editing, show the selected label
  const visible = useMemo(() => filterOptions(options, query ?? ""), [options, query]);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value ?? "";

  const close = () => { setOpen(false); setQuery(null); onBlur?.(); };

  return (
    <CommandPrimitive shouldFilter={false} loop className={cn("relative", className)}
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <div className="relative">
        <CommandPrimitive.Input
          id={id}
          aria-invalid={invalid}
          placeholder="—"
          autoComplete="off"
          value={query ?? selectedLabel}
          onValueChange={(v) => { setQuery(v); setOpen(true); }}
          onFocus={(e) => { e.currentTarget.select(); setOpen(true); }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            if (query !== null && !query.trim() && value) onChange("");
            close();
          }}
          className={cn(
            "h-9 w-full rounded-lg border border-input bg-surface px-3 pr-8 text-sm shadow-soft outline-none transition-colors placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive",
          )}
        />
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && (
        <CommandPrimitive.List
          // Keep focus in the input while clicking an option, so onBlur doesn't close the list first.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <CommandPrimitive.Empty className="py-4 text-center text-sm text-muted-foreground">{emptyText}</CommandPrimitive.Empty>
          {visible.map((o) => (
            <CommandItem key={o.value} value={o.value} data-checked={o.value === value}
              onSelect={() => { onChange(o.value); close(); }}>
              <span className="truncate">{o.label}</span>
            </CommandItem>
          ))}
        </CommandPrimitive.List>
      )}
    </CommandPrimitive>
  );
}
