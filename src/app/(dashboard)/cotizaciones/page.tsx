import { redirect } from "next/navigation";

/** Quotes live in the "Cotizaciones" tab of Ventas y cotizaciones (one list, same filters). */
export default function QuotesPage() {
  redirect("/ventas?tab=cotizaciones");
}
