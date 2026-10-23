/**
 * Clientes y pacientes: one record per person and company, roles that coexist and get added by real
 * activity, deactivation without losing history, duplicate hints and isolation between companies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied, type Db } from "./helpers";

const suffix = `pp${Date.now().toString(36)}`;

describe("clientes y pacientes", () => {
  let db: Db;
  let owner: string, sales: string, outsider: string;
  let tenant: string, otherTenant: string, branch: string, ana: string, luis: string;

  const one = async <T,>(uid: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, uid, async () => (await db.query<T>(sql, params)).rows[0]!, { commit: true });
  const person = (uid: string, doc: string, first: string, last: string, flags: { customer: boolean; patient: boolean }, extra = "") =>
    one<{ id: string }>(uid, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name, is_customer, is_patient${extra ? ", phone" : ""})
      values ($1, 'CC', $2, $3, $4, $5, $6${extra ? ", $7" : ""}) returning id`, [tenant, doc, first, last, flags.customer, flags.patient, ...(extra ? [extra] : [])]).then((r) => r.id);
  const flags = (id: string) => one<{ is_customer: boolean; is_patient: boolean; is_active: boolean }>(owner, `select is_customer, is_patient, is_active from public.patients where id = $1`, [id]);

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `o-${suffix}@t.dev`, "Dueño");
    sales = await createAuthUser(db, `s-${suffix}@t.dev`, "Asesor");
    outsider = await createAuthUser(db, `x-${suffix}@t.dev`, "Otra");
    tenant = (await one<{ id: string }>(owner, `select public.create_tenant('PP Optica', 'PP SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Bogotá', null, null) as id`, [suffix])).id;
    otherTenant = (await one<{ id: string }>(outsider, `select public.create_tenant('Otra', 'Otra SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Cali', null, null) as id`, [`${suffix}-x`])).id;
    branch = (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1`, [tenant])).rows[0]!.id;
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, sales]);
    await db.query(`insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where code = 'SALES_REP' and tenant_id is null`, [tenant, sales]);
    ana = await person(sales, "52000111", "Ana", "Mora", { customer: true, patient: false }, "3001234567");
    luis = await person(sales, "80000222", "Luis", "Rey", { customer: false, patient: true });
  });
  afterAll(async () => { await db?.end(); });

  it("una persona necesita al menos un rol", async () => {
    const msg = await expectDenied(db, sales, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name, is_customer, is_patient)
      values ($1, 'CC', '1112223', 'Sin', 'Rol', false, false)`, [tenant]);
    expect(msg).toMatch(/patients_has_role/);
  });

  it("el mismo documento no se puede registrar dos veces en la empresa", async () => {
    const msg = await expectDenied(db, sales, `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name) values ($1, 'CC', '52000111', 'Ana', 'Otra')`, [tenant]);
    expect(msg).toMatch(/duplicate key|patients_document_uq/);
  });

  it("una venta convierte al paciente también en cliente", async () => {
    const cat = (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = 'frames'`, [tenant])).rows[0]!.id;
    const product = (await db.query<{ id: string }>(`insert into public.products (tenant_id, category_id, name, is_stocked) values ($1, $2, 'Estuche', false) returning id`, [tenant, cat])).rows[0]!.id;
    const variant = (await db.query<{ id: string }>(`insert into public.product_variants (tenant_id, product_id, sku, price) values ($1, $2, 'EST-1', 20000) returning id`, [tenant, product])).rows[0]!.id;
    await one(sales, `select public.create_sale($1) as id`, [{ tenant_id: tenant, branch_id: branch, patient_id: luis, items: [{ variant_id: variant, quantity: 1 }], payments: [] }]);
    expect(await flags(luis)).toMatchObject({ is_customer: true, is_patient: true });
  });

  it("una cita convierte al cliente también en paciente", async () => {
    const type = (await db.query<{ id: string }>(`select id from public.appointment_types where tenant_id = $1 limit 1`, [tenant])).rows[0]!.id;
    await db.query(`insert into public.appointments (tenant_id, branch_id, patient_id, appointment_type_id, starts_at, ends_at) values ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day 30 minutes')`, [tenant, branch, ana, type]);
    expect(await flags(ana)).toMatchObject({ is_customer: true, is_patient: true });
  });

  it("el resumen cuenta roles superpuestos y personas únicas", async () => {
    const r = await one<{ r: Record<string, number> }>(owner, `select public.people_summary($1) as r`, [tenant]);
    expect(r.r).toMatchObject({ total: 2, customers: 2, patients: 2, both: 2, inactive: 0 });
  });

  it("el asesor no puede desactivar; el administrador sí, y la historia se conserva", async () => {
    expect(await expectDenied(db, sales, `update public.patients set is_active = false where id = $1`, [luis])).toMatch(/FORBIDDEN/);
    await one(owner, `update public.patients set is_active = false where id = $1 returning id`, [luis]);
    const p = await one<{ is_active: boolean; deactivated_by: string; sales: number }>(owner,
      `select is_active, deactivated_by, (select count(*)::int from public.sales where patient_id = $1) as sales from public.patients where id = $1`, [luis]);
    expect(p).toEqual({ is_active: false, deactivated_by: owner, sales: 1 });
    const trace = await one<{ titles: string[] }>(owner, `select array_agg(title order by occurred_at) as titles from public.patient_activities where patient_id = $1`, [luis]);
    expect(trace.titles).toEqual(expect.arrayContaining(["Registrado como paciente", "Ahora también es cliente", "Registro desactivado"]));
    const r = await one<{ r: Record<string, number> }>(owner, `select public.people_summary($1) as r`, [tenant]);
    expect(r.r).toMatchObject({ total: 1, inactive: 1 });
  });

  it("detecta posibles duplicados sin bloquear por teléfono compartido", async () => {
    const rows = await asUser(db, sales, async () => (await db.query<{ full_name: string; reasons: string[] }>(
      `select full_name, reasons from public.find_person_matches($1, 'CE', '52000111', 'Ana', 'Mora', null, '3001234567', null)`, [tenant])).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reasons.sort()).toEqual(["document_number", "name", "phone"]);
  });

  it("otra empresa no ve, no busca ni modifica estas personas", async () => {
    const seen = await asUser(db, outsider, async () => (await db.query(`select id from public.patients where tenant_id = $1`, [tenant])).rowCount);
    expect(seen).toBe(0);
    const matches = await asUser(db, outsider, async () => (await db.query(`select * from public.find_person_matches($1, 'CC', '52000111', 'Ana', 'Mora')`, [tenant])).rowCount);
    expect(matches).toBe(0);
    const updated = await asUser(db, outsider, async () => (await db.query(`update public.patients set first_name = 'X' where id = $1`, [ana])).rowCount);
    expect(updated).toBe(0);
    const summary = await one<{ r: Record<string, number> }>(outsider, `select public.people_summary($1) as r`, [tenant]);
    expect(summary.r.total).toBe(0);
    expect(otherTenant).toBeTruthy();
  });
});
