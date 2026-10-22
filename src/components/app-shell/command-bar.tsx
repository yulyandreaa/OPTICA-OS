"use client";
import { CornerDownLeft, List, Search, UserPlus, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { globalSearchAction, type SearchHit } from "@/modules/search/actions";
import { useShell } from "./shell-context";
import { UNIVERSAL_ACTIONS } from "./universal-action";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function CommandBar() {
  const shell = useShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, startSearch] = useTransition();
  const { commandOpen: open, setCommandOpen: setOpen } = shell;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
        const action = UNIVERSAL_ACTIONS.find((a) => "shortcut" in a && a.shortcut === e.key.toUpperCase() && shell.can(a.permission));
        if (action) { e.preventDefault(); router.push(action.href); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, router, shell]);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(() => startSearch(async () => setHits(await globalSearchAction(query))), 180);
    return () => clearTimeout(t);
  }, [query]);
  const visibleHits = query.trim().length < 2 ? [] : hits;

  const go = (href: string) => { setOpen(false); setQuery(""); router.push(href); };
  const q = query.trim();
  const canCreate = shell.can("patients.create");

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Buscar clientes y pacientes" description="Busca por nombre, documento, teléfono o correo" className="sm:max-w-xl">
      {/* CommandDialog is only the dialog shell: cmdk's parts must live inside <Command> or they crash.
          The server already filters, so cmdk's own fuzzy filter is off. */}
      <Command shouldFilter={false}>
      <CommandInput placeholder="Nombre, documento, teléfono o correo…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[420px]">
        {q.length < 2 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Escribe al menos 2 letras o números para buscar clientes y pacientes.</p>
        ) : visibleHits.length === 0 ? (
          <>
            <p className="px-4 pt-6 pb-2 text-center text-sm text-muted-foreground">
              {searching ? "Buscando…" : `No encontramos a nadie con “${q}”. Prueba con el documento o el teléfono.`}
            </p>
            {!searching && canCreate && (
              <CommandGroup>
                <CommandItem value="nuevo" onSelect={() => go("/pacientes/nuevo")}><UserPlus className="size-4" /> Crear nuevo registro</CommandItem>
              </CommandGroup>
            )}
          </>
        ) : (
          <CommandGroup heading="Clientes y pacientes">
            {visibleHits.map((h) => (
              <CommandItem key={h.id} value={h.id} onSelect={() => go(h.href)}>
                <UserRound className="size-4" />
                <span className="min-w-0">
                  <span className="block truncate">{h.title}{h.badge && <span className="ml-2 text-xs text-muted-foreground">{h.badge}</span>}</span>
                  <span className="block truncate text-xs text-muted-foreground tabular">{h.subtitle}</span>
                </span>
              </CommandItem>
            ))}
            <CommandItem value="directorio" onSelect={() => go(`/pacientes?q=${encodeURIComponent(q)}`)} className="text-muted-foreground">
              <List className="size-4" /> Ver todos los resultados en el directorio
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><CornerDownLeft className="size-3" /> abrir ficha</span>
        <span>↑↓ navegar</span>
        <span className="ml-auto">esc cerrar</span>
      </div>
      </Command>
    </CommandDialog>
  );
}

export function SearchTrigger() {
  const { setCommandOpen } = useShell();
  return (
    <button
      type="button"
      onClick={() => setCommandOpen(true)}
      className="flex h-8 w-full max-w-sm items-center gap-2 rounded-lg border bg-surface px-2.5 text-sm text-muted-foreground shadow-soft outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <Search className="size-4" />
      <span className="truncate">Buscar clientes y pacientes…</span>
      <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}
