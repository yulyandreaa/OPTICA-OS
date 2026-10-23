/**
 * Sedes: elegir la principal y eliminar (archivar) sedes sin dejar la empresa sin sede ni romper el historial.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied, type Db } from "./helpers";

const suffix = `br${Date.now().toString(36)}`;

describe("sedes", () => {
  let db: Db;
  let owner: string, sales: string, outsider: string;
  let tenant: string, main: string, north: string, south: string;

  const one = async <T,>(uid: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, uid, async () => (await db.query<T>(sql, params)).rows[0]!, { commit: true });
  const blocker = (id: string) => one<{ b: string | null }>(owner, `select public.branch_delete_blocker($1, $2) as b`, [tenant, id]).then((r) => r.b);
  const mainId = async () => (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1 and is_main and deleted_at is null`, [tenant])).rows.map((r) => r.id);

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `o-${suffix}@t.dev`, "Dueña");
    sales = await createAuthUser(db, `s-${suffix}@t.dev`, "Asesor");
    outsider = await createAuthUser(db, `x-${suffix}@t.dev`, "Otra");
    tenant = (await one<{ id: string }>(owner, `select public.create_tenant('Sedes Optica', 'Sedes SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Bogotá', null, null) as id`, [suffix])).id;
    await one(outsider, `select public.create_tenant('Otra', 'Otra SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Cali', null, null) as id`, [`${suffix}-x`]);
    main = (await mainId())[0]!;
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, sales]);
  });
  afterAll(async () => { await db?.end(); });

  it("con una sola sede no se puede eliminar", async () => {
    expect(await expectDenied(db, sales, `select public.delete_branch($1, $2)`, [tenant, main])).toMatch(/FORBIDDEN/);
    expect(await blocker(main)).toBe("BRANCH_LAST");
    expect(await expectDenied(db, owner, `select public.delete_branch($1, $2)`, [tenant, main])).toMatch(/BRANCH_LAST/);
  });

  it("cambiar la principal deja exactamente una", async () => {
    north = (await one<{ id: string }>(owner, `insert into public.branches (tenant_id, name, code) values ($1, 'Norte', 'NOR') returning id`, [tenant])).id;
    south = (await one<{ id: string }>(owner, `insert into public.branches (tenant_id, name, code) values ($1, 'Sur', 'SUR') returning id`, [tenant])).id;
    await one(owner, `select public.set_main_branch($1, $2)`, [tenant, north]);
    expect(await mainId()).toEqual([north]);
    expect(await expectDenied(db, sales, `select public.set_main_branch($1, $2)`, [tenant, main])).toMatch(/FORBIDDEN/);
    expect(await expectDenied(db, outsider, `select public.set_main_branch($1, $2)`, [tenant, main])).toMatch(/FORBIDDEN/);
  });

  it("eliminar la principal con existencias y un usuario: todo pasa a otra sede", async () => {
    const frames = (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = 'frames'`, [tenant])).rows[0]!.id;
    const product = (await one<{ id: string }>(owner, `select public.save_product($1) as id`, [{ tenant_id: tenant, category_id: frames, name: "Aurora", tax_rate: 19,
      is_stocked: true, unit: "unidad", default_min_stock: 1, variants: [{ price: 100000, cost: 40000 }], initial_stock: [{ variant: 0, branch_id: north, quantity: 5 }] }])).id;
    const variant = (await db.query<{ id: string }>(`select id from public.product_variants where product_id = $1`, [product])).rows[0]!.id;
    await db.query(`insert into public.user_roles (tenant_id, user_id, role_id, branch_id) select $1, $2, id, $3 from public.roles where code = 'SALES_REP' and tenant_id is null`, [tenant, sales, north]);
    const impact = await one<{ i: Record<string, unknown> }>(owner, `select public.branch_delete_impact($1, $2) as i`, [tenant, north]);
    expect(impact.i).toMatchObject({ target: "Centro", becomes_main: true, units: 5, users: 1 });
    expect(await blocker(north)).toBeNull();

    await one(owner, `select public.delete_branch($1, $2)`, [tenant, north]);
    expect(await mainId()).toEqual([main]);
    const qty = async (b: string) => Number((await db.query<{ q: string }>(`select quantity as q from public.inventory_levels where branch_id = $1 and variant_id = $2`, [b, variant])).rows[0]?.q ?? 0);
    expect(await qty(north)).toBe(0);
    expect(await qty(main)).toBe(5);
    const roles = (await db.query<{ branch_id: string }>(`select branch_id from public.user_roles where tenant_id = $1 and user_id = $2`, [tenant, sales])).rows;
    expect(roles.map((r) => r.branch_id)).toEqual([main]);
  });

  it("eliminar archiva la sede, quita sus roles y libera el código", async () => {
    await one(owner, `select public.delete_branch($1, $2)`, [tenant, south]);
    const row = (await db.query<{ deleted: boolean; status: string }>(`select deleted_at is not null as deleted, status from public.branches where id = $1`, [south])).rows[0]!;
    expect(row).toEqual({ deleted: true, status: "inactive" });
    await one(owner, `insert into public.branches (tenant_id, name, code) values ($1, 'Sur nueva', 'SUR') returning id`, [tenant]);
    expect(await expectDenied(db, owner, `select public.delete_branch($1, $2)`, [tenant, south])).toMatch(/BRANCH_NOT_FOUND/);
  });
});
