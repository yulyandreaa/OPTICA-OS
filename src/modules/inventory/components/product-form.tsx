"use client";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
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
import { EMPTY_VARIANT, type ProductFormValues, type VariantValues } from "../utils/form-values";

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
  // keyName "key": the variants carry their own database `id`.
  const variants = useFieldArray({ control, name: "variants", keyName: "key" });
  const watchedVariants = useWatch({ control, name: "variants" });
  const [categoryId, isStocked, trackLots, unit] = useWatch({ control, name: ["category_id", "is_stocked", "track_lots", "unit"] });
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
      initial_stock: creating && v.is_stocked && canAdjust ? variants.fields.flatMap((f, vi) => branches.map((b) => {
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

  // Initial stock is keyed by variant position: removing a variant shifts the ones after it.
  const removeVariant = (i: number) => {
    const shifted: ProductFormValues["initial"] = {};
    for (const [k, cell] of Object.entries(form.getValues("initial") ?? {})) {
      const [idx, branch] = k.split(":");
      const n = Number(idx);
      if (n !== i) shifted[`${n > i ? n - 1 : n}:${branch}`] = cell;
    }
    variants.remove(i);
    setValue("initial", shifted);
  };

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
            La graduación de cada paciente no se registra aquí: va en la fórmula y en la orden óptica. Crea una variante solo si vendes rangos distintos con precios distintos.
          </p>
        )}
        <FormField id="description" label="Descripción" optional>
          <Textarea id="description" rows={3} {...register("description")} />
        </FormField>
      </FormSection>

      <FormSection title="Variantes" description={hasColor
        ? "Cada color o talla que vendes por separado. Cada variante tiene su propio SKU, código de barras y existencias."
        : "Cada combinación que vendes por separado, con su propio SKU y existencias."}>
        <div className="grid gap-3">
          {variants.fields.map((field, i) => {
            const saved = !!watchedVariants[i]?.id;
            const active = watchedVariants[i]?.is_active ?? true;
            return (
              <div key={field.key} className={cn("grid gap-3 rounded-xl border p-4", !active && "bg-muted/50")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Variante {i + 1}{!active && <span className="ml-2 text-xs font-normal text-muted-foreground">inactiva</span>}</p>
                  {saved ? (
                    <Controller control={control} name={`variants.${i}.is_active`} render={({ field: f }) => (
                      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={f.value} onCheckedChange={(c) => f.onChange(!!c)} /> Activa</label>
                    )} />
                  ) : variants.fields.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeVariant(i)} aria-label={`Quitar variante ${i + 1}`}><Trash2 /> Quitar</Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {hasColor && (
                    <FormField id={`v${i}-color`} label="Color" optional error={err(`variants.${i}.color_name`)}>
                      <div className="flex gap-2">
                        <Input id={`v${i}-color`} placeholder="Negro mate" {...register(`variants.${i}.color_name`)} aria-invalid={!!err(`variants.${i}.color_name`)} />
                        <Controller control={control} name={`variants.${i}.color_hex`} render={({ field: f }) => (
                          <input type="color" aria-label="Tono del color" value={f.value || "#888888"} onChange={(e) => f.onChange(e.target.value)}
                            className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border bg-surface p-1" />
                        )} />
                      </div>
                    </FormField>
                  )}
                  {variantFields.map((f) => (
                    <FormField key={f.key} id={`v${i}-${f.key}`} label={f.label} optional>
                      <Input id={`v${i}-${f.key}`} placeholder={f.placeholder} {...register(`variants.${i}.attributes.${f.key}`)} />
                    </FormField>
                  ))}
                  <FormField id={`v${i}-sku`} label="SKU o referencia interna" error={err(`variants.${i}.sku`)} hint={!saved ? "Vacío = automático" : undefined}>
                    <Input id={`v${i}-sku`} placeholder="Automático" className="font-mono uppercase" {...register(`variants.${i}.sku`)} aria-invalid={!!err(`variants.${i}.sku`)} />
                  </FormField>
                  <FormField id={`v${i}-barcode`} label="Código de barras" optional error={err(`variants.${i}.barcode`)}>
                    <Input id={`v${i}-barcode`} inputMode="numeric" className="font-mono" {...register(`variants.${i}.barcode`)} aria-invalid={!!err(`variants.${i}.barcode`)} />
                  </FormField>
                  <FormField id={`v${i}-price`} label="Precio de venta (IVA incluido)" error={err(`variants.${i}.price`)}>
                    <MoneyInput id={`v${i}-price`} control={control} name={`variants.${i}.price`} invalid={!!err(`variants.${i}.price`)} />
                  </FormField>
                  {canCosts && (
                    <FormField id={`v${i}-cost`} label={saved ? "Costo unitario promedio" : "Costo unitario"} optional error={err(`variants.${i}.cost`)}
                      hint={saved ? "Las compras lo recalculan; cambiarlo revalúa el stock" : "Sin IVA. Solo lo ve quien tiene permiso de costos"}>
                      <MoneyInput id={`v${i}-cost`} control={control} name={`variants.${i}.cost`} invalid={!!err(`variants.${i}.cost`)} />
                    </FormField>
                  )}
                  <FormField id={`v${i}-image`} label="Enlace de la imagen" optional error={err(`variants.${i}.image_url`)} className="sm:col-span-2">
                    <Input id={`v${i}-image`} type="url" placeholder="https://…" {...register(`variants.${i}.image_url`)} aria-invalid={!!err(`variants.${i}.image_url`)} />
                  </FormField>
                </div>
              </div>
            );
          })}
          <Button type="button" variant="outline" className="justify-self-start" onClick={() => variants.append({ ...EMPTY_VARIANT, price: form.getValues("variants.0.price") ?? "" })}>
            <Plus /> Agregar variante
          </Button>
          {err("variants") && <p role="alert" className="text-xs text-destructive">{err("variants")}</p>}
        </div>
      </FormSection>

      <FormSection title="Impuestos" description="Los precios se registran con IVA incluido. Confirma con tu contador la tarifa de cada producto.">
        <FormField id="tax_rate" label="Tratamiento de IVA" className="sm:max-w-xs">
          <NativeSelect id="tax_rate" {...register("tax_rate")}>
            {TAX_RATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </NativeSelect>
        </FormField>
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
          <InitialStock control={control} register={register} err={err} branches={branches} variants={variants.fields.map((f, i) => ({ id: String(i), key: f.key, label: variantTitle(watchedVariants[i], i, hasColor) }))}
            trackLots={trackLots} unit={unit} />
        </FormSection>
      )}

      <div className="flex flex-col-reverse gap-2 pt-6 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{creating ? "Crear producto" : "Guardar cambios"}</Button>
      </div>
    </form>
  );
}

function variantTitle(v: VariantValues | undefined, i: number, hasColor: boolean) {
  const parts = [hasColor ? v?.color_name : "", ...Object.values(v?.attributes ?? {})].filter(Boolean);
  return parts.length ? parts.join(" · ") : `Variante ${i + 1}`;
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

function InitialStock({ control, register, err, branches, variants, trackLots, unit }: {
  control: ReturnType<typeof useForm<ProductFormValues>>["control"]; register: ReturnType<typeof useForm<ProductFormValues>>["register"];
  err: (name: string) => string | undefined; branches: { id: string; name: string }[]; variants: { id: string; key: string; label: string }[]; trackLots: boolean; unit: Unit;
}) {
  const values = useWatch({ control, name: "initial" });
  const total = useMemo(() => Object.values(values ?? {}).reduce((a, c) => a + (Number(c?.quantity) || 0), 0), [values]);
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Variante</th>
              {branches.map((b) => <th key={b.id} className="px-3 py-2 font-medium">{b.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {variants.map((v) => (
              <tr key={v.key}>
                <td className="px-3 py-2 align-top whitespace-nowrap">{v.label}</td>
                {branches.map((b) => {
                  const key = `initial.${v.id}:${b.id}`;
                  return (
                    <td key={b.id} className="px-3 py-2 align-top">
                      <div className="grid min-w-32 gap-1.5">
                        <Input aria-label={`Cantidad de ${v.label} en ${b.name}`} inputMode="numeric" placeholder="0" className="h-8"
                          {...register(`${key}.quantity` as `initial.${string}.quantity`)} aria-invalid={!!err(`${key}.quantity`)} />
                        {trackLots && (
                          <>
                            <Input aria-label="Lote" placeholder="Lote" className="h-8 font-mono uppercase" {...register(`${key}.lot_code` as `initial.${string}.lot_code`)} aria-invalid={!!err(`${key}.lot_code`)} />
                            <Input aria-label="Vencimiento" type="date" className="h-8" {...register(`${key}.expires_on` as `initial.${string}.expires_on`)} />
                          </>
                        )}
                        {(err(`${key}.quantity`) || err(`${key}.lot_code`)) && <p className="text-xs text-destructive">{err(`${key}.quantity`) ?? err(`${key}.lot_code`)}</p>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground tabular">{total > 0 ? `Se registrarán ${total} ${UNIT_LABEL[unit].toLowerCase()}${total === 1 ? "" : "s"} como carga inicial.` : "Deja en 0 las sedes sin existencias."}</p>
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
