"use client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** "yyyy-MM-dd" → local Date (avoids the UTC shift of `new Date("yyyy-MM-dd")`). */
function parseIsoDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

const toDisplay = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

/** "15031990" / "15/3/1990" → "1990-03-15"; null when it isn't a real calendar date. */
export function parseTypedDate(text: string): string | null {
  const m = /^(\d{1,2})[/.-]?(\d{1,2})[/.-]?(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Date field styled like <NativeSelect/>, with month/year dropdowns so distant dates (e.g. birth dates)
 * are two clicks away. Value is a "yyyy-MM-dd" string ("" when empty), ready for RHF `Controller`.
 */
export function DatePicker({
  id, value, onChange, onBlur, fromYear = 1900, toDate = new Date(), placeholder = "Selecciona una fecha", invalid, className, typeable,
}: {
  id?: string; value: string; onChange: (value: string) => void; onBlur?: () => void;
  fromYear?: number; toDate?: Date; placeholder?: string; invalid?: boolean; className?: string;
  /** Lets the user type dd/mm/aaaa (faster and less error-prone for birth dates); the calendar stays one click away. */
  typeable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const [text, setText] = useState(toDisplay(value));
  // Re-sync the typed text when the value changes from outside (calendar pick, form reset).
  const [synced, setSynced] = useState(value);
  if (synced !== value) { setSynced(value); setText(toDisplay(value)); }

  const calendar = (
    <Calendar
      mode="single"
      locale={es}
      captionLayout="dropdown"
      reverseYears
      startMonth={new Date(fromYear, 0)}
      endMonth={toDate}
      disabled={{ after: toDate }}
      defaultMonth={selected ?? toDate}
      selected={selected}
      onSelect={(date) => {
        onChange(date ? format(date, "yyyy-MM-dd") : "");
        if (date) { setOpen(false); onBlur?.(); }
      }}
    />
  );

  if (typeable) {
    const commit = () => {
      const trimmed = text.trim();
      // Unparseable text is passed through so the form's schema reports "Fecha no válida".
      onChange(trimmed === "" ? "" : parseTypedDate(trimmed) ?? trimmed);
      onBlur?.();
    };
    return (
      <div className={cn("relative", className)}>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/aaaa"
          aria-invalid={invalid}
          value={text}
          onChange={(e) => {
            // Auto-insert slashes while typing digits: 15031990 → 15/03/1990.
            const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
            const typedSlash = /[/.-]/.test(e.target.value);
            const next = typedSlash ? e.target.value.slice(0, 10) : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
            setText(next);
            // A complete, real date is committed right away so dependent UI (e.g. the age) updates while typing.
            const iso = next.length >= 8 ? parseTypedDate(next) : null;
            if (iso && iso !== value) { setSynced(iso); onChange(iso); }
          }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          className="h-9 w-full rounded-lg border border-input bg-surface pr-10 pl-3 text-sm shadow-soft outline-none transition-colors tabular focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger aria-label="Abrir calendario"
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
            <CalendarDays className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">{calendar}</PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) onBlur?.(); }}>
      <PopoverTrigger
        id={id}
        aria-invalid={invalid}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-surface px-3 text-left text-sm shadow-soft outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 aria-invalid:border-destructive",
          !selected && "text-muted-foreground",
          className,
        )}
      >
        {selected ? format(selected, "d 'de' MMMM 'de' yyyy", { locale: es }) : placeholder}
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {calendar}
      </PopoverContent>
    </Popover>
  );
}
