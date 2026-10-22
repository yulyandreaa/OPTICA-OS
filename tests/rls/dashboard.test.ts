/**
 * dashboard_summary (owner dashboard): figures follow docs/dashboard-metrics.md, and only users with
 * reports.financial in the same company can read them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied, type Db } from "./helpers";

const suffix = `db${Date.now().toString(36)}`;

describe("dashboard del administrador", () => {
  let db: Db;
  let owner: string, sales: string, outsider: string;
  let tenant: string, main: string, second: string, patient: string;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

  const one = async <T,>(uid: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, uid, async () => (await db.query<T>(sql, params)).rows[0]!, { commit: true });
  const summary = (uid: string, branch: string | null = null) =>
    one<{ r: Record<string, Record<string, number> & { length?: number }> }>(uid,
      `select public.dashboard_summary($1, $2::date, $2::date, ($2::date - 1), ($2::date - 1), $3, 'day') as r`, [tenant, today, branch]).then((x) => x.r);

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `o-${suffix}@t.dev`, "Dueña");
    sales = await createAuthUser(db, `s-${suffix}@t.dev`, "Asesor");
    outsider = await createAuthUser(db, `x-${suffix}@t.dev`, "Otra empresa");
    tenant = (await one<{ id: string }>(owner, `select public.create_tenant('Dash Optica', 'Dash SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Bogotá', null, null) as id`, [suffix])).id;
    await one(outsider, `select public.create_tenant('Otra', 'Otra SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Cali', null, null) as id`, [`${suffix}-x`]);
    main = (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1 and is_main`, [tenant])).rows[0]!.id;
    second = (await one<{ id: string }>(owner, `insert into public.branches (tenant_id, name, code) values ($1, 'Norte', 'NOR') returning id`, [tenant])).id;
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, sales]);
    await db.query(`insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where code = 'SALES_REP' and tenant_id is null`, [tenant, sales]);
    patient = (await one<{ id: string }>(owner, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name, birth_date, sex)
      values ($1, 'CC', '1010', 'Ana', 'Ruiz', '1990-01-01', 'F') returning id`, [tenant])).id;

    const cat = (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = 'frames'`, [tenant])).rows[0]!.id;
    const prod = (await one<{ id: string }>(owner, `insert into public.products (tenant_id, category_id, name) values ($1, $2, 'Montura') returning id`, [tenant, cat])).id;
    const frame = (await one<{ id: string }>(owner, `insert into public.product_variants (tenant_id, product_id, sku, price, cost) values ($1, $2, 'M-1', 119000, 40000) returning id`, [tenant, prod])).id;
    await one(owner, `insert into public.inventory_movements (tenant_id, branch_id, variant_id, type, quantity) values ($1, $2, $3, 'initial', 3) returning id`, [tenant, main, frame]);

    const sale = (branch: string, items: unknown[], payments: unknown[]) =>
      one<{ id: string }>(owner, `select public.create_sale($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: patient, items, payments }]).then((x) => x.id);
    // A: frame with cost, fully paid in cash. Net = 119000/1.19 = 100000, cost 40000 → margin 60000.
    await sale(main, [{ variant_id: frame, quantity: 1 }], [{ method: "cash", amount: 119000 }]);
    // B: free-text lens with no cost, half paid. Net 200000, no cost → lowers coverage. Balance 119000.
    await sale(second, [{ description: "Lente progresivo", unit_price: 238000, quantity: 1 }], [{ method: "card", amount: 119000 }]);
    // C: cancelled sale → excluded from net sales, collected and receivables.
    const cancelled = await sale(main, [{ description: "Estuche", unit_price: 59500, quantity: 1 }], [{ method: "cash", amount: 10000 }]);
    await db.query(`update public.sales set status = 'cancelled' where id = $1`, [cancelled]);
    // D: 45-day-old sale with balance → overdue receivable, outside today's period.
    const old = await sale(main, [{ description: "Gafas de sol", unit_price: 119000, quantity: 1 }], []);
    await db.query(`update public.sales set created_at = now() - interval '45 days' where id = $1`, [old]);

    const lab = (await one<{ id: string }>(owner, `insert into public.labs (tenant_id, name) values ($1, 'Lab X') returning id`, [tenant])).id;
    await one(owner, `insert into public.lab_orders (tenant_id, branch_id, patient_id, lab_id, number, status, estimated_at)
      values ($1, $2, $3, $4, '', 'sent', current_date - 3) returning id`, [tenant, main, patient, lab]);
  });
  afterAll(async () => { await db?.end(); });

  it("calcula ventas netas sin IVA, excluyendo anuladas", async () => {
    const r = await summary(owner);
    expect(r.current!.net_sales).toBe(300000);
    expect(r.current!.sales_count).toBe(2);
    expect(r.current!.voided_count).toBe(1);
  });

  it("el margen solo usa líneas con costo y reporta la cobertura", async () => {
    const r = await summary(owner);
    expect(r.current!.margin).toBe(60000);
    expect(r.current!.costed_net).toBe(100000);
    expect(r.current!.items_net).toBe(300000);
    expect(r.current!.uncosted_lines).toBe(1);
  });

  it("el recaudo suma pagos del período, sin el pago de la venta anulada", async () => {
    expect((await summary(owner)).current!.collected).toBe(238000);
  });

  it("la cartera es el saldo vigente total y la vencida la de más de 30 días", async () => {
    const r = await summary(owner);
    expect(r.receivables).toMatchObject({ total: 238000, count: 2, overdue_total: 119000, overdue_count: 1 });
  });

  it("filtra por sede y compara sedes", async () => {
    const r = await summary(owner, second);
    expect(r.current!.net_sales).toBe(200000);
    const branches = (await summary(owner)).by_branch as unknown as { name: string; net: number }[];
    expect(branches.map((b) => [b.name, b.net])).toEqual([["Norte", 200000], ["Centro", 100000]]);
  });

  it("alerta órdenes atrasadas", async () => {
    expect((await summary(owner)).alerts!.late_lab_orders).toBe(1);
  });

  it("el asesor comercial no puede ver los indicadores financieros", async () => {
    const msg = await expectDenied(db, sales, `select public.dashboard_summary($1, current_date, current_date, current_date - 1, current_date - 1, null, 'day')`, [tenant]);
    expect(msg).toMatch(/FORBIDDEN/);
  });

  it("otra empresa no puede consultar este dashboard", async () => {
    const msg = await expectDenied(db, outsider, `select public.dashboard_summary($1, current_date, current_date, current_date - 1, current_date - 1, null, 'day')`, [tenant]);
    expect(msg).toMatch(/FORBIDDEN/);
  });
});
