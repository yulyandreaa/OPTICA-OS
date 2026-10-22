import { CalendarDays, ClipboardList, CreditCard, MessageCircle, Receipt } from "lucide-react";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { serverEnv } from "@/lib/env";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Integraciones" };

export default async function IntegrationsPage() {
  await requirePermission("integrations.manage");
  const env = serverEnv();
  const cards = [
    { icon: MessageCircle, name: "WhatsApp", desc: "Confirmaciones, recordatorios y aviso de gafas listas (WhatsApp Cloud API).", provider: env.NOTIFICATION_PROVIDER },
    { icon: Receipt, name: "Facturación electrónica", desc: "Emisión DIAN mediante proveedor tecnológico.", provider: env.EINVOICE_PROVIDER },
    { icon: ClipboardList, name: "RIPS / Minsalud", desc: "Generación, validación y envío de RIPS.", provider: env.RIPS_PROVIDER },
    { icon: CreditCard, name: "Wompi", desc: "Pagos con tarjeta, PSE y Nequi.", provider: env.PAYMENT_PROVIDER },
    { icon: CalendarDays, name: "Google Calendar", desc: "Sincroniza la agenda de cada especialista.", provider: "none" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((c) => (
        <article key={c.name} className="flex flex-col gap-4 rounded-xl border bg-surface p-5 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-muted"><c.icon className="size-5 text-muted-foreground" strokeWidth={1.75} /></div>
            {c.provider === "mock" ? <StatusBadge tone="warning">Modo sandbox</StatusBadge> : <StatusBadge>No conectado</StatusBadge>}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{c.name}</h3>
            <p className="text-sm text-muted-foreground">{c.desc}</p>
          </div>
          <Button variant="outline" size="sm" className="mt-auto self-start" disabled>Configurar</Button>
        </article>
      ))}
    </div>
  );
}
