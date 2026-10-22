"use client";
import { ArrowLeftRight, ChevronDown, ClipboardList, Eye, History, LayoutGrid, MoreHorizontal, Pencil, PlusCircle, Truck } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";

/** Secondary actions of the inventory header, grouped behind one button. */
export function InventoryMoreMenu({ canAdjust, canTransfer }: { canAdjust: boolean; canTransfer: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ variant: "outline" })}>Más acciones <ChevronDown className="size-4" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {canAdjust && <DropdownMenuItem render={<Link href="/inventario/movimientos/nuevo" />}><PlusCircle className="size-4" /> Registrar movimiento</DropdownMenuItem>}
        {canTransfer && <DropdownMenuItem render={<Link href="/inventario/traslados/nuevo" />}><ArrowLeftRight className="size-4" /> Trasladar entre sedes</DropdownMenuItem>}
        {(canAdjust || canTransfer) && <DropdownMenuSeparator />}
        <DropdownMenuItem render={<Link href="/inventario/movimientos" />}><History className="size-4" /> Historial de movimientos</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/inventario/traslados" />}><Truck className="size-4" /> Traslados</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/inventario/vitrina" />}><LayoutGrid className="size-4" /> Vitrina</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProductRowActions({ productId, variantId, name, canEdit, canAdjust, stocked }: {
  productId: string; variantId: string; name: string; canEdit: boolean; canAdjust: boolean; stocked: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Acciones para ${name}`}
        className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem render={<Link href={`/inventario/${productId}`} />}><Eye className="size-4" /> Ver ficha</DropdownMenuItem>
        {canEdit && <DropdownMenuItem render={<Link href={`/inventario/${productId}/editar`} />}><Pencil className="size-4" /> Editar</DropdownMenuItem>}
        {stocked && <DropdownMenuItem render={<Link href={`/inventario/${productId}?tab=movimientos`} />}><ClipboardList className="size-4" /> Ver movimientos</DropdownMenuItem>}
        {stocked && canAdjust && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={`/inventario/movimientos/nuevo?variante=${variantId}`} />}><PlusCircle className="size-4" /> Registrar movimiento</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
