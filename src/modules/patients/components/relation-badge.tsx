import { cn } from "@/lib/utils";
import { RELATIONS, type Relation } from "../schemas";

/** Same accents as the directory cards: customer = blue, patient = green, both = violet. */
const STYLE: Record<Relation, string> = {
  customer: "bg-series-1/10 text-series-1",
  patient: "bg-series-3/12 text-series-3",
  both: "bg-series-7/10 text-series-7",
};

export function RelationBadge({ relation, className }: { relation: Relation; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STYLE[relation], className)}>{RELATIONS[relation]}</span>;
}
