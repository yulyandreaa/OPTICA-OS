import { Box, Eye, Glasses, Package, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { STOCK_STATUS, type Kind } from "../constants";

const KIND_ICON = { frame: Glasses, ophthalmic_lens: Sparkles, contact_lens: Eye, supply: Package, service: Box } as const;

export function StockBadge({ status }: { status: string }) {
  const s = STOCK_STATUS[status] ?? STOCK_STATUS.na!;
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

/** Photo when there is one, otherwise the frame color or the category icon. */
export function ProductThumb({ imageUrl, colorHex, kind, className }: { imageUrl?: string | null; colorHex?: string | null; kind?: string | null; className?: string }) {
  const Icon = KIND_ICON[(kind ?? "supply") as Kind] ?? Package;
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URLs; next/image would need each host whitelisted
    return <img src={imageUrl} alt="" loading="lazy" className={cn("size-10 shrink-0 rounded-lg border bg-muted object-cover", className)} />;
  }
  return (
    <span className={cn("relative grid size-10 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground", className)}>
      <Icon className="size-4" />
      {colorHex && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface" style={{ backgroundColor: colorHex }} />}
    </span>
  );
}
