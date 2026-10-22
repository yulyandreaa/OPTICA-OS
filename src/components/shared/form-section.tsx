import type { ReactNode } from "react";

/** Form block: title and help text on the left, fields on the right (stacked on mobile). */
export function FormSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-b py-8 first:pt-0 last:border-0 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  );
}
