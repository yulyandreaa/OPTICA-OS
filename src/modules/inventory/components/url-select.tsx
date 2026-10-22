"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { NativeSelect } from "@/components/shared/native-select";

/** Select bound to one search param; changing it drops the pagination params. */
export function UrlSelect({ param, label, options, className, reset = [] }: {
  param: string; label: string; options: readonly { key: string; label: string }[]; className?: string; reset?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  return (
    <div className={className}>
    <NativeSelect aria-label={label} value={params.get(param) ?? ""} disabled={pending} className="h-full"
      onChange={(e) => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set(param, e.target.value); else next.delete(param);
        for (const k of reset) next.delete(k);
        startTransition(() => router.replace(`${pathname}?${next.toString()}`));
      }}>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </NativeSelect>
    </div>
  );
}
