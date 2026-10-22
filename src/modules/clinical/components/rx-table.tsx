import { cn } from "@/lib/utils";
import { formatDiopter } from "../constants";

interface Rx {
  od_sphere: number | null; od_cylinder: number | null; od_axis: number | null; od_add: number | null; od_prism?: number | null; od_base?: string | null; od_va?: string | null;
  oi_sphere: number | null; oi_cylinder: number | null; oi_axis: number | null; oi_add: number | null; oi_prism?: number | null; oi_base?: string | null; oi_va?: string | null;
}

/** Prescription table as it's printed: OD/OI × Esfera, Cilindro, Eje, Adición, Prisma, AV. */
export function RxTable({ rx, className }: { rx: Rx; className?: string }) {
  const rows = [
    { eye: "OD", s: rx.od_sphere, c: rx.od_cylinder, a: rx.od_axis, add: rx.od_add, p: rx.od_prism, b: rx.od_base, va: rx.od_va },
    { eye: "OI", s: rx.oi_sphere, c: rx.oi_cylinder, a: rx.oi_axis, add: rx.oi_add, p: rx.oi_prism, b: rx.oi_base, va: rx.oi_va },
  ];
  return (
    <table className={cn("w-full text-sm", className)}>
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="py-2 text-left font-medium" />
          {["Esfera", "Cilindro", "Eje", "Adición", "Prisma", "AV"].map((h) => <th key={h} className="py-2 text-center font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.eye} className="border-b last:border-0">
            <th className="py-2.5 text-left font-semibold">{r.eye}</th>
            <td className="text-center tabular">{formatDiopter(r.s)}</td>
            <td className="text-center tabular">{r.c ? formatDiopter(r.c) : "—"}</td>
            <td className="text-center tabular">{r.a !== null && r.a !== undefined ? `${r.a}°` : "—"}</td>
            <td className="text-center tabular">{r.add ? formatDiopter(r.add) : "—"}</td>
            <td className="text-center tabular">{r.p ? `${r.p}Δ ${r.b ?? ""}` : "—"}</td>
            <td className="text-center tabular">{r.va ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
