import { Skeleton } from "@/components/ui/skeleton";
import { LogoMark } from "@/components/shared/logo";

export function PageSkeleton() {
  return (
    <div className="grid gap-6" aria-busy aria-label="Cargando">
      <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-72" /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]"><Skeleton className="h-80 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-3 lg:flex">
        <div className="flex items-center gap-2.5 p-1.5"><LogoMark className="size-8" /><Skeleton className="h-4 w-28" /></div>
        <div className="grid gap-2">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-7 rounded-lg" />)}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-6"><Skeleton className="h-8 w-full max-w-sm rounded-lg" /></div>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><PageSkeleton /></main>
      </div>
    </div>
  );
}
