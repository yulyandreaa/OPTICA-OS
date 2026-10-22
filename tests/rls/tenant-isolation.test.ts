/**
 * Multitenant security tests (section 115). Run against a disposable DB:
 *   npx tsx scripts/db/local-pg.ts & DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres npm run db:migrate
 *   DATABASE_URL=… npx vitest run tests/rls
 */
import type { Db } from "./helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied } from "./helpers";

const run = describe;
const suffix = Date.now().toString(36);

run("tenant isolation & RBAC", () => {
  let db: Db;
  let ownerA: string, ownerB: string, receptionA: string, salesA: string;
  let tenantA: string, tenantB: string, branchA1: string, branchA2: string, patientA: string;

  const createTenant = (uid: string, name: string) =>
    asUser(db, uid, async () => {
      const { rows } = await db.query<{ id: string }>(
        `select public.create_tenant($1, $2, $3, 'NIT', null, null, 'responsable_iva', 'optometry', 'Principal', 'Bogotá', null, null) as id`,
        [name, `${name} SAS`, `${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}`],
      );
      return rows[0]!.id;
    }, { commit: true });

  async function addMember(tenant: string, uid: string, roleCode: string, branch: string | null) {
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, uid]);
    await db.query(
      `insert into public.user_roles (tenant_id, user_id, role_id, branch_id)
       select $1, $2, id, $4 from public.roles where code = $3 and tenant_id is null`, [tenant, uid, roleCode, branch]);
  }

  beforeAll(async () => {
    db = await connect();
    ownerA = await createAuthUser(db, `owner-a-${suffix}@test.dev`, "Owner A");
    ownerB = await createAuthUser(db, `owner-b-${suffix}@test.dev`, "Owner B");
    receptionA = await createAuthUser(db, `recep-a-${suffix}@test.dev`, "Recepción A");
    salesA = await createAuthUser(db, `sales-a-${suffix}@test.dev`, "Ventas A");

    tenantA = await createTenant(ownerA, "Optica A");
    tenantB = await createTenant(ownerB, "Optica B");

    branchA1 = (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1 and is_main`, [tenantA])).rows[0]!.id;
    branchA2 = await asUser(db, ownerA, async () =>
      (await db.query<{ id: string }>(`insert into public.branches (tenant_id, name, code) values ($1, 'Cedritos', 'CED') returning id`, [tenantA])).rows[0]!.id,
      { commit: true });

    await addMember(tenantA, receptionA, "RECEPTIONIST", branchA1);
    await addMember(tenantA, salesA, "SALES_REP", null);

    patientA = await asUser(db, ownerA, async () =>
      (await db.query<{ id: string }>(
        `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name)
         values ($1, 'CC', '1010101010', 'Laura', 'Gómez') returning id`, [tenantA])).rows[0]!.id,
      { commit: true });
  });

  afterAll(async () => { await db?.end(); });

  it("create_tenant crea sede principal, membresía OWNER y trial", async () => {
    const { rows } = await db.query(
      `select s.status, (select count(*) from public.user_roles ur join public.roles r on r.id = ur.role_id
                          where ur.tenant_id = $1 and r.code = 'OWNER')::int as owners
       from public.subscriptions s where s.tenant_id = $1`, [tenantA]);
    expect(rows[0]).toEqual({ status: "trialing", owners: 1 });
  });

  it("usuario del tenant A NO puede leer pacientes del tenant B (ni al revés)", async () => {
    const seen = await asUser(db, ownerB, async () => (await db.query(`select id from public.patients where id = $1`, [patientA])).rowCount);
    expect(seen).toBe(0);
    const tenantsVisible = await asUser(db, ownerB, async () => (await db.query(`select id from public.tenants`)).rows.map((r) => r.id));
    expect(tenantsVisible).toEqual([tenantB]);
  });

  it("usuario del tenant B NO puede insertar datos en el tenant A", async () => {
    const msg = await expectDenied(db, ownerB,
      `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name) values ($1, 'CC', '999999', 'X', 'Y')`, [tenantA]);
    expect(msg).toMatch(/row-level security/);
  });

  it("usuario del tenant B NO puede modificar pacientes del tenant A", async () => {
    const updated = await asUser(db, ownerB, async () =>
      (await db.query(`update public.patients set first_name = 'Hack' where id = $1`, [patientA])).rowCount);
    expect(updated).toBe(0);
  });

  it("no se puede cambiar el tenant activo a una empresa ajena", async () => {
    const msg = await expectDenied(db, ownerB, `update public.profiles set active_tenant_id = $1 where id = auth.uid()`, [tenantA]);
    expect(msg).toMatch(/NOT_A_MEMBER/);
  });

  it("recepción de la sede A1 NO ve ni agenda citas en la sede A2", async () => {
    const typeId = (await db.query(`select id from public.appointment_types where tenant_id = $1 and code = 'valoracion'`, [tenantA])).rows[0].id;
    await asUser(db, ownerA, () => db.query(
      `insert into public.appointments (tenant_id, branch_id, patient_id, appointment_type_id, starts_at, ends_at)
       values ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day 30 minutes'),
              ($1, $5, $3, $4, now() + interval '2 day', now() + interval '2 day 30 minutes')`,
      [tenantA, branchA1, patientA, typeId, branchA2]), { commit: true });

    const branches = await asUser(db, receptionA, async () =>
      (await db.query(`select distinct branch_id from public.appointments`)).rows.map((r) => r.branch_id));
    expect(branches).toEqual([branchA1]);

    const msg = await expectDenied(db, receptionA,
      `insert into public.appointments (tenant_id, branch_id, patient_id, appointment_type_id, starts_at, ends_at)
       values ($1, $2, $3, $4, now() + interval '3 day', now() + interval '3 day 30 minutes')`, [tenantA, branchA2, patientA, typeId]);
    expect(msg).toMatch(/row-level security/);
  });

  it("asesor comercial NO puede modificar la configuración de la empresa", async () => {
    const updated = await asUser(db, salesA, async () =>
      (await db.query(`update public.tenants set trade_name = 'Hackeada' where id = $1`, [tenantA])).rowCount);
    expect(updated).toBe(0);
  });

  it("asesor comercial NO puede ver historia clínica / auditoría", async () => {
    const audit = await asUser(db, salesA, async () => (await db.query(`select id from public.audit_logs`)).rowCount);
    expect(audit).toBe(0);
  });

  it("asesor comercial NO puede asignarse roles", async () => {
    const msg = await expectDenied(db, salesA,
      `insert into public.user_roles (tenant_id, user_id, role_id) select $1, auth.uid(), id from public.roles where code = 'OWNER'`, [tenantA]);
    expect(msg).toMatch(/row-level security/);
  });

  it("un usuario no puede auto-promoverse a super admin", async () => {
    const msg = await expectDenied(db, salesA, `update public.profiles set is_platform_admin = true where id = auth.uid()`);
    expect(msg).toMatch(/permission denied/);
  });

  it("la auditoría es append-only y registra cambios de pacientes", async () => {
    const { rows } = await db.query(`select count(*)::int as n from public.audit_logs where entity_type = 'patients' and entity_id = $1`, [patientA]);
    expect(rows[0].n).toBeGreaterThan(0);
    await expect(db.query(`delete from public.audit_logs where entity_id = $1`, [patientA])).rejects.toThrow(/append-only/);
  });

  it("anon no puede leer tablas de tenants", async () => {
    await expect(asUser(db, null, () => db.query(`select * from public.patients`))).rejects.toThrow(/permission denied/);
  });

  it("los límites del plan se aplican en la BD (Starter = 1 sede)", async () => {
    await db.query(`update public.subscriptions set plan_id = (select id from public.plans where code = 'STARTER') where tenant_id = $1`, [tenantB]);
    const msg = await expectDenied(db, ownerB, `insert into public.branches (tenant_id, name, code) values ($1, 'Segunda', 'SEG')`, [tenantB]);
    expect(msg).toMatch(/PLAN_LIMIT_BRANCHES/);
  });

  it("documento duplicado de paciente en el mismo tenant es rechazado", async () => {
    const msg = await expectDenied(db, ownerA,
      `insert into public.patients (tenant_id, document_type, document_number, first_name, last_name) values ($1, 'CC', '1010101010', 'Otra', 'Persona')`, [tenantA]);
    expect(msg).toMatch(/patients_document_uq/);
  });
});

run("invitations", () => {
  let db: Db;
  let owner: string, invitee: string, intruder: string, tenant: string;
  const hash = `hash-${suffix}`;

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `inv-owner-${suffix}@test.dev`, "Owner");
    invitee = await createAuthUser(db, `invitee-${suffix}@test.dev`, "Invitee");
    intruder = await createAuthUser(db, `intruder-${suffix}@test.dev`, "Intruder");
    tenant = await asUser(db, owner, async () => (await db.query<{ id: string }>(
      `select public.create_tenant('Inv Optica', 'Inv SAS', $1, 'NIT', null, null, null, 'optometry', 'Principal', 'Cali', null, null) as id`, [`inv-${suffix}`])).rows[0]!.id,
      { commit: true });
    await asUser(db, owner, () => db.query(
      `insert into public.invitations (tenant_id, email, role_id, token_hash, invited_by)
       select $1, $2, id, $3, auth.uid() from public.roles where code = 'RECEPTIONIST' and tenant_id is null`,
      [tenant, `invitee-${suffix}@test.dev`, hash]), { commit: true });
  });
  afterAll(async () => { await db?.end(); });

  it("otro usuario no puede aceptar una invitación ajena", async () => {
    const msg = await expectDenied(db, intruder, `select public.accept_invitation($1)`, [hash]);
    expect(msg).toMatch(/INVITATION_EMAIL_MISMATCH/);
  });

  it("el invitado la acepta y queda con el rol asignado", async () => {
    await asUser(db, invitee, () => db.query(`select public.accept_invitation($1)`, [hash]), { commit: true });
    const perms = await asUser(db, invitee, async () =>
      (await db.query<{ permission_code: string }>(`select permission_code from public.my_permissions($1)`, [tenant])).rows.map((r) => r.permission_code));
    expect(perms).toContain("appointments.create");
    expect(perms).not.toContain("settings.manage");
  });

  it("una invitación no se puede reutilizar", async () => {
    const msg = await expectDenied(db, invitee, `select public.accept_invitation($1)`, [hash]);
    expect(msg).toMatch(/INVITATION_INVALID/);
  });
});
