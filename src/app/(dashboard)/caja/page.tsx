import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import { ModuleRoadmap } from "@/components/shared/module-roadmap";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Caja y cartera" };

export default async function CashPage() {
  await requirePermission("cash.manage");
  return (
    <ModuleRoadmap
      title="Caja y cartera"
      icon={Wallet}
      phase={1}
      pitch="Abre y cierra la caja de cada sede, cuadra el efectivo y controla quién te debe."
      features={[
        "Apertura de caja con base inicial por sede y usuario",
        "Cierre con arqueo: efectivo contado vs. esperado, por medio de pago",
        "Ingresos y egresos de caja (gastos menores, retiros)",
        "Cartera: saldos pendientes por cliente y antigüedad",
        "Registro de abonos con recibo",
        "Reporte de caja diario por sede",
      ]}
    />
  );
}
