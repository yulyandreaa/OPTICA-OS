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

/**
 * Date field styled like <NativeSelect/>, with month/year dropdowns so distant dates (e.g. birth dates)
 * are two clicks away. Value is a "yyyy-MM-dd" string ("" when empty), ready for RHF `Controller`.
 */
export function DatePicker({
  id, value, onChange, onBlur, fromYear = 1900, toDate = new Date(), placeholder = "Selecciona una fecha", invalid, className,
}: {
  id?: string; value: string; onChange: (value: string) => void; onBlur?: () => void;
  fromYear?: number; toDate?: Date; placeholder?: string; invalid?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);

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
      </PopoverContent>
    </Popover>
  );
}
