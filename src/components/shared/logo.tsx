import { cn } from "@/lib/utils";

/** Brand mark: a lens with an iris — two offset rings. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle cx="16" cy="16" r="8.5" fill="none" strokeWidth="2.4" className="stroke-primary-foreground/90" />
      <circle cx="16" cy="16" r="3.6" className="fill-brand" />
      <circle cx="17.4" cy="14.6" r="1.1" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className, name = "Óptica OS" }: { className?: string; name?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span>{name}</span>
    </span>
  );
}
