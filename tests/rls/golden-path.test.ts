/**
 * Golden path (section 72) at the database level, with real RLS:
 * consulta → firma → fórmula → venta (pagos mixtos, stock) → cotización → orden de laboratorio → QC → entrega → tracking → reportes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied, type Db } from "./helpers";

const suffix = `gp${Date.now().toString(36)}`;

describe("golden path", () => {
  let db: Db;
  let owner: string, opto: string, sales: string, recep: string, outsider: string;
  let tenant: string, branch: string, patient: string, record: string, frameVariant: string, lensVariant: string, saleId: string;

  const one = async <T,>(uid: string | null, sql: string, params: unknown[] = [], commit = true) =>
    asUser(db, uid, async () => (await db.query<T>(sql, params)).rows[0]!, { commit });

  async function member(uid: string, role: string) {
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, uid]);
    await db.query(`insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where code = $3 and tenant_id is null`, [tenant, uid, role]);
  }

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `o-${suffix}@t.dev`, "Owner");
    opto = await createAuthUser(db, `op-${suffix}@t.dev`, "Optómetra");
    sales = await createAuthUser(db, `s-${suffix}@t.dev`, "Asesora");
    recep = await createAuthUser(db, `r-${suffix}@t.dev`, "Recepción");
    outsider = await createAuthUser(db, `x-${suffix}@t.dev`, "Otro");
    tenant = (await one<{ id: string }>(owner, `select public.create_tenant('GP Optica', 'GP SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Bogotá', null, null) as id`, [suffix])).id;
    await one(outsider, `select public.create_tenant('Otra', 'Otra SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Cali', null, null) as id`, [`${suffix}-x`]);
    branch = (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1`, [tenant])).rows[0]!.id;
    await db.query(`update public.subscriptions set plan_id = (select id from public.plans where code = 'BUSINESS') where tenant_id = $1`, [tenant]);
    await member(opto, "OPTOMETRIST");
    await member(sales, "SALES_REP");
    await member(recep, "RECEPTIONIST");
    patient = (await one<{ id: string }>(recep, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name, birth_date, sex)
      values ($1, 'CC', '52123456', 'Lucía', 'Pardo', '1985-04-12', 'F') returning id`, [tenant])).id;
  });
  afterAll(async () => { await db?.end(); });

  it("la optómetra crea y firma la historia; se genera la fórmula", async () => {
    record = (await one<{ id: string }>(opto, `insert into public.medical_records (tenant_id, branch_id, patient_id, professional_id, number, chief_complaint, exam, diagnoses, lens_recommendation)
      values ($1, $2, $3, auth.uid(), '', 'Visión borrosa de lejos', $4, $5, $6) returning id`, [tenant, branch, patient,
      { refraction: { od: { sphere: "-1.25", cylinder: "-0.50", axis: "180", add: "", va: "20/20" }, oi: { sphere: "-1.00", cylinder: "", axis: "", va: "20/20" } }, dp: { binocular: "62" } },
      [{ code: "H52.1", label: "Miopía" }], { type: "monofocal", material: "policarbonato", treatments: ["antirreflejo", "filtro_azul"], text: "  Monofocal en policarbonato con antirreflejo.  " }])).id;
    const res = await one<{ r: { prescription_id: string } }>(opto, `select public.sign_medical_record($1) as r`, [record]);
    expect(res.r.prescription_id).toBeTruthy();
    const rx = await one<{ od_sphere: string; material: string; treatments: string[]; notes: string }>(opto, `select od_sphere, material, treatments, notes from public.prescriptions where record_id = $1`, [record]);
    expect(Number(rx.od_sphere)).toBe(-1.25);
    expect(rx.treatments).toContain("antirreflejo");
    expect(rx.notes).toBe("Monofocal en policarbonato con antirreflejo."); // free-text recommendation, trimmed
  });

  it("una historia firmada no se puede editar ni borrar; solo enmendar con motivo", async () => {
    expect(await expectDenied(db, opto, `update public.medical_records set plan = 'x' where id = $1`, [record])).toMatch(/RECORD_SIGNED/);
    // No DELETE policy: the statement affects 0 rows (and a trigger blocks it even for privileged roles).
    const deleted = await asUser(db, opto, async () => (await db.query(`delete from public.medical_records where id = $1`, [record])).rowCount);
    expect(deleted).toBe(0);
    await expect(db.query(`delete from public.medical_records where id = $1`, [record])).rejects.toThrow(/CLINICAL_DELETE_FORBIDDEN/);
    await one(opto, `select public.amend_medical_record($1, 'Corrección del plan de control', $2) as id`, [record, { plan: "Control en 12 meses" }]);
    const am = await one<{ n: number; status: string }>(opto, `select (select count(*)::int from public.medical_record_amendments where record_id = $1) as n, status from public.medical_records where id = $1`, [record]);
    expect(am).toEqual({ n: 1, status: "amended" });
  });

  it("asesora y recepción NO ven la historia clínica; la asesora SÍ ve la fórmula", async () => {
    expect((await asUser(db, sales, async () => (await db.query(`select id from public.medical_records`)).rowCount))).toBe(0);
    expect((await asUser(db, recep, async () => (await db.query(`select id from public.medical_records`)).rowCount))).toBe(0);
    expect((await asUser(db, sales, async () => (await db.query(`select id from public.prescriptions`)).rowCount))).toBe(1);
  });

  it("el stock solo cambia mediante movimientos", async () => {
    const cat = (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = 'frames'`, [tenant])).rows[0]!.id;
    const svc = (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = 'ophthalmic_lenses'`, [tenant])).rows[0]!.id;
    const prod = (await one<{ id: string }>(owner, `insert into public.products (tenant_id, category_id, name) values ($1, $2, 'Aurora') returning id`, [tenant, cat])).id;
    frameVariant = (await one<{ id: string }>(owner, `insert into public.product_variants (tenant_id, product_id, sku, color_name, price) values ($1, $2, 'AUR-AZ', 'Azul', 485000) returning id`, [tenant, prod])).id;
    await one(owner, `insert into public.variant_costs (tenant_id, variant_id, avg_cost) values ($1, $2, 190000) returning variant_id`, [tenant, frameVariant]);
    const lens = (await one<{ id: string }>(owner, `insert into public.products (tenant_id, category_id, name, is_stocked) values ($1, $2, 'Lente monofocal policarbonato AR', false) returning id`, [tenant, svc])).id;
    lensVariant = (await one<{ id: string }>(owner, `insert into public.product_variants (tenant_id, product_id, sku, price) values ($1, $2, 'LEN-MONO-PC', 380000) returning id`, [tenant, lens])).id;
    await one(owner, `insert into public.variant_costs (tenant_id, variant_id, avg_cost) values ($1, $2, 120000) returning variant_id`, [tenant, lensVariant]);
    await one(owner, `insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity) values ($1, $2, $3, 'initial', 3) returning id`, [tenant, branch, frameVariant]);
    expect(await expectDenied(db, owner, `update public.inventory_levels set quantity = 99 where variant_id = $1`, [frameVariant])).toMatch(/STOCK_DIRECT_EDIT_FORBIDDEN/);
    const deleted = await asUser(db, owner, async () => (await db.query(`delete from public.inventory_movements where variant_id = $1`, [frameVariant])).rowCount);
    expect(deleted).toBe(0);
    await expect(db.query(`delete from public.inventory_movements where variant_id = $1`, [frameVariant])).rejects.toThrow(/append-only/);
  });

  it("venta con pagos mixtos, descuento de stock e idempotencia", async () => {
    const payload = {
      tenant_id: tenant, branch_id: branch, patient_id: patient, idempotency_key: `sale-${suffix}`,
      items: [{ variant_id: frameVariant, quantity: 1 }, { variant_id: lensVariant, quantity: 1 }],
      payments: [{ method: "cash", amount: 200000 }, { method: "card", amount: 300000 }],
    };
    saleId = (await one<{ id: string }>(sales, `select public.create_sale($1) as id`, [payload])).id;
    const again = (await one<{ id: string }>(sales, `select public.create_sale($1) as id`, [payload])).id;
    expect(again).toBe(saleId);
    const s = await one<{ total: string; paid_total: string; balance: string; status: string; payment_status: string; tax_total: string }>(sales, `select total, paid_total, balance, status, payment_status, tax_total from public.sales where id = $1`, [saleId]);
    expect(Number(s.total)).toBe(865000);
    expect(Number(s.balance)).toBe(365000);
    expect(s.status).toBe("completed");
    expect(s.payment_status).toBe("partial");
    expect(Number(s.tax_total)).toBeCloseTo(865000 - 865000 / 1.19, 0);
    const lvl = await one<{ quantity: string }>(owner, `select quantity from public.inventory_levels where variant_id = $1`, [frameVariant]);
    expect(Number(lvl.quantity)).toBe(2);
  });

  it("la asesora sin permiso no puede aplicar descuentos ni sobrepagar", async () => {
    expect(await expectDenied(db, sales, `select public.create_sale($1)`, [{ tenant_id: tenant, branch_id: branch, items: [{ variant_id: frameVariant, quantity: 1, discount: 50000 }] }])).toMatch(/DISCOUNT_FORBIDDEN/);
    expect(await expectDenied(db, sales, `select public.add_sale_payment($1, $2)`, [saleId, [{ method: "cash", amount: 999999 }]])).toMatch(/PAYMENT_EXCEEDS_TOTAL/);
  });

  it("cotización → venta sin reescribir", async () => {
    const q = (await one<{ id: string }>(sales, `select public.save_quote($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, status: "sent", items: [{ variant_id: frameVariant, quantity: 1 }] }])).id;
    const sale = (await one<{ id: string }>(sales, `select public.convert_quote($1, $2) as id`, [q, [{ method: "nequi", amount: 485000 }]])).id;
    const st = await one<{ status: string; sale_id: string }>(sales, `select status, sale_id from public.quotes where id = $1`, [q]);
    expect(st).toEqual({ status: "converted", sale_id: sale });
  });

  it("orden de laboratorio: QC obligatorio y entrega solo con saldo en cero", async () => {
    const order = (await one<{ id: string }>(sales, `insert into public.lab_orders (tenant_id, branch_id, patient_id, sale_id, number, frame_description)
      values ($1, $2, $3, $4, '', 'Aurora azul') returning id`, [tenant, branch, patient, saleId])).id;
    for (const st of ["sent", "in_process", "quality_control"]) await one(owner, `select public.advance_lab_order($1, $2) as s`, [order, st]);
    expect(await expectDenied(db, owner, `select public.advance_lab_order($1, 'ready', null, $2)`, [order, { formula: true }])).toMatch(/QC_INCOMPLETE/);
    const checklist = { formula: true, centering: true, height: true, frame: true, treatment: true, physical: true };
    await one(owner, `select public.advance_lab_order($1, 'ready', null, $2) as s`, [order, checklist]);
    await one(owner, `select public.advance_lab_order($1, 'received') as s`, [order]);
    expect(await expectDenied(db, owner, `select public.advance_lab_order($1, 'delivered')`, [order])).toMatch(/BALANCE_PENDING/);
    await one(sales, `select public.add_sale_payment($1, $2) as b`, [saleId, [{ method: "transfer", amount: 365000 }]]);
    await one(owner, `select public.advance_lab_order($1, 'delivered', 'Entregado con estuche') as s`, [order]);

    const token = (await db.query<{ tracking_token: string }>(`select tracking_token from public.lab_orders where id = $1`, [order])).rows[0]!.tracking_token;
    const tracked = await one<{ t: Record<string, unknown> }>(null, `select public.track_lab_order($1) as t`, [token]);
    expect(tracked.t.status).toBe("delivered");
    expect(JSON.stringify(tracked.t)).not.toMatch(/52123456|Miopía|sphere/);
  });

  it("otro tenant no ve ventas, órdenes ni fórmulas", async () => {
    for (const table of ["sales", "lab_orders", "prescriptions", "medical_records", "inventory_levels"]) {
      expect((await asUser(db, outsider, async () => (await db.query(`select 1 from public.${table}`)).rowCount))).toBe(0);
    }
  });

  it("el reporte de ventas agrega solo datos del tenant", async () => {
    const r = await one<{ r: { total: number; count: number; by_method: { method: string }[] } }>(owner,
      `select public.report_sales($1, current_date - 1, current_date + 1) as r`, [tenant]);
    expect(Number(r.r.total)).toBe(865000 + 485000);
    expect(r.r.count).toBe(2);
    expect(r.r.by_method.map((m) => m.method).sort()).toEqual(["card", "cash", "nequi", "transfer"]);
  });
});
