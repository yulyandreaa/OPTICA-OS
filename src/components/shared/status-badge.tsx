import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[oklch(0.5_0.12_60)]",
  danger: "bg-danger-soft text-destructive",
} as const;
export type Tone = keyof typeof TONES;

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground", brand: "text-brand", success: "text-success",
  warning: "text-[oklch(0.5_0.12_60)]", danger: "text-destructive",
};

export function StatusBadge({ tone = "neutral", children, dot = true, className }: { tone?: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}
