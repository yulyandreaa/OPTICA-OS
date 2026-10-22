"use client";
import { CornerDownLeft, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { globalSearchAction, type SearchHit } from "@/modules/search/actions";
import { NAV_ADMIN, NAV_MAIN } from "./nav-config";
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
  const pages = [...NAV_MAIN, ...NAV_ADMIN].filter((i) => shell.can(i.permission));
  const actions = UNIVERSAL_ACTIONS.filter((a) => shell.can(a.permission));

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Buscar" description="Busca pacientes, documentos, teléfonos o acciones" className="sm:max-w-xl">
      <CommandInput placeholder="Busca un paciente, documento, teléfono o acción…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>{searching ? "Buscando…" : "Sin resultados. Prueba con el documento o el teléfono."}</CommandEmpty>
        {visibleHits.length > 0 && (
          <CommandGroup heading="Pacientes">
            {visibleHits.map((h) => (
              <CommandItem key={h.id} value={`${h.title} ${h.subtitle} ${h.id}`} onSelect={() => go(h.href)}>
                <UserRound className="size-4" />
                <span className="truncate">{h.title}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground tabular">{h.subtitle}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Acciones">
          {actions.map((a) => (
            <CommandItem key={a.label} value={`nuevo ${a.label}`} onSelect={() => go(a.href)}>
              <a.icon className="size-4" /> Nuevo: {a.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Ir a">
          {pages.map((p) => (
            <CommandItem key={p.href} value={`ir ${p.label}`} onSelect={() => go(p.href)}>
              <p.icon className="size-4" /> {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><CornerDownLeft className="size-3" /> abrir</span>
        <span>↑↓ navegar</span>
        <span className="ml-auto">esc cerrar</span>
      </div>
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
      <span className="truncate">Buscar pacientes, documentos…</span>
      <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}
