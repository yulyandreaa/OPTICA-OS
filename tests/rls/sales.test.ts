/**
 * Ventas y cotizaciones (etapa 1): precios del catálogo, estado comercial separado del de pago,
 * escrituras solo por RPC y ciclo de la cotización hasta convertirse en venta al precio actual.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied, type Db } from "./helpers";

const suffix = `sa${Date.now().toString(36)}`;

describe("ventas y cotizaciones", () => {
  let db: Db;
  let owner: string, seller: string;
  let tenant: string, branch: string, patient: string, frame: string, frameProduct: string, service: string;

  const one = async <T,>(uid: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, uid, async () => (await db.query<T>(sql, params)).rows[0]!, { commit: true });
  const sale = (uid: string, p: Record<string, unknown>) =>
    one<{ id: string }>(uid, `select public.create_sale($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, ...p }]).then((r) => r.id);
  const quote = (uid: string, p: Record<string, unknown>) =>
    one<{ id: string }>(uid, `select public.save_quote($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, ...p }]).then((r) => r.id);
  const row = <T,>(table: string, id: string, cols: string) => db.query<T>(`select ${cols} from public.${table} where id = $1`, [id]).then((r) => r.rows[0]!);

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `o-${suffix}@t.dev`, "Dueña");
    seller = await createAuthUser(db, `s-${suffix}@t.dev`, "Asesor");
    tenant = (await one<{ id: string }>(owner, `select public.create_tenant('Ventas Optica', 'Ventas SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Bogotá', null, null) as id`, [suffix])).id;
    branch = (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1 and is_main`, [tenant])).rows[0]!.id;
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, seller]);
    await db.query(`insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where code = 'SALES_REP' and tenant_id is null`, [tenant, seller]);
    patient = (await one<{ id: string }>(owner, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name) values ($1, 'CC', '777', 'Eva', 'Paz') returning id`, [tenant])).id;
    const cat = async (code: string) => (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = $2`, [tenant, code])).rows[0]!.id;
    frameProduct = (await one<{ id: string }>(owner, `select public.save_product($1) as id`, [{ tenant_id: tenant, category_id: await cat("frames"), name: "Aurora", tax_rate: 19,
      is_stocked: true, unit: "unidad", default_min_stock: 1, variants: [{ price: 300000, cost: 100000 }], initial_stock: [{ variant: 0, branch_id: branch, quantity: 3 }] }])).id;
    frame = (await db.query<{ id: string }>(`select id from public.product_variants where product_id = $1`, [frameProduct])).rows[0]!.id;
    const svc = (await one<{ id: string }>(owner, `select public.save_product($1) as id`, [{ tenant_id: tenant, category_id: await cat("services"), name: "Examen visual", tax_rate: 0,
      is_stocked: false, unit: "unidad", default_min_stock: 0, variants: [{ price: 50000 }] }])).id;
    service = (await db.query<{ id: string }>(`select id from public.product_variants where product_id = $1`, [svc])).rows[0]!.id;
  });
  afterAll(async () => { await db?.end(); });

  it("el precio, el IVA y el costo salen del catálogo aunque el cliente envíe otros", async () => {
    const id = await sale(seller, { items: [{ variant_id: frame, quantity: 1, unit_price: 1, tax_rate: 0 }, { variant_id: service, quantity: 1 }] });
    const s = await row<{ total: string; tax_total: string; status: string; payment_status: string; seller_id: string }>("sales", id, "total, tax_total, status, payment_status, seller_id");
    expect(Number(s.total)).toBe(350000);
    expect(Number(s.tax_total)).toBeCloseTo(300000 - 300000 / 1.19, 1);
    expect(s).toMatchObject({ status: "completed", payment_status: "pending", seller_id: seller });
    const cost = await db.query<{ unit_cost: string }>(`select unit_cost from public.sale_items where sale_id = $1 and variant_id = $2`, [id, frame]);
    expect(Number(cost.rows[0]!.unit_cost)).toBe(100000);
  });

  it("los abonos cambian solo el estado de pago y no aceptan medios desconocidos", async () => {
    const id = await sale(owner, { items: [{ variant_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 20000 }] });
    expect((await row<{ payment_status: string }>("sales", id, "payment_status")).payment_status).toBe("partial");
    expect(await expectDenied(db, owner, `select public.add_sale_payment($1, $2)`, [id, [{ method: "credit", amount: 1000 }]])).toMatch(/INVALID_PAYMENT_METHOD/);
    await one(owner, `select public.add_sale_payment($1, $2) as b`, [id, [{ method: "transfer", amount: 30000 }]]);
    expect(await row("sales", id, "status, payment_status")).toEqual({ status: "completed", payment_status: "paid" });
  });

  it("nadie escribe ventas ni cotizaciones por fuera de las funciones", async () => {
    const id = await sale(owner, { items: [{ variant_id: service, quantity: 1 }] });
    expect(await expectDenied(db, owner, `update public.sales set total = 1 where id = $1`, [id])).toMatch(/SALES_RPC_ONLY/);
    // Lines have no update policy at all: the statement silently touches nothing.
    await asUser(db, owner, () => db.query(`update public.sale_items set unit_price = 1 where sale_id = $1`, [id]), { commit: true });
    expect(Number((await db.query<{ p: string }>(`select unit_price as p from public.sale_items where sale_id = $1`, [id])).rows[0]!.p)).toBe(50000);
    expect(await expectDenied(db, owner, `insert into public.quotes (tenant_id, branch_id, patient_id, number) values ($1, $2, $3, '')`, [tenant, branch, patient])).toMatch(/SALES_RPC_ONLY/);
  });

  it("no se vende un producto inactivo ni sin producto del catálogo", async () => {
    expect(await expectDenied(db, owner, `select public.create_sale($1)`, [{ tenant_id: tenant, branch_id: branch, items: [{ description: "Libre", unit_price: 5, quantity: 1 }] }])).toMatch(/PRODUCT_REQUIRED/);
    await db.query(`update public.products set is_active = false where id = (select product_id from public.product_variants where id = $1)`, [service]);
    expect(await expectDenied(db, owner, `select public.create_sale($1)`, [{ tenant_id: tenant, branch_id: branch, items: [{ variant_id: service, quantity: 1 }] }])).toMatch(/PRODUCT_INACTIVE/);
    await db.query(`update public.products set is_active = true where id = (select product_id from public.product_variants where id = $1)`, [service]);
  });

  it("cotización: borrador editable, enviada, aceptada y convertida al precio actual una sola vez", async () => {
    const q = await quote(seller, { status: "draft", items: [{ variant_id: frame, quantity: 1 }] });
    expect(await expectDenied(db, seller, `select public.convert_quote($1, '[]'::jsonb)`, [q])).toMatch(/QUOTE_NOT_SENT/);
    await quote(seller, { id: q, status: "sent", items: [{ variant_id: frame, quantity: 2 }] });
    expect(Number((await row<{ total: string }>("quotes", q, "total")).total)).toBe(600000);
    await one(seller, `select public.set_quote_status($1, 'accepted') as s`, [q]);
    expect(await expectDenied(db, seller, `select public.save_quote($1)`, [{ tenant_id: tenant, id: q, branch_id: branch, patient_id: patient, status: "sent", items: [{ variant_id: frame, quantity: 1 }] }])).toMatch(/QUOTE_LOCKED/);

    await db.query(`update public.product_variants set price = 320000 where id = $1`, [frame]);
    const check = await one<{ c: { eligible: boolean; quoted_total: string; current_total: string; lines: { quoted_price: number; current_price: number; available: number }[] } }>(seller, `select public.quote_conversion_check($1) as c`, [q]);
    expect(check.c.eligible).toBe(true);
    expect(Number(check.c.current_total)).toBe(640000);
    expect(check.c.lines[0]).toMatchObject({ quoted_price: 300000, current_price: 320000 });

    const s1 = (await one<{ id: string }>(seller, `select public.convert_quote($1, $2) as id`, [q, [{ method: "card", amount: 100000 }]])).id;
    const s2 = (await one<{ id: string }>(seller, `select public.convert_quote($1, $2) as id`, [q, [{ method: "card", amount: 100000 }]])).id;
    expect(s2).toBe(s1);
    const s = await row<{ total: string; quote_id: string; payment_status: string }>("sales", s1, "total, quote_id, payment_status");
    expect(s).toMatchObject({ total: "640000.00", quote_id: q, payment_status: "partial" });
    expect(await row("quotes", q, "status, sale_id")).toEqual({ status: "converted", sale_id: s1 });
    await db.query(`update public.product_variants set price = 300000 where id = $1`, [frame]);
  });

  it("rechazar pide motivo y una cotización vencida no se convierte", async () => {
    const q = await quote(seller, { status: "sent", items: [{ variant_id: service, quantity: 1 }] });
    expect(await expectDenied(db, seller, `select public.set_quote_status($1, 'rejected', '')`, [q])).toMatch(/REASON_REQUIRED/);
    await one(seller, `select public.set_quote_status($1, 'rejected', 'Le pareció caro') as s`, [q]);
    expect(await expectDenied(db, seller, `select public.convert_quote($1, '[]'::jsonb)`, [q])).toMatch(/QUOTE_NOT_CONVERTIBLE/);

    const old = await quote(seller, { status: "sent", items: [{ variant_id: service, quantity: 1 }] });
    await db.query(`update public.quotes set valid_until = current_date - 1 where id = $1`, [old]); // superuser: past the RPC guard
    expect(await expectDenied(db, seller, `select public.convert_quote($1, '[]'::jsonb)`, [old])).toMatch(/QUOTE_EXPIRED/);
    expect((await one<{ c: { status: string; eligible: boolean } }>(seller, `select public.quote_conversion_check($1) as c`, [old])).c).toMatchObject({ status: "expired", eligible: false });
    expect((await one<{ s: string }>(seller, `select public.set_quote_status($1, 'accepted') as s`, [old])).s).toBe("expired");
    expect((await row<{ status: string }>("quotes", old, "status")).status).toBe("expired");
  });

  it("indicadores: ventas netas sin IVA, cotizaciones abiertas y conversión por cohorte", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const o = await one<{ o: Record<string, number> }>(owner, `select public.sales_overview($1, $2, $3) as o`, [tenant, "2020-01-01", "2100-01-01"]);
    const sums = await db.query<{ net: string; n: string }>(`select sum(total - tax_total) as net, count(*) as n from public.sales where tenant_id = $1 and status in ('completed', 'partially_returned')`, [tenant]);
    expect(Number(o.o.net_sales)).toBeCloseTo(Number(sums.rows[0]!.net), 2);
    expect(Number(o.o.sales_count)).toBe(Number(sums.rows[0]!.n));
    // Quotes created above: one draft converted, one rejected, one expired → 3 issued (no draft left), 1 converted.
    expect(o.o).toMatchObject({ issued_quotes: 3, converted_quotes: 1, open_quotes: 0 });
    await quote(seller, { status: "sent", valid_until: today, items: [{ variant_id: service, quantity: 1 }] });
    const o2 = await one<{ o: Record<string, number> }>(owner, `select public.sales_overview($1, $2, $3) as o`, [tenant, "2020-01-01", "2100-01-01"]);
    expect(o2.o).toMatchObject({ open_quotes: 1, issued_quotes: 4 });
  });

  it("lista de operaciones: busca por cliente, producto y número, y filtra por tipo y estado", async () => {
    type Op = { kind: string; number: string; status: string; total_count: number };
    const ops = (args: string, params: unknown[] = []) =>
      asUser(db, owner, async () => (await db.query<Op>(`select * from public.sales_operations($1${args})`, [tenant, ...params])).rows);
    const all = await ops("");
    expect(all.length).toBeGreaterThan(0);
    expect(Number(all[0]!.total_count)).toBe(all.length);
    expect((await ops(", p_query => $2", ["Eva"])).length).toBe(all.length); // every operation is Eva's
    expect((await ops(", p_query => $2", ["777"])).length).toBe(all.length); // by document
    expect((await ops(", p_kind => 'sale', p_query => $2", ["Examen"])).every((r) => r.kind === "sale")).toBe(true);
    expect((await ops(", p_kind => 'quote', p_status => 'expired'")).map((r) => r.status)).toEqual(["expired"]);
    const first = all.find((r) => r.kind === "sale")!;
    expect((await ops(", p_query => $2", [first.number])).map((r) => r.number)).toContain(first.number);
    expect((await ops(", p_kind => 'sale', p_payment => 'paid'")).length).toBeGreaterThan(0);
    expect((await ops(", p_kind => 'void'")).length).toBe(0);
    expect((await ops(", p_query => $2", ["nadie-zzz"])).length).toBe(0);
  });

  it("borrador: no descuenta stock ni cuenta; al confirmar se crea la venta y el borrador desaparece", async () => {
    const stock = async () => Number((await db.query<{ q: string }>(`select quantity as q from public.inventory_levels where branch_id = $1 and variant_id = $2`, [branch, frame])).rows[0]!.q);
    await one(owner, `select public.record_movement($1) as id`, [{ tenant_id: tenant, branch_id: branch, variant_id: frame, type: "adjustment", quantity: 2, notes: "Reposición para la prueba" }]);
    const before = await stock();
    const draft = (await one<{ id: string }>(seller, `select public.save_sale_draft($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, items: [{ variant_id: frame, quantity: 1 }] }])).id;
    const d = await row<{ status: string; number: string; total: string }>("sales", draft, "status, number, total");
    expect(d.status).toBe("draft");
    expect(d.number).toMatch(/^BOR-/);
    expect(await stock()).toBe(before);
    expect(await expectDenied(db, seller, `select public.add_sale_payment($1, $2)`, [draft, [{ method: "cash", amount: 1000 }]])).toMatch(/SALE_IS_DRAFT/);
    await one(seller, `select public.save_sale_draft($1) as id`, [{ tenant_id: tenant, id: draft, branch_id: branch, patient_id: patient, items: [{ variant_id: frame, quantity: 1 }, { variant_id: service, quantity: 1 }] }]);
    expect(Number((await row<{ total: string }>("sales", draft, "total")).total)).toBe(350000);

    const key = `confirm-${suffix}`;
    const payload = { tenant_id: tenant, branch_id: branch, patient_id: patient, draft_id: draft, idempotency_key: key,
      items: [{ variant_id: frame, quantity: 1 }, { variant_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 50000 }] };
    const saleId = (await one<{ id: string }>(seller, `select public.create_sale($1) as id`, [payload])).id;
    expect((await one<{ id: string }>(seller, `select public.create_sale($1) as id`, [payload])).id).toBe(saleId);
    expect((await db.query(`select 1 from public.sales where id = $1`, [draft])).rowCount).toBe(0);
    const s = await row<{ status: string; number: string; payment_status: string }>("sales", saleId, "status, number, payment_status");
    expect(s).toMatchObject({ status: "completed", payment_status: "partial" });
    expect(s.number).toMatch(/^V-/);
    expect(await stock()).toBe(before - 1);
  });

  it("vincula una orden óptica abierta del mismo cliente al confirmar, y rechaza la de otro cliente", async () => {
    const other = (await one<{ id: string }>(owner, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name) values ($1, 'CC', '888', 'Otro', 'Cliente') returning id`, [tenant])).id;
    const order = (await one<{ id: string }>(owner, `insert into public.lab_orders (tenant_id, branch_id, patient_id, number) values ($1, $2, $3, '') returning id`, [tenant, branch, patient])).id;
    const foreign = (await one<{ id: string }>(owner, `insert into public.lab_orders (tenant_id, branch_id, patient_id, number) values ($1, $2, $3, '') returning id`, [tenant, branch, other])).id;
    expect(await expectDenied(db, seller, `select public.create_sale($1)`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, lab_order_id: foreign,
      items: [{ variant_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 50000 }] }])).toMatch(/LAB_ORDER_NOT_LINKABLE/);
    const saleId = (await one<{ id: string }>(seller, `select public.create_sale($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, lab_order_id: order,
      items: [{ variant_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 50000 }] }])).id;
    expect((await row<{ sale_id: string }>("lab_orders", order, "sale_id")).sale_id).toBe(saleId);
  });
});
