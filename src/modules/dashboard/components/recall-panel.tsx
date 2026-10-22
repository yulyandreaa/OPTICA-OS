import { MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";

export function RecallPanel({ items, total }: {
  items: { patient_id: string | null; full_name: string | null; phone: string | null; months_since: number | null }[]; total: number;
}) {
  return (
    <Panel title="Oportunidades" description={total > 0 ? `${total} pacientes con control visual vencido` : "Pacientes por recuperar"} bodyClassName="p-0"
      action={<Sparkles className="size-4 text-brand" />}>
      {items.length === 0 ? (
        <EmptyState icon={Sparkles} title="Sin controles vencidos" description="Cuando un paciente cumpla 12 meses desde su última consulta aparecerá aquí." compact />
      ) : (
        <ul className="divide-y">
          {items.map((p) => (
            <li key={p.patient_id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <Link href={`/pacientes/${p.patient_id}`} className="block truncate text-sm hover:underline">{p.full_name}</Link>
                <p className="text-xs text-muted-foreground">Última consulta hace {p.months_since} meses</p>
              </div>
              {p.phone && (
                <a
                  href={`https://wa.me/${p.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "57$1")}?text=${encodeURIComponent(`Hola ${p.full_name?.split(" ")[0]}, ya es momento de tu control visual anual. ¿Te agendamos?`)}`}
                  target="_blank" rel="noreferrer" aria-label={`Escribir a ${p.full_name} por WhatsApp`}
                  className="grid size-8 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-success-soft hover:text-success"
                >
                  <MessageCircle className="size-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
