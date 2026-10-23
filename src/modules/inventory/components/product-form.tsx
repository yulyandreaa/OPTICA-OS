"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { FormSection } from "@/components/shared/form-section";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createCategoryAction, saveProductAction } from "../actions";
import {
  KIND_DEFAULTS, KIND_HAS_COLOR, KIND_LABEL, KINDS, PRODUCT_FIELDS, TAX_RATES, UNIT_LABEL, UNITS, VARIANT_FIELDS,
  type Kind, type Unit,
} from "../constants";
import { productSchema, type ProductInput } from "../schemas";
import type { ProductFormValues } from "../utils/form-values";

/** "300.000" / "$ 300 000" → 300000; empty → undefined. */
const money = (s: string) => (s.replace(/[^\d]/g, "") === "" ? undefined : Number(s.replace(/[^\d]/g, "")));
const int = (s: string) => (s.trim() === "" ? undefined : Number(s.trim()));

type CategoryOption = { id: string; name: string; kind: Kind };

export function ProductForm({ productId, defaults, originalCosts = {}, categories: initialCategories, brands, branches, canCosts, canAdjust, canManageCategories }: {
  productId?: string; defaults: ProductFormValues; originalCosts?: Record<number, string>;
  categories: CategoryOption[]; brands: string[]; branches: { id: string; name: string }[];
  canCosts: boolean; canAdjust: boolean; canManageCategories: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [categories, setCategories] = useState(initialCategories);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useForm<ProductFormValues>({ defaultValues: defaults });
  const { register, control, setValue, setError } = form;
  // One product = one sellable item: the form edits the first variant. Older products with several keep the rest untouched.
  const main = useWatch({ control, name: "variants.0" });
  const extraVariants = defaults.variants.length - 1;
  const [categoryId, isStocked, trackLots, unit, taxRate] = useWatch({ control, name: ["category_id", "is_stocked", "track_lots", "unit", "tax_rate"] });
  const kind: Kind = categories.find((c) => c.id === categoryId)?.kind ?? "supply";
  const creating = !productId;
  const err = (name: string): string | undefined => {
    const message = form.getFieldState(name as FieldPath<ProductFormValues>, form.formState).error?.message;
    return typeof message === "string" ? message : undefined;
  };

  const onCategory = (id: string) => {
    setValue("category_id", id);
    const next = categories.find((c) => c.id === id)?.kind;
    if (creating && next) {
      setValue("is_stocked", KIND_DEFAULTS[next].is_stocked);
      setValue("track_lots", KIND_DEFAULTS[next].track_lots);
      setValue("unit", KIND_DEFAULTS[next].unit);
    }
  };

  const onSubmit = form.handleSubmit((v) => {
    const cells: string[] = []; // initial_stock index → form key, to place errors
    const payload: ProductInput = {
      id: productId, category_id: v.category_id, brand: v.brand, name: v.name, model: v.model, collection: v.collection, description: v.description,
      tax_rate: Number(v.tax_rate) as 0 | 5 | 19, is_stocked: v.is_stocked, unit: v.unit, default_min_stock: int(v.default_min_stock) ?? Number.NaN,
      track_lots: v.is_stocked && v.track_lots, is_active: v.is_active,
      // Fields of other kinds are sent as null so a category change doesn't leave stale attributes behind.
      attributes: Object.fromEntries(KINDS.flatMap((k) => PRODUCT_FIELDS[k]).map((f) => {
        const own = PRODUCT_FIELDS[kind].some((x) => x.key === f.key);
        const val = v.attributes[f.key];
        return [f.key, own && (Array.isArray(val) ? val.length : val) ? val : null];
      })),
      variants: v.variants.map((x, i) => ({
        id: x.id, sku: x.sku.trim(), barcode: x.barcode.trim(), color_name: KIND_HAS_COLOR[kind] ? x.color_name : "",
        color_hex: KIND_HAS_COLOR[kind] ? x.color_hex : "", image_url: x.image_url.trim(),
        attributes: Object.fromEntries(VARIANT_FIELDS[kind].map((f) => [f.key, (x.attributes[f.key] ?? "").trim()]).filter(([, val]) => val)),
        price: money(x.price) ?? Number.NaN,
        cost: canCosts && x.cost.trim() !== "" && x.cost !== (originalCosts[i] ?? "") ? money(x.cost) : undefined,
        is_active: x.is_active,
      })),
      initial_stock: creating && v.is_stocked && canAdjust ? [0].flatMap((vi) => branches.map((b) => {
        const key = `${vi}:${b.id}`;
        const c = v.initial[key];
        const quantity = int(c?.quantity ?? "");
        if (!quantity) return null;
        cells.push(key);
        return { variant: vi, branch_id: b.id, quantity, lot_code: c?.lot_code ?? "", expires_on: c?.expires_on ?? "" };
      }).filter((x) => x !== null)) : [],
      idempotency_key: creating ? idempotencyKey : undefined,
    };

    const placeErrors = (issues: { path: PropertyKey[]; message: string }[] | Record<string, string[] | undefined>) => {
      const list = Array.isArray(issues) ? issues : Object.entries(issues).map(([k, m]) => ({ path: k.split("."), message: m?.[0] ?? "" }));
      let first: string | undefined;
      for (const i of list) {
        const [head, idx, field] = i.path.map(String);
        const name = head === "initial_stock" ? `initial.${cells[Number(idx)]}.${field === "lot_code" ? "lot_code" : "quantity"}`
          : head === "default_min_stock" || head === "variants" || head in v ? i.path.map(String).join(".") : undefined;
        if (!name) continue;
        setError(name as FieldPath<ProductFormValues>, { message: i.message });
        first ??= name;
      }
      if (first) document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    };

    const parsed = productSchema.safeParse(payload);
    if (!parsed.success) {
      placeErrors(parsed.error.issues);
      toast.error("Revisa los campos marcados.");
      return;
    }
    startTransition(async () => {
      const res = await saveProductAction(parsed.data);
      if (!res.ok) {
        if (res.fieldErrors) placeErrors(res.fieldErrors);
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/inventario/${res.data.id}`);
      router.refresh();
    });
  });

  const productFields = PRODUCT_FIELDS[kind];
  const variantFields = VARIANT_FIELDS[kind];
  const hasColor = KIND_HAS_COLOR[kind];

  return (
    <form onSubmit={onSubmit} noValidate autoComplete="off" className="rounded-2xl border bg-surface p-6 shadow-soft sm:p-8">
      <FormSection title="Información básica" description="Lo que identifica el producto en el catálogo de todas tus sedes.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="category_id" label="Categoría" error={err("category_id")}>
            <NativeSelect id="category_id" value={categoryId} onChange={(e) => onCategory(e.target.value)} aria-invalid={!!err("category_id")}>
              <option value="">Elige una categoría</option>
              {KINDS.map((k) => {
                const group = categories.filter((c) => c.kind === k);
                return group.length ? <optgroup key={k} label={KIND_LABEL[k]}>{group.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup> : null;
              })}
            </NativeSelect>
          </FormField>
          {canManageCategories && <NewCategory onCreated={(c) => { setCategories((cs) => [...cs, c]); onCategory(c.id); }} />}
        </div>
        <FormField id="name" label="Nombre del producto" error={err("name")}>
          <Input id="name" placeholder={kind === "frame" ? "Montura Aurora" : kind === "contact_lens" ? "AquaSoft mensual esférico" : "Nombre"} {...register("name")} aria-invalid={!!err("name")} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="brand" label="Marca" optional>
            <Input id="brand" list="brand-options" {...register("brand")} />
            <datalist id="brand-options">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </FormField>
          <FormField id="model" label={kind === "supply" ? "Referencia" : "Modelo o referencia"} optional>
            <Input id="model" {...register("model")} />
          </FormField>
          <FormField id="collection" label={kind === "ophthalmic_lens" ? "Familia" : "Colección o línea"} optional>
            <Input id="collection" {...register("collection")} />
          </FormField>
        </div>
        {productFields.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {productFields.map((f) => f.multi ? (
              <fieldset key={f.key} className="grid gap-2 sm:col-span-2">
                <legend className="mb-1 text-[13px] font-medium text-foreground/80">{f.label} <span className="font-normal text-muted-foreground">· opcional</span></legend>
                <Controller control={control} name={`attributes.${f.key}`} render={({ field }) => {
                  const value = Array.isArray(field.value) ? field.value : [];
                  return (
                    <div className="flex flex-wrap gap-2">
                      {f.options!.map((o) => (
                        <label key={o} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", value.includes(o) && "border-brand bg-brand-soft")}>
                          <Checkbox checked={value.includes(o)} onCheckedChange={(c) => field.onChange(c ? [...value, o] : value.filter((x) => x !== o))} />{o}
                        </label>
                      ))}
                    </div>
                  );
                }} />
              </fieldset>
            ) : f.options ? (
              <FormField key={f.key} id={`attr-${f.key}`} label={f.label} optional>
                <NativeSelect id={`attr-${f.key}`} {...register(`attributes.${f.key}`)}>
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </NativeSelect>
              </FormField>
            ) : (
              <FormField key={f.key} id={`attr-${f.key}`} label={f.label} optional>
                <Input id={`attr-${f.key}`} placeholder={f.placeholder} inputMode="numeric" {...register(`attributes.${f.key}`)} />
              </FormField>
            ))}
          </div>
        )}
        {kind === "ophthalmic_lens" && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            La graduación de cada paciente no se registra aquí: va en la fórmula y en la orden óptica.
          </p>
        )}
        <FormField id="description" label="Descripción" optional>
          <Textarea id="description" rows={3} {...register("description")} />
        </FormField>
      </FormSection>

      <FormSection title="Características" description={hasColor || variantFields.length
        ? "Cómo se ve y qué medidas tiene. Si vendes otro color o calibre, créalo como otro producto."
        : "La foto con la que se reconoce en el catálogo."}>
        {extraVariants > 0 && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Este producto se creó con {extraVariants + 1} presentaciones. Aquí editas la principal; las otras se conservan sin cambios.
          </p>
        )}
        {(hasColor || variantFields.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {hasColor && (
              <FormField id="v0-color" label="Color" optional error={err("variants.0.color_name")}>
                <div className="flex gap-2">
                  <Input id="v0-color" placeholder="Negro mate" {...register("variants.0.color_name")} aria-invalid={!!err("variants.0.color_name")} />
                  <Controller control={control} name="variants.0.color_hex" render={({ field: f }) => (
                    <input type="color" aria-label="Tono del color" value={f.value || "#888888"} onChange={(e) => f.onChange(e.target.value)}
                      className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border bg-surface p-1" />
                  )} />
                </div>
              </FormField>
            )}
            {variantFields.map((f) => (
              <FormField key={f.key} id={`v0-${f.key}`} label={f.label} optional>
                <Input id={`v0-${f.key}`} placeholder={f.placeholder} {...register(`variants.0.attributes.${f.key}`)} />
              </FormField>
            ))}
          </div>
        )}
        <FormField id="v0-image" label="Enlace de la foto" optional error={err("variants.0.image_url")} hint="Pega el enlace de una imagen publicada (tu web, Instagram, el proveedor)">
          <div className="flex gap-3">
            <Input id="v0-image" type="url" placeholder="https://…" {...register("variants.0.image_url")} aria-invalid={!!err("variants.0.image_url")} />
            {/^https?:\/\/\S+$/.test(main?.image_url ?? "") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={main!.image_url} alt="" className="size-9 shrink-0 rounded-lg border object-cover" />
            )}
          </div>
        </FormField>
      </FormSection>

      <FormSection title="Precio" description="El precio se registra con IVA incluido. Confirma con tu contador la tarifa de cada producto.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="v0-price" label="Precio de venta (IVA incluido)" error={err("variants.0.price")}>
            <MoneyInput id="v0-price" control={control} name="variants.0.price" invalid={!!err("variants.0.price")} />
          </FormField>
          <FormField id="tax_rate" label="IVA">
            <NativeSelect id="tax_rate" {...register("tax_rate")}>
              {TAX_RATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </NativeSelect>
          </FormField>
          {canCosts && (
            <FormField id="v0-cost" label={main?.id ? "Costo promedio" : "Costo de compra"} optional error={err("variants.0.cost")}
              hint={main?.id ? "Las compras lo recalculan; cambiarlo revalúa el stock" : "Sin IVA. Solo lo ve quien tiene permiso de costos"}>
              <MoneyInput id="v0-cost" control={control} name="variants.0.cost" invalid={!!err("variants.0.cost")} />
            </FormField>
          )}
        </div>
        <PriceSummary price={money(main?.price ?? "")} cost={canCosts ? money(main?.cost ?? "") : undefined} taxRate={Number(taxRate)} />
      </FormSection>

      <FormSection title="Códigos" description="Para encontrarlo rápido y escanearlo en caja.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="v0-sku" label="SKU o referencia interna" error={err("variants.0.sku")} hint={!main?.id ? "Si lo dejas vacío, lo creamos automáticamente" : undefined}>
            <Input id="v0-sku" placeholder="Automático" className="font-mono uppercase" {...register("variants.0.sku")} aria-invalid={!!err("variants.0.sku")} />
          </FormField>
          <FormField id="v0-barcode" label="Código de barras" optional error={err("variants.0.barcode")}>
            <Input id="v0-barcode" inputMode="numeric" className="font-mono" {...register("variants.0.barcode")} aria-invalid={!!err("variants.0.barcode")} />
          </FormField>
        </div>
        {err("variants") && <p role="alert" className="text-xs text-destructive">{err("variants")}</p>}
      </FormSection>

      <FormSection title="Configuración de inventario" description="Cómo se controlan las existencias de este producto en cada sede.">
        <Controller control={control} name="is_stocked" render={({ field }) => (
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(!!c)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Controlar existencias</span>
              <span className="block text-sm text-muted-foreground">Desactívalo para servicios o lentes que se fabrican por orden: se pueden vender sin stock.</span>
            </span>
          </label>
        )} />
        {isStocked && (
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="unit" label="Unidad de medida">
              <NativeSelect id="unit" {...register("unit")}>{UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</NativeSelect>
            </FormField>
            <FormField id="default_min_stock" label="Stock mínimo por sede" error={err("default_min_stock")} hint="Al llegar a este número se marca como stock bajo">
              <Input id="default_min_stock" inputMode="numeric" {...register("default_min_stock")} aria-invalid={!!err("default_min_stock")} />
            </FormField>
            <Controller control={control} name="track_lots" render={({ field }) => (
              <label className="flex items-start gap-3 self-end rounded-xl border p-3">
                <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(!!c)} className="mt-0.5" />
                <span className="text-sm"><span className="block font-medium">Maneja lote y vencimiento</span><span className="text-muted-foreground">Cada entrada pide el lote</span></span>
              </label>
            )} />
          </div>
        )}
        <Controller control={control} name="is_active" render={({ field }) => (
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(!!c)} /> Producto activo (se puede vender y aparece en el catálogo)
          </label>
        )} />
      </FormSection>

      {creating && isStocked && canAdjust && (
        <FormSection title="Existencias iniciales" description="Opcional. Se registran como movimientos de carga inicial con tu usuario, la fecha y la sede. Después, el stock solo cambia con movimientos.">
          <InitialStock control={control} register={register} err={err} branches={branches} trackLots={trackLots} unit={unit} />
        </FormSection>
      )}

      <div className="flex flex-col-reverse gap-2 pt-6 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{creating ? "Crear producto" : "Guardar cambios"}</Button>
      </div>
    </form>
  );
}

/** Live breakdown under the price: what is tax and, with costs, what the sale leaves. */
function PriceSummary({ price, cost, taxRate }: { price?: number; cost?: number; taxRate: number }) {
  if (!price) return null;
  const net = price / (1 + taxRate / 100);
  const fmt = (n: number) => `$ ${Math.round(n).toLocaleString("es-CO")}`;
  const items: [string, string, string?][] = [["Precio sin IVA", fmt(net)], ["IVA", fmt(price - net)]];
  if (cost) {
    const margin = net - cost;
    items.push(["Ganancia por unidad", fmt(margin), margin < 0 ? "text-destructive" : undefined], ["Margen", `${Math.round((margin / net) * 100)} %`, margin < 0 ? "text-destructive" : undefined]);
  }
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-4">
      {items.map(([k, val, cls]) => (
        <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className={cn("text-sm font-medium tabular", cls)}>{val}</dd></div>
      ))}
    </dl>
  );
}

function MoneyInput({ id, control, name, invalid }: { id: string; control: ReturnType<typeof useForm<ProductFormValues>>["control"]; name: `variants.${number}.price` | `variants.${number}.cost`; invalid?: boolean }) {
  return (
    <Controller control={control} name={name} render={({ field }) => {
      const n = money(field.value ?? "");
      return (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input id={id} inputMode="numeric" className="pl-6 tabular" aria-invalid={invalid} name={field.name} ref={field.ref} onBlur={field.onBlur}
            value={n === undefined ? "" : n.toLocaleString("es-CO")} onChange={(e) => field.onChange(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
      );
    }} />
  );
}

function InitialStock({ control, register, err, branches, trackLots, unit }: {
  control: ReturnType<typeof useForm<ProductFormValues>>["control"]; register: ReturnType<typeof useForm<ProductFormValues>>["register"];
  err: (name: string) => string | undefined; branches: { id: string; name: string }[]; trackLots: boolean; unit: Unit;
}) {
  const values = useWatch({ control, name: "initial" });
  const total = useMemo(() => Object.values(values ?? {}).reduce((a, c) => a + (Number(c?.quantity) || 0), 0), [values]);
  return (
    <div className="grid gap-3">
      <div className="divide-y rounded-xl border">
        {branches.map((b) => {
          const key = `initial.0:${b.id}`;
          const error = err(`${key}.quantity`) ?? err(`${key}.lot_code`);
          return (
            <div key={b.id} className={cn("grid gap-2 px-4 py-3", !trackLots && "sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center")}>
              <span className="text-sm font-medium">{b.name}</span>
              <div className={cn("grid gap-2", trackLots && "sm:grid-cols-3")}>
                <Input aria-label={`Cantidad en ${b.name}`} inputMode="numeric" placeholder="0" className="tabular"
                  {...register(`${key}.quantity` as `initial.${string}.quantity`)} aria-invalid={!!err(`${key}.quantity`)} />
                {trackLots && (
                  <>
                    <Input aria-label={`Lote en ${b.name}`} placeholder="Lote" className="font-mono uppercase" {...register(`${key}.lot_code` as `initial.${string}.lot_code`)} aria-invalid={!!err(`${key}.lot_code`)} />
                    <Input aria-label={`Vencimiento en ${b.name}`} type="date" {...register(`${key}.expires_on` as `initial.${string}.expires_on`)} />
                  </>
                )}
              </div>
              {error && <p className={cn("text-xs text-destructive", !trackLots && "sm:col-span-2")}>{error}</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground tabular">{total > 0 ? `Se registrarán ${total} ${UNIT_LABEL[unit].toLowerCase()}${total === 1 ? "" : "s"} como carga inicial.` : "Deja en blanco las sedes sin existencias."}</p>
    </div>
  );
}

function NewCategory({ onCreated }: { onCreated: (c: CategoryOption) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("frame");
  const [pending, startTransition] = useTransition();
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="self-end justify-self-start pb-2 text-sm text-brand hover:underline">+ Nueva categoría</button>;
  }
  const create = () => startTransition(async () => {
    const res = await createCategoryAction({ name, kind });
    if (!res.ok) { toast.error(res.fieldErrors?.name?.[0] ?? res.error); return; }
    toast.success(res.message);
    onCreated({ id: res.data.id, name: name.trim(), kind });
    setOpen(false); setName("");
  });
  return (
    <div className="grid gap-2 rounded-xl border p-3 sm:col-span-2 sm:grid-cols-[1fr_200px_auto] sm:items-end">
      <FormField id="new-category" label="Nombre de la categoría">
        <Input id="new-category" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gafas deportivas"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }} />
      </FormField>
      <FormField id="new-category-kind" label="Se comporta como">
        <NativeSelect id="new-category-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </NativeSelect>
      </FormField>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="button" disabled={pending || name.trim().length < 2} onClick={create}>{pending && <Loader2 className="animate-spin" />}Crear</Button>
      </div>
    </div>
  );
}
