/**
 * Demo data for phases 03–10 (clinical, inventory, sales, labs, billing, RIPS, CRM).
 * Business operations go through the same RPCs the app uses (impersonating the right user,
 * so RLS and rules apply); afterwards history is back-dated so reports have real trends.
 * Idempotent: does nothing if the tenant already has products.
 */
import { DEMO_CATALOG } from "../../src/modules/inventory/catalog/demo-catalog";
import type { Db } from "./connect";

let seed = 4242;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;

const EXTRA_FRAMES: { name: string; shape: string; material: string; price: number; colors: [string, string][] }[] = [
  { name: "Lisboa", shape: "Redonda", material: "Acetato", price: 340000, colors: [["Negro", "#121214"], ["Carey", "#7b4a24"]] },
  { name: "Oslo", shape: "Rectangular", material: "Titanio", price: 620000, colors: [["Gris grafito", "#4b5563"], ["Plata", "#c0c4cc"]] },
  { name: "Kioto", shape: "Hexagonal", material: "Metal", price: 410000, colors: [["Oro rosa", "#d4a28c"], ["Negro mate", "#1f2023"]] },
  { name: "Bruma", shape: "Cuadrada", material: "Acetato", price: 360000, colors: [["Gris humo", "#9ca3af"], ["Verde oliva", "#5b6b3a"], ["Miel", "#c58f3d"]] },
  { name: "Vera", shape: "Cat-eye", material: "Acetato", price: 450000, colors: [["Burdeos", "#6d1f2c"], ["Negro", "#0e0e10"]] },
  { name: "Tango", shape: "Aviador", material: "Metal", price: 390000, colors: [["Dorado", "#c9a45c"], ["Plateado", "#b9bec7"]] },
  { name: "Andes", shape: "Rectangular", material: "TR-90", price: 290000, colors: [["Azul marino", "#1e2a4a"], ["Negro", "#111111"]] },
  { name: "Caribe", shape: "Redonda", material: "Acetato", price: 320000, colors: [["Turquesa", "#1aa5a0"], ["Coral", "#f07a65"]] },
  { name: "Nube", shape: "Ovalada", material: "Acetato infantil", price: 240000, colors: [["Lila", "#b9a2e8"], ["Celeste", "#8cc8f0"], ["Rosa", "#f2a7c3"]] },
  { name: "Roble", shape: "Panto", material: "Madera y acetato", price: 680000, colors: [["Nogal", "#6b4423"]] },
  { name: "Delta", shape: "Clubmaster", material: "Acetato y metal", price: 470000, colors: [["Carey/Oro", "#7a4a26"], ["Negro/Plata", "#141416"]] },
  { name: "Siena", shape: "Mariposa", material: "Acetato", price: 430000, colors: [["Champagne", "#e5cfa3"], ["Negro", "#0f0f10"]] },
];

const LENSES = [
  { name: "Lente monofocal CR-39", price: 180000, cost: 45000 },
  { name: "Lente monofocal policarbonato antirreflejo", price: 380000, cost: 110000 },
  { name: "Lente monofocal filtro azul", price: 420000, cost: 125000 },
  { name: "Lente progresivo digital", price: 950000, cost: 320000 },
  { name: "Lente ocupacional", price: 620000, cost: 190000 },
  { name: "Lente fotocromático", price: 560000, cost: 170000 },
];

export async function seedModules(db: Db, tenantId: string, users: Record<string, string>) {
  const has = await db.query<{ n: number }>(`select count(*)::int as n from public.products where tenant_id = $1`, [tenantId]);
  if ((has.rows[0]?.n ?? 0) > 0) { console.log("✓ Módulos demo ya existen"); return; }
  // An empty catalog that once had products was emptied on purpose: don't refill it on every boot.
  const cleared = await db.query(`select 1 from public.audit_logs where tenant_id = $1 and entity_type = 'products' and action = 'delete' limit 1`, [tenantId]);
  if ((cleared.rowCount ?? 0) > 0) { console.log("✓ Catálogo vaciado a propósito: no se siembran módulos demo"); return; }

  const branches = (await db.query<{ id: string; code: string }>(`select id, code from public.branches where tenant_id = $1 order by is_main desc`, [tenantId])).rows;
  const cat = new Map((await db.query<{ id: string; code: string }>(`select id, code from public.product_categories where tenant_id = $1`, [tenantId])).rows.map((r) => [r.code, r.id]));

  /** Run `fn` as an app user (RLS + auth.uid()), inside the caller's transaction. */
  const as = async <T,>(uid: string, fn: () => Promise<T>) => {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await db.query("set local role authenticated");
    let failed = false;
    try { return await fn(); } catch (err) { failed = true; throw err; } finally {
      // After a failure the transaction is aborted; skip cleanup so the original error surfaces.
      if (!failed) { await db.query("reset role"); await db.query(`select set_config('request.jwt.claims', '', true)`); }
    }
  };
  const q1 = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;

  const stockOf = async (branchId: string, variantId: string) =>
    Number((await db.query<{ q: string }>(`select coalesce(quantity, 0) as q from public.inventory_levels where branch_id = $1 and variant_id = $2`, [branchId, variantId])).rows[0]?.q ?? 0);
  let frameVariantsRef: { id: string; price: number; name: string }[] = [];
  const availableFrame = async (branchId: string) => {
    const ids = new Set((await db.query<{ variant_id: string }>(`select variant_id from public.inventory_levels where branch_id = $1 and quantity >= 1`, [branchId])).rows.map((r) => r.variant_id));
    const options = frameVariantsRef.filter((f) => ids.has(f.id));
    return options.length ? pick(options) : null;
  };

  await db.query("begin");
  try {
    // ── Catalog ────────────────────────────────────────────────────────────
    const brandIds: Record<string, string> = {};
    for (const b of ["Nova Atelier", "Titanium Line", "Lumen Lab", "AquaSoft", "Clara"]) {
      brandIds[b] = (await q1<{ id: string }>(`insert into public.brands (tenant_id, name) values ($1, $2) returning id`, [tenantId, b])).id;
    }
    // Costs live apart from the catalog (only inventory.costs can read them).
    const setCost = (variantId: string, cost: number) =>
      db.query(`insert into public.variant_costs (variant_id, tenant_id, avg_cost) values ($1, $2, $3)`, [variantId, tenantId, cost]);
    const frameVariants: { id: string; price: number; name: string }[] = [];
    for (const m of DEMO_CATALOG) {
      const pid = (await q1<{ id: string }>(
        `insert into public.products (tenant_id, category_id, brand_id, name, model, collection, description, attributes)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [tenantId, cat.get(m.category === "Sol" ? "sunglasses" : "frames"), brandIds[m.material.includes("Titanio") ? "Titanium Line" : "Nova Atelier"],
          m.name, m.sku, m.collection, m.description,
          JSON.stringify({ shape: m.shape, material: m.material, lens: m.size.lens, bridge: m.size.bridge, temple: m.size.temple, tags: m.tags, showcase: true })])).id;
      for (const c of m.colors) {
        const v = await q1<{ id: string }>(
          `insert into public.product_variants (tenant_id, product_id, sku, barcode, color_name, color_hex, image_url, stage_top, stage_bottom, price)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [tenantId, pid, `${m.sku}-${c.key.toUpperCase().slice(0, 3)}`, `770${Math.floor(1e9 + rand() * 8e9)}`, c.name, c.swatch, c.image, c.stage[0], c.stage[1], m.price]);
        await setCost(v.id, Math.round(m.price * 0.38));
        frameVariants.push({ id: v.id, price: m.price, name: `${m.name} ${c.name}` });
      }
    }
    for (const f of EXTRA_FRAMES) {
      const pid = (await q1<{ id: string }>(
        `insert into public.products (tenant_id, category_id, brand_id, name, model, attributes) values ($1, $2, $3, $4, $5, $6) returning id`,
        [tenantId, cat.get("frames"), brandIds[pick(["Nova Atelier", "Clara"])], f.name, `NV-${f.name.slice(0, 3).toUpperCase()}-50`,
          JSON.stringify({ shape: f.shape, material: f.material, lens: 50, bridge: 19, temple: 145 })])).id;
      for (const [color, hex] of f.colors) {
        const v = await q1<{ id: string }>(
          `insert into public.product_variants (tenant_id, product_id, sku, barcode, color_name, color_hex, price) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [tenantId, pid, `NV-${f.name.slice(0, 3).toUpperCase()}-${color.slice(0, 3).toUpperCase()}${Math.floor(rand() * 90 + 10)}`, `770${Math.floor(1e9 + rand() * 8e9)}`, color, hex, f.price]);
        await setCost(v.id, Math.round(f.price * 0.4));
        frameVariants.push({ id: v.id, price: f.price, name: `${f.name} ${color}` });
      }
    }
    frameVariantsRef = frameVariants;
    const lensVariants: { id: string; price: number }[] = [];
    for (const l of LENSES) {
      const pid = (await q1<{ id: string }>(`insert into public.products (tenant_id, category_id, brand_id, name, is_stocked) values ($1, $2, $3, $4, false) returning id`, [tenantId, cat.get("ophthalmic_lenses"), brandIds["Lumen Lab"], l.name])).id;
      const id = (await q1<{ id: string }>(`insert into public.product_variants (tenant_id, product_id, sku, price) values ($1,$2,$3,$4) returning id`, [tenantId, pid, `LEN-${lensVariants.length + 1}`, l.price])).id;
      await setCost(id, l.cost);
      lensVariants.push({ id, price: l.price });
    }
    const stockedExtras: { id: string; price: number }[] = [];
    for (const [code, name, price, brand] of [
      ["contact_lenses", "Lente de contacto mensual esférico x6", 150000, "AquaSoft"], ["contact_lenses", "Lente de contacto tórico mensual x6", 220000, "AquaSoft"],
      ["solutions", "Solución multipropósito 360 ml", 38000, "AquaSoft"], ["accessories", "Estuche rígido", 25000, "Clara"],
      ["accessories", "Paño de microfibra", 8000, "Clara"], ["accessories", "Spray limpiador 60 ml", 18000, "Clara"], ["accessories", "Cordón para gafas", 15000, "Clara"],
    ] as const) {
      const pid = (await q1<{ id: string }>(`insert into public.products (tenant_id, category_id, brand_id, name) values ($1, $2, $3, $4) returning id`, [tenantId, cat.get(code), brandIds[brand], name])).id;
      const id = (await q1<{ id: string }>(`insert into public.product_variants (tenant_id, product_id, sku, barcode, price) values ($1,$2,$3,$4,$5) returning id`, [tenantId, pid, `ACC-${stockedExtras.length + 1}`, `770${Math.floor(1e9 + rand() * 8e9)}`, price])).id;
      await setCost(id, Math.round(price * 0.45));
      stockedExtras.push({ id, price });
    }
    const consultPid = (await q1<{ id: string }>(`insert into public.products (tenant_id, category_id, name, is_stocked, tax_rate) values ($1, $2, 'Consulta de optometría', false, 0) returning id`, [tenantId, cat.get("services")])).id;
    const consultVariant = (await q1<{ id: string }>(`insert into public.product_variants (tenant_id, product_id, sku, price) values ($1, $2, 'SRV-CONSULTA', 60000) returning id`, [tenantId, consultPid])).id;

    // ── Initial stock (as inventory manager = owner) ───────────────────────
    await as(users.owner!, async () => {
      for (const b of branches) {
        for (const v of [...frameVariants, ...stockedExtras]) {
          const qty = Math.floor(rand() * 7) + (b.code === "CHA" ? 5 : 3);
          await db.query(`insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity, notes) values ($1,$2,$3,'initial',$4,'Inventario inicial')`, [tenantId, b.id, v.id, qty]);
        }
      }
    });

    // ── Suppliers, labs, purchases ─────────────────────────────────────────
    const suppliers: string[] = [];
    for (const [name, nit, contact, brands] of [
      ["Distribuidora Óptica Andina SAS", "900456123", "Marcela Ríos", ["Nova Atelier", "Clara"]],
      ["Titanium Line Colombia", "901234987", "Jorge Salas", ["Titanium Line"]],
      ["AquaSoft Contact SAS", "900777321", "Paula Neira", ["AquaSoft"]],
    ] as const) {
      suppliers.push((await as(users.owner!, () => q1<{ id: string }>(
        `insert into public.suppliers (tenant_id, name, tax_id, contact_name, email, phone, brands, payment_terms, lead_time_days)
         values ($1,$2,$3,$4,$5,$6,$7,'30 días',$8) returning id`,
        [tenantId, name, nit, contact, `${contact.split(" ")[0]!.toLowerCase()}@proveedor.demo`, `601${Math.floor(1e6 + rand() * 8e6)}`, brands, Math.floor(rand() * 8) + 3]))).id);
    }
    const labs: string[] = [];
    for (const [name, lead] of [["Laboratorio Visión Digital", 4], ["Lab Óptico del Norte", 6]] as const) {
      labs.push((await as(users.owner!, () => q1<{ id: string }>(`insert into public.labs (tenant_id, name, phone, lead_days) values ($1,$2,$3,$4) returning id`, [tenantId, name, `601${Math.floor(1e6 + rand() * 8e6)}`, lead]))).id);
    }
    await as(users.owner!, async () => {
      for (const [i, status] of (["received", "sent", "draft"] as const).entries()) {
        const po = (await q1<{ id: string }>(`insert into public.purchase_orders (tenant_id, branch_id, supplier_id, status, expected_at, created_by) values ($1,$2,$3,'sent', current_date + $4::int, auth.uid()) returning id`,
          [tenantId, branches[0]!.id, suppliers[i % suppliers.length], 5 - i * 3])).id;
        let total = 0;
        for (const v of frameVariants.slice(i * 4, i * 4 + 4)) {
          const cost = Math.round(v.price * 0.38);
          total += cost * 4;
          await db.query(`insert into public.purchase_order_items (tenant_id, purchase_order_id, variant_id, quantity, unit_cost) values ($1,$2,$3,4,$4)`, [tenantId, po, v.id, cost]);
        }
        await db.query(`update public.purchase_orders set total = $2 where id = $1`, [po, total]);
        if (status === "received") {
          const items = (await db.query<{ id: string; quantity: number }>(`select id, quantity from public.purchase_order_items where purchase_order_id = $1`, [po])).rows;
          await db.query(`select public.receive_purchase_order($1, $2)`, [po, JSON.stringify(items.map((it) => ({ item_id: it.id, quantity: it.quantity })))]);
        } else if (status === "draft") {
          await db.query(`update public.purchase_orders set status = 'draft' where id = $1`, [po]);
        }
      }
    });

    // ── Consultations → prescriptions → sales → lab orders (history) ───────
    const visits = (await db.query<{ id: string; patient_id: string; branch_id: string; specialist_id: string; starts_at: string }>(
      `select a.id, a.patient_id, a.branch_id, a.specialist_id, a.starts_at from public.appointments a
       join public.appointment_types t on t.id = a.appointment_type_id
       where a.tenant_id = $1 and a.status = 'completed' and t.code in ('optometria', 'valoracion', 'lentes_contacto')
         and a.starts_at > now() - interval '24 months' and a.specialist_id is not null
       order by a.starts_at`, [tenantId])).rows;

    let n = 0;
    for (const v of visits) {
      n++;
      const myopic = rand() < 0.6;
      const sphOd = (myopic ? -1 : 1) * (Math.round(rand() * 12) * 0.25 + 0.25);
      const sphOi = sphOd + (rand() < 0.5 ? 0 : 0.25);
      const presbyope = rand() < 0.3;
      const exam = {
        va: { od: { sc_far: "20/60", cc_far: "20/20", sc_near: presbyope ? "J5" : "J1", cc_near: "J1" }, oi: { sc_far: "20/50", cc_far: "20/20", sc_near: presbyope ? "J5" : "J1", cc_near: "J1" } },
        refraction: {
          od: (() => { const cyl = rand() < 0.5; return { sphere: sphOd.toFixed(2), cylinder: cyl ? "-0.50" : "", axis: cyl ? "180" : "", add: presbyope ? "+1.75" : "", va: "20/20" }; })(),
          oi: (() => { const cyl = rand() < 0.4; return { sphere: sphOi.toFixed(2), cylinder: cyl ? "-0.75" : "", axis: cyl ? "170" : "", add: presbyope ? "+1.75" : "", va: "20/20" }; })(),
        },
        dp: { binocular: String(58 + Math.floor(rand() * 8)) },
        keratometry: { od: { k1: "43.25", k2: "44.00", axis: "180" }, oi: { k1: "43.50", k2: "44.25", axis: "175" } },
        iop: { od: String(12 + Math.floor(rand() * 6)), oi: String(12 + Math.floor(rand() * 6)) },
      };
      const dx = myopic ? [{ code: "H52.1", label: "Miopía" }] : [{ code: "H52.0", label: "Hipermetropía" }];
      if (presbyope) dx.push({ code: "H52.4", label: "Presbicia" });
      const recordId = await as(v.specialist_id, async () => (await q1<{ id: string }>(
        `insert into public.medical_records (tenant_id, branch_id, patient_id, appointment_id, professional_id, number, chief_complaint, current_illness,
           personal_history, ocular_history, external_exam, exam, diagnoses, plan, recommendations, lens_recommendation, created_at)
         values ($1,$2,$3,$4,auth.uid(),'',$5,$6,'Niega antecedentes de importancia','Usuario de gafas desde hace 5 años','Anexos oculares sin alteraciones',$7,$8,$9,$10,$11,$12) returning id`,
        [tenantId, v.branch_id, v.patient_id, v.id, pick(["Visión borrosa de lejos", "Cansancio visual al usar computador", "Dificultad para leer de cerca", "Control anual"]),
          "Refiere disminución progresiva de la agudeza visual.", JSON.stringify(exam), JSON.stringify(dx), "Control en 12 meses", "Pausas activas 20-20-20",
          JSON.stringify({ type: presbyope ? "progresivo" : "monofocal", material: pick(["policarbonato", "CR-39", "Trivex"]), treatments: pick([["antirreflejo"], ["antirreflejo", "filtro_azul"], ["fotocromatico"]]) }),
          v.starts_at])).id);
      await as(v.specialist_id, () => db.query(`select public.sign_medical_record($1)`, [recordId]));
      // Signed records are frozen; the seed back-dates the signature through the same guarded channel.
      await db.query(`select set_config('app.amending', 'on', true)`);
      await db.query(`update public.medical_records set signed_at = $2::timestamptz + interval '35 minutes' where id = $1`, [recordId, v.starts_at]);
      await db.query(`select set_config('app.amending', 'off', true)`);
      await db.query(`update public.prescriptions set issued_at = $2::timestamptz + interval '35 minutes', expires_at = $2::timestamptz + interval '12 months', created_at = $2
                      where record_id = $1`, [recordId, v.starts_at]);

      if (rand() > 0.62) continue; // not every consultation converts
      const frame = await availableFrame(v.branch_id);
      if (!frame) continue;
      const lens = presbyope ? lensVariants[3]! : pick(lensVariants.slice(0, 3));
      let total = frame.price + lens.price + (rand() < 0.4 ? 25000 : 0);
      const paidAll = rand() < 0.75 || new Date(v.starts_at).getTime() < Date.now() - 20 * 86_400_000;
      const method = pick(["cash", "card", "card", "transfer", "nequi", "daviplata"]);
      const rx = (await q1<{ id: string }>(`select id from public.prescriptions where record_id = $1`, [recordId]))?.id ?? null;
      const items = [{ variant_id: frame.id, quantity: 1 }, { variant_id: lens.id, quantity: 1 }];
      if (total > frame.price + lens.price && (await stockOf(v.branch_id, stockedExtras[3]!.id)) > 0) items.push({ variant_id: stockedExtras[3]!.id, quantity: 1 });
      if (items.length === 2) total = frame.price + lens.price;
      const deposit = paidAll ? total : Math.round((total * 0.5) / 1000) * 1000;
      const payments = paidAll && rand() < 0.3 ? [{ method: "cash", amount: 200000 }, { method, amount: total - 200000 }] : [{ method, amount: deposit }];
      const seller = pick([users.sales!, users.sales!, users.owner!]);
      const saleId = await as(seller, async () => (await q1<{ id: string }>(`select public.create_sale($1) as id`, [JSON.stringify({
        tenant_id: tenantId, branch_id: v.branch_id, patient_id: v.patient_id, prescription_id: rx, items, payments, idempotency_key: `seed-${v.id}` })])).id);

      const ageDays = (Date.now() - new Date(v.starts_at).getTime()) / 86_400_000;
      const flow = ["sent", "accepted", "in_process", "quality_control", "ready", "received", "delivered"];
      const reach = ageDays > 10 ? (paidAll ? 7 : 6) : ageDays > 6 ? 6 : ageDays > 4 ? 4 : ageDays > 2 ? 3 : 1;
      const orderId = await as(seller, async () => (await q1<{ id: string }>(
        `insert into public.lab_orders (tenant_id, branch_id, patient_id, sale_id, prescription_id, lab_id, number, frame_description, lens_description, lens_type, material, treatments, measurements, estimated_at, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,$11,$12,($13::timestamptz + interval '5 days')::date, auth.uid(), $13) returning id`,
        [tenantId, v.branch_id, v.patient_id, saleId, rx, pick(labs), frame.name, presbyope ? "Progresivo digital" : "Monofocal", presbyope ? "progresivo" : "monofocal",
          pick(["policarbonato", "CR-39"]), ["antirreflejo"], JSON.stringify({ dp: exam.dp.binocular }), v.starts_at])).id);
      for (const st of flow.slice(0, reach)) {
        const checklist = st === "ready" ? JSON.stringify({ formula: true, centering: true, height: true, frame: true, treatment: true, physical: true }) : null;
        await as(users.owner!, () => db.query(`select public.advance_lab_order($1, $2, null, $3)`, [orderId, st, checklist]));
      }

      // Back-date the commercial trail to the visit day.
      await db.query(`update public.sales set created_at = $2 where id = $1`, [saleId, v.starts_at]);
      await db.query(`alter table public.payments disable trigger payments_immutable`);
      await db.query(`update public.payments set created_at = $2 where sale_id = $1`, [saleId, v.starts_at]);
      await db.query(`alter table public.payments enable trigger payments_immutable`);
      await db.query(`alter table public.lab_order_events disable trigger lab_order_events_immutable`);
      await db.query(`update public.lab_order_events e set created_at = least(now() - interval '5 minutes', $2::timestamptz + (row_n * interval '20 hours'))
                      from (select id, row_number() over (order by created_at) as row_n from public.lab_order_events where order_id = $1) x
                      where e.id = x.id`, [orderId, v.starts_at]);
      await db.query(`alter table public.lab_order_events enable trigger lab_order_events_immutable`);
      await db.query(`alter table public.lab_orders disable trigger lab_orders_updated_at`);
      await db.query(`update public.lab_orders o set updated_at = coalesce((select max(created_at) from public.lab_order_events where order_id = o.id), o.created_at),
                        delivered_at = case when o.status = 'delivered' then (select max(created_at) from public.lab_order_events where order_id = o.id) end
                      where o.id = $1`, [orderId]);
      await db.query(`alter table public.lab_orders enable trigger lab_orders_updated_at`);
      await db.query(`update public.patient_activities set occurred_at = $2::timestamptz + interval '1 hour'
                      where tenant_id = $1 and (metadata ->> 'sale_id' = $3 or metadata ->> 'lab_order_id' = $4 or metadata ->> 'record_id' = $5 or metadata ->> 'prescription_id' = $6)`,
        [tenantId, v.starts_at, saleId, orderId, recordId, rx ?? ""]);

      // Invoice paid sales older than 2 days (mock provider → accepted).
      if (paidAll && ageDays > 2) {
        const s = await q1<{ subtotal: string; tax_total: string; total: string; number: string }>(`select subtotal, tax_total, total, number from public.sales where id = $1`, [saleId]);
        const status = rand() < 0.04 ? "rejected" : "accepted";
        await db.query(`insert into public.invoices (tenant_id, sale_id, number, status, provider, provider_ref, cufe, subtotal, tax_total, total, issued_at, idempotency_key, customer, error_message, created_at)
                        values ($1,$2,$3,$4,'mock',$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb,$12,$10)`,
          [tenantId, saleId, status === "accepted" ? `FENV-${String(990000 + n).padStart(7, "0")}` : null, status, `mock_${saleId.slice(0, 8)}`,
            status === "accepted" ? `MOCK${Buffer.from(saleId).toString("hex").slice(0, 60)}` : null,
            Number(s.total) - Number(s.tax_total), s.tax_total, s.total, v.starts_at, `invoice:${saleId}`,
            status === "rejected" ? "Rechazo simulado: NIT del adquiriente inválido (sandbox)" : null]);
      }
    }

    // Walk-in accessory & contact-lens sales spread over the last 60 days.
    for (let i = 0; i < 26; i++) {
      const b = pick(branches);
      const daysAgo = Math.floor(rand() * 58) + 1;
      const candidates = [];
      for (const x of stockedExtras) if ((await stockOf(b.id, x.id)) >= 2) candidates.push(x);
      if (!candidates.length) continue;
      const item = pick(candidates);
      // Walk-in (no customer) sales are paid in full: a balance needs a customer to owe it.
      const quantity = 1 + Math.floor(rand() * 2);
      const saleId = await as(users.sales!, async () => (await q1<{ id: string }>(`select public.create_sale($1) as id`, [JSON.stringify({
        tenant_id: tenantId, branch_id: b.id, items: [{ variant_id: item.id, quantity }],
        payments: [{ method: pick(["cash", "nequi", "card"]), amount: item.price * quantity }], idempotency_key: `seed-walkin-${i}` })])).id);
      await db.query(`update public.sales set created_at = now() - make_interval(days => $2) where id = $1`, [saleId, daysAgo]);
    }
    void consultVariant;

    // Open quotes for recent patients
    const recentPatients = (await db.query<{ id: string; branch_id: string }>(
      `select distinct on (a.patient_id) a.patient_id as id, a.branch_id from public.appointments a where a.tenant_id = $1 and a.status = 'completed'
       and a.starts_at > now() - interval '20 days' order by a.patient_id, a.starts_at desc limit 6`, [tenantId])).rows;
    for (const p of recentPatients) {
      const frame = pick(frameVariants);
      await as(users.sales!, () => db.query(`select public.create_quote($1)`, [JSON.stringify({
        tenant_id: tenantId, branch_id: p.branch_id, patient_id: p.id,
        items: [{ variant_id: frame.id, quantity: 1 }, { variant_id: pick(lensVariants).id, quantity: 1 }] })]));
    }

    // ── RIPS (previous month, validated in sandbox) ────────────────────────
    await db.query(`insert into public.rips_submissions (tenant_id, period_start, period_end, schema_version, status, payload, validation, records_count, provider, idempotency_key, created_by)
                    values ($1, date_trunc('month', now() - interval '1 month')::date, (date_trunc('month', now()) - interval '1 day')::date, 'FEV-RIPS-2275-2023', 'validated',
                            '{"generado":"seed"}'::jsonb, '{"errors":[],"warnings":[]}'::jsonb,
                            (select count(*) from public.medical_records where tenant_id = $1 and created_at >= date_trunc('month', now() - interval '1 month') and created_at < date_trunc('month', now())),
                            'mock', 'seed-rips-prev', $2)`, [tenantId, users.owner]);

    // ── CRM ────────────────────────────────────────────────────────────────
    const stages = new Map((await db.query<{ id: string; code: string }>(`select id, code from public.pipeline_stages where tenant_id = $1`, [tenantId])).rows.map((r) => [r.code, r.id]));
    const leads: [string, string, string, string, number][] = [
      ["Mariana Ocampo", "instagram", "new", "Gafas de sol graduadas", 650000], ["Felipe Arango", "whatsapp", "new", "Lentes de contacto", 220000],
      ["Daniela Cruz", "google", "contacted", "Examen visual", 60000], ["Sergio Patiño", "instagram", "contacted", "Montura Aurora", 865000],
      ["Andrea Lozano", "referral", "booked", "Progresivos", 1500000], ["Luis Restrepo", "facebook", "booked", "Valoración visual", 60000],
      ["Carolina Mejía", "web", "evaluated", "Monofocal filtro azul", 840000], ["Camilo Bernal", "instagram", "quoted", "Milano titanio", 1310000],
      ["Paola Quintero", "whatsapp", "quoted", "Gafas infantiles", 620000], ["Javier Muñoz", "walk_in", "negotiation", "Progresivos premium", 1640000],
      ["Natalia Rincón", "instagram", "won", "Aurora esmeralda", 905000], ["Ricardo Peña", "google", "won", "Lentes fotocromáticos", 980000],
      ["Tatiana Gil", "facebook", "lost", "Comparó precios", 700000], ["Óscar Duarte", "walk_in", "new", "Reparación de montura", 40000],
    ];
    for (const [name, source, stage, interest, value] of leads) {
      await as(users.sales!, () => db.query(
        `insert into public.leads (tenant_id, stage_id, name, phone, source, interest, value, assigned_to, created_by, lost_reason, created_at, stage_changed_at)
         values ($1,$2,$3,$4,$5,$6,$7,auth.uid(),auth.uid(),$8, now() - make_interval(days => $9), now() - make_interval(days => ($9::int / 2)))`,
        [tenantId, stages.get(stage), name, `3${Math.floor(100000000 + rand() * 899999999)}`, source, interest, value, stage === "lost" ? "Precio" : null, Math.floor(rand() * 20)]));
    }
    for (const [title, priority, days, who] of [
      ["Llamar a pacientes con control vencido", "high", 0, "sales"], ["Confirmar citas de mañana", "urgent", 0, "recep"],
      ["Revisar pedido pendiente de Titanium Line", "normal", 2, "owner"], ["Enviar cotización a Camilo Bernal", "high", 1, "sales"],
      ["Inventario físico vitrina Cedritos", "normal", 5, "owner"], ["Publicar colección Atelier en Instagram", "low", 3, "owner"],
    ] as const) {
      await as(users.owner!, () => db.query(`insert into public.tasks (tenant_id, title, priority, due_at, assigned_to, created_by) values ($1,$2,$3, now() + make_interval(days => $4), $5, auth.uid())`,
        [tenantId, title, priority, days, users[who]]));
    }

    await db.query("commit");
    console.log(`✓ Módulos demo: ${frameVariants.length} monturas, ${visits.length} consultas firmadas, ventas, órdenes, facturas, CRM`);
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
