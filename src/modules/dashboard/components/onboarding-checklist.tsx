import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/components/shared/panel";
import { cn } from "@/lib/utils";

export interface ChecklistItem { label: string; done: boolean; href: string; soon?: boolean }

export function OnboardingChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <Panel title="Configura tu óptica" description={`${done} de ${items.length} pasos`} bodyClassName="p-0">
      <div className="px-4 pt-3"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${(done / items.length) * 100}%` }} /></div></div>
      <ul className="p-2">
        {items.map((i) => (
          <li key={i.label}>
            <Link href={i.href} className={cn("flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted", i.done && "text-muted-foreground")}>
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", i.done && "border-success bg-success text-white")}>
                {i.done && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className={cn("flex-1", i.done && "line-through")}>{i.label}</span>
              {i.soon ? <span className="text-[10px] text-muted-foreground">pronto</span> : !i.done && <ChevronRight className="size-4 text-muted-foreground" />}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
