"use client";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatQty } from "../constants";
import { setMinStockAction } from "../actions";

/** Inline editor for a branch's minimum. Changes the alert threshold only, never the stock. */
export function MinStockEditor({ variantId, branchId, value, label }: { variantId: string; branchId: string; value: number; label: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [pending, startTransition] = useTransition();
  const save = () => startTransition(async () => {
    const res = await setMinStockAction(variantId, branchId, Number(draft));
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message);
    setEditing(false);
    router.refresh();
  });
  if (!editing) {
    return (
      <button type="button" onClick={() => { setDraft(String(value)); setEditing(true); }} aria-label={`Cambiar mínimo de ${label}`}
        className="group inline-flex items-center gap-1 rounded px-1 tabular hover:bg-muted">
        {formatQty(value)} <Pencil className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))} aria-label={`Mínimo de ${label}`}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="h-7 w-16 rounded-md border bg-surface px-2 text-right text-sm tabular outline-none focus-visible:ring-3 focus-visible:ring-ring/40" />
      <button type="button" onClick={save} disabled={pending || draft === ""} aria-label="Guardar mínimo" className="grid size-7 place-items-center rounded-md hover:bg-muted">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </button>
      <button type="button" onClick={() => setEditing(false)} aria-label="Cancelar" className="grid size-7 place-items-center rounded-md hover:bg-muted"><X className="size-3.5" /></button>
    </span>
  );
}
