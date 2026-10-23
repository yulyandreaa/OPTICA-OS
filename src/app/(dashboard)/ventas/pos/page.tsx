import { redirect } from "next/navigation";

/** The old point of sale became "Nueva venta"; keeps old links (and ?paciente=) working. */
export default async function PosPage(props: PageProps<"/ventas/pos">) {
  const sp = await props.searchParams;
  redirect(typeof sp.paciente === "string" ? `/ventas/nueva?cliente=${encodeURIComponent(sp.paciente)}` : "/ventas/nueva");
}
