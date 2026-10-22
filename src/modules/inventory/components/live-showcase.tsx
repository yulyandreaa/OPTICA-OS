"use client";
import type { FrameModel } from "../catalog/demo-catalog";
import { Showcase } from "./showcase";

/** Showcase bound to the real catalog: "Agregar a cotización" opens the quote builder with that SKU. */
export function LiveShowcase({ catalog, skuToVariant }: { catalog: FrameModel[]; skuToVariant: Record<string, string> }) {
  return <Showcase catalog={catalog} quoteHref={(sku) => `/cotizaciones/nueva?variante=${skuToVariant[sku] ?? ""}`} />;
}
