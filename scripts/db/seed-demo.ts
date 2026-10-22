/**
 * Demo seed — Óptica Nova Vision SAS. NEVER run against production (guarded by APP_ENV).
 *   npm run db:seed:demo                 create demo tenant (idempotent; refreshes today's agenda if it exists)
 *
 * Auth users are created through the Supabase Admin API (so they can sign in). Data rows are inserted
 * over a direct Postgres connection in a single transaction. Dates are relative to "now" so the
 * dashboard always shows a living day: past slots completed, someone waiting, someone in consultation…
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { connect, type Db } from "./connect";
import { seedModules } from "./seed-modules";

const PASSWORD = "NovaVision2026!";
const TZ_OFFSET_HOURS = -5; // America/Bogota (no DST)
const SLUG = "novavision";

const USERS = [
  { key: "owner", email: "owner@novavision.demo", name: "Andrés Rojas", role: "OWNER", branch: null, title: "Gerente general" },
  { key: "opto1", email: "optometra@novavision.demo", name: "Camila Torres", role: "OPTOMETRIST", branch: null, title: "Optómetra", license: "TP-58213" },
  { key: "opto2", email: "optometra2@novavision.demo", name: "Julián Méndez", role: "OPTOMETRIST", branch: null, title: "Optómetra", license: "TP-61177" },
  { key: "sales", email: "asesor@novavision.demo", name: "Valentina Gómez", role: "SALES_REP", branch: null, title: "Asesora comercial" },
  { key: "recep", email: "recepcion@novavision.demo", name: "Laura Martínez", role: "RECEPTIONIST", branch: "CHA", title: "Recepción Chapinero" },
] as const;

const FIRST = ["María", "Juan", "Daniela", "Santiago", "Sofía", "Carlos", "Valeria", "Andrés", "Isabella", "Felipe", "Natalia", "Sebastián", "Paula", "Mateo", "Laura", "Diego", "Catalina", "Alejandro", "Mariana", "Nicolás", "Juliana", "David", "Gabriela", "Camilo", "Manuela", "Esteban", "Luisa", "Tomás", "Ana", "Ricardo"];
const LAST = ["Rodríguez", "Gómez", "González", "Martínez", "García", "López", "Hernández", "Sánchez", "Ramírez", "Pérez", "Díaz", "Moreno", "Muñoz", "Rojas", "Vargas", "Castro", "Jiménez", "Ortiz", "Suárez", "Torres", "Reyes", "Gutiérrez", "Romero", "Herrera", "Mendoza", "Cárdenas", "Ríos", "Vásquez", "Parra", "Navarro"];
const SOURCES = ["instagram", "instagram", "walk_in", "referral", "google", "whatsapp", "facebook", "web"];
const EPS = ["Sanitas", "Sura", "Compensar", "Nueva EPS", "Salud Total", "Famisanar", null];
const OCCUPATIONS = ["Ingeniera de sistemas", "Docente", "Diseñador gráfico", "Contadora", "Estudiante", "Abogado", "Médica", "Comerciante", "Arquitecto", "Pensionada"];

// Deterministic PRNG so every run produces the same demo.
let seed = 20261016;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;

/** UTC Date for a Bogotá wall-clock time `days` from today. */
function bogota(days: number, hour: number, minute = 0) {
  const now = new Date();
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 3_600_000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, hour - TZ_OFFSET_HOURS, minute));
  return d;
}

async function ensureAuthUsers(db: Db) {
  const ids = new Map<string, string>();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Local PGlite mode: insert straight into the auth stub.
    for (const u of USERS) {
      const existing = await db.query<{ id: string }>(`select id from auth.users where email = $1`, [u.email]);
      const id = existing.rows[0]?.id ?? randomUUID();
      if (!existing.rows[0]) await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, u.email, { full_name: u.name }]);
      ids.set(u.key, id);
    }
    return ids;
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of USERS) {
    const found = list?.users.find((x) => x.email === u.email);
    if (found) { ids.set(u.key, found.id); continue; }
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: u.name },
    });
    if (error || !data.user) throw new Error(`No se pudo crear ${u.email}: ${error?.message}`);
    ids.set(u.key, data.user.id);
  }
  return ids;
}

export async function runSeed(db: Db) {
  if (process.env.APP_ENV === "production") throw new Error("El seed demo no se ejecuta en producción.");
  const users = await ensureAuthUsers(db);
  const uid = (k: (typeof USERS)[number]["key"]) => users.get(k)!;

  const existing = await db.query<{ id: string }>(`select id from public.tenants where slug = $1`, [SLUG]);
  const userIds = Object.fromEntries(USERS.map((u) => [u.key, uid(u.key)]));
  if (existing.rows[0]) {
    // The dashboard labels demo figures; older local databases predate the flag.
    await db.query(`update public.tenants set is_demo = true where id = $1 and not is_demo`, [existing.rows[0].id]);
    await refreshToday(db, existing.rows[0].id, uid);
    await seedModules(db, existing.rows[0].id, userIds);
    return;
  }

  await db.query("begin");
  try {
    for (const u of USERS) await db.query(`update public.profiles set full_name = $2, phone = $3 where id = $1`, [uid(u.key), u.name, `3${Math.floor(100000000 + rand() * 899999999)}`]);

    const tenantId = randomUUID();
    await db.query(
      `insert into public.tenants (id, slug, legal_name, trade_name, tax_id_type, tax_id, tax_dv, tax_regime, email, phone, address, city, department, specialty, created_by, onboarding_completed_at)
       values ($1, $2, 'Óptica Nova Vision SAS', 'Nova Vision', 'NIT', '901458732', '6', 'responsable_iva', 'hola@novavision.demo', '6017451200',
               'Cra. 13 # 63-20', 'Bogotá', 'Cundinamarca', 'optometry', $3, now())`,
      [tenantId, SLUG, uid("owner")],
    );
    await db.query(`update public.tenants set is_demo = true where id = $1`, [tenantId]);
    await db.query(
      `insert into public.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
       select $1, id, 'active', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month' from public.plans where code = 'BUSINESS'`,
      [tenantId],
    );

    const cha = randomUUID();
    const ced = randomUUID();
    await db.query(
      `insert into public.branches (id, tenant_id, name, code, address, city, department, phone, is_main) values
       ($1, $3, 'Chapinero', 'CHA', 'Cra. 13 # 63-20', 'Bogotá', 'Cundinamarca', '6017451200', true),
       ($2, $3, 'Cedritos', 'CED', 'Cl. 140 # 11-45', 'Bogotá', 'Cundinamarca', '6017451201', false)`,
      [cha, ced, tenantId],
    );
    const branchByCode = { CHA: cha, CED: ced } as const;

    for (const u of USERS) {
      await db.query(
        `insert into public.tenant_members (tenant_id, user_id, status, job_title, professional_license, default_branch_id, joined_at)
         values ($1, $2, 'active', $3, $4, $5, now() - interval '20 months')`,
        [tenantId, uid(u.key), u.title, "license" in u ? u.license : null, u.branch ? branchByCode[u.branch] : cha],
      );
      await db.query(
        `insert into public.user_roles (tenant_id, user_id, role_id, branch_id)
         select $1, $2, id, $4 from public.roles where code = $3 and tenant_id is null`,
        [tenantId, uid(u.key), u.role, u.branch ? branchByCode[u.branch] : null],
      );
      await db.query(`update public.profiles set active_tenant_id = $2, active_branch_id = $3 where id = $1`,
        [uid(u.key), tenantId, u.branch ? branchByCode[u.branch] : u.key === "owner" ? null : cha]);
    }

    // Weekly schedules (with lunch break).
    const schedule = async (userKey: "opto1" | "opto2", branch: string, weekdays: number[], start: string, end: string) => {
      for (const wd of weekdays) {
        const windows = start < "12:30" && end > "13:30" ? [[start, "12:30"], ["13:30", end]] : [[start, end]];
        for (const [s, e] of windows) {
          await db.query(`insert into public.specialist_schedules (tenant_id, branch_id, user_id, weekday, start_time, end_time, slot_minutes) values ($1,$2,$3,$4,$5,$6,30)`,
            [tenantId, branch, uid(userKey), wd, s, e]);
        }
      }
    };
    await schedule("opto1", cha, [1, 2, 3, 4, 5], "08:00", "18:00");
    await schedule("opto1", cha, [6], "09:00", "13:00");
    await schedule("opto2", ced, [1, 3, 5], "09:00", "18:00");
    await schedule("opto2", cha, [2, 4], "08:00", "17:00");
    await schedule("opto2", ced, [6], "09:00", "13:00");

    // Patients
    const patients: { id: string; branch: string }[] = [];
    for (let i = 0; i < 30; i++) {
      const id = randomUUID();
      const first = FIRST[i]!;
      const last = LAST[(i * 7) % LAST.length]!;
      const last2 = LAST[(i * 11 + 3) % LAST.length]!;
      const female = ["María", "Daniela", "Sofía", "Valeria", "Isabella", "Natalia", "Paula", "Laura", "Catalina", "Mariana", "Juliana", "Gabriela", "Manuela", "Luisa", "Ana"].includes(first);
      const birthYear = 1948 + Math.floor(rand() * 62);
      const branch = i % 3 === 0 ? ced : cha;
      const createdDaysAgo = i < 6 ? Math.floor(rand() * 14) : i < 10 ? 31 + Math.floor(rand() * 12) : 60 + Math.floor(rand() * 600);
      await db.query(
        `insert into public.patients (id, tenant_id, document_type, document_number, first_name, last_name, second_last_name, birth_date, sex, email, phone, whatsapp,
           city, department, occupation, eps, health_regime, contact_preference, source, home_branch_id, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'Bogotá','Cundinamarca',$12,$13,$14,'whatsapp',$15,$16,$17, now() - make_interval(days => $18))`,
        [id, tenantId, birthYear > 2008 ? "TI" : "CC", String(1_010_000_000 + i * 734_291 + Math.floor(rand() * 9999)).slice(0, 10), first, last, last2,
          `${birthYear}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`,
          female ? "F" : "M", `${first.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.${last.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@correo.demo`,
          `3${pick(["00", "01", "10", "12", "15", "20", "22", "50"])}${Math.floor(1_000_000 + rand() * 8_999_999)}`,
          pick(OCCUPATIONS), pick(EPS), pick(["contributivo", "contributivo", "particular", "especial"]), pick(SOURCES), branch, uid("recep"), createdDaysAgo],
      );
      await db.query(`update public.patient_activities set occurred_at = (select created_at from public.patients where id = $1) where patient_id = $1`, [id]);
      await db.query(`insert into public.patient_consents (tenant_id, patient_id, consent_type, version, granted, granted_at, recorded_by)
                      select $1, $2, 'data_processing', '2026-10', true, created_at, $3 from public.patients where id = $2`, [tenantId, id, uid("recep")]);
      patients.push({ id, branch });
    }

    const types = new Map((await db.query<{ id: string; code: string; duration_minutes: number }>(`select id, code, duration_minutes from public.appointment_types where tenant_id = $1`, [tenantId])).rows.map((r) => [r.code, r]));

    // History: patients 6..29 have past visits; some are 12–20 months ago (recall opportunities).
    const booked = new Set<string>();
    const book = async (o: { patient: string; branch: string; specialist: string; type: string; start: Date; status: string; source?: string }) => {
      const t = types.get(o.type)!;
      const key = `${o.specialist}-${o.start.toISOString()}`;
      if (booked.has(key)) return;
      booked.add(key);
      const end = new Date(o.start.getTime() + t.duration_minutes * 60_000);
      await db.query(
        `insert into public.appointments (tenant_id, branch_id, patient_id, specialist_id, appointment_type_id, starts_at, ends_at, status, source, created_by,
            confirmed_at, checked_in_at, started_at, completed_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            case when $8 in ('confirmed','checked_in','waiting','in_consultation','completed') then $6::timestamptz - interval '1 day' end,
            case when $8 in ('checked_in','waiting','in_consultation','completed') then $6::timestamptz - interval '9 minutes' end,
            case when $8 in ('in_consultation','completed') then $6::timestamptz + interval '2 minutes' end,
            case when $8 = 'completed' then $7::timestamptz end,
            least(now(), $6::timestamptz - interval '3 days'))`,
        [tenantId, o.branch, o.patient, o.specialist, t.id, o.start.toISOString(), end.toISOString(), o.status, o.source ?? "internal", uid("recep")],
      );
    };

    for (let i = 6; i < 30; i++) {
      const p = patients[i]!;
      const specialist = p.branch === ced ? uid("opto2") : uid("opto1");
      const monthsAgo = i < 16 ? 12 + Math.floor(rand() * 9) : 1 + Math.floor(rand() * 10); // first group → recall due
      const day = -Math.round(monthsAgo * 30.4) - Math.floor(rand() * 10);
      const hour = 8 + Math.floor(rand() * 9);
      await book({ patient: p.id, branch: p.branch, specialist, type: "optometria", start: bogota(day, hour, rand() > 0.5 ? 30 : 0), status: "completed" });
      if (rand() > 0.6) await book({ patient: p.id, branch: p.branch, specialist, type: "entrega", start: bogota(day + 6, hour, 0), status: "completed" });
    }
    // Volume for last-30/60-day metrics (attendance, cancellations, month-over-month).
    for (let d = -58; d < 0; d++) {
      const perDay = d > -30 ? 3 : 2;
      for (let k = 0; k < perDay; k++) {
        // Only "active" patients (not the recall group 6–15) get recent visits.
        const active = [...patients.slice(0, 6), ...patients.slice(16)];
        const p = active[Math.floor(rand() * active.length)]!;
        const roll = rand();
        await book({
          patient: p.id, branch: p.branch, specialist: p.branch === ced ? uid("opto2") : uid("opto1"),
          type: pick(["valoracion", "optometria", "control", "lentes_contacto"]), start: bogota(d, 8 + k * 3, 0),
          status: roll < 0.08 ? "no_show" : roll < 0.15 ? "cancelled" : "completed",
          source: rand() < 0.25 ? "online" : "internal",
        });
      }
    }

    // Timeline entries were stamped "now" by triggers; move them to when each visit happened.
    await db.query(
      `update public.patient_activities pa set occurred_at = case when pa.type = 'appointment.created' then a.created_at else a.starts_at end
       from public.appointments a where a.id = (pa.metadata ->> 'appointment_id')::uuid and pa.tenant_id = $1`, [tenantId]);
    await db.query("commit");
    console.log(`✓ Tenant demo creado (${SLUG})`);
    await refreshToday(db, tenantId, uid);
    await seedModules(db, tenantId, userIds);
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

/** Builds today's and tomorrow's agenda relative to the current time (idempotent per day). */
async function refreshToday(db: Db, tenantId: string, uid: (k: (typeof USERS)[number]["key"]) => string) {
  const todayStart = bogota(0, 0);
  const tomorrowEnd = bogota(2, 0);
  const already = await db.query<{ n: number }>(
    `select count(*)::int as n from public.appointments where tenant_id = $1 and starts_at >= $2 and starts_at < $3`,
    [tenantId, todayStart.toISOString(), tomorrowEnd.toISOString()]);
  if ((already.rows[0]?.n ?? 0) > 0) { console.log("✓ La agenda de hoy ya existe"); return; }

  const branches = new Map((await db.query<{ code: string; id: string }>(`select code, id from public.branches where tenant_id = $1`, [tenantId])).rows.map((r) => [r.code, r.id]));
  // Skip patients whose last visit is >12 months old so they stay as recall opportunities.
  const patients = (await db.query<{ id: string }>(
    `select p.id from public.patients p
     where p.tenant_id = $1
       and coalesce((select max(a.starts_at) from public.appointments a where a.patient_id = p.id and a.status = 'completed'), now()) > now() - interval '12 months'
     order by p.created_at desc`, [tenantId])).rows.map((r) => r.id);
  if (patients.length === 0) { console.log("✓ Sin pacientes: no se genera agenda demo"); return; }
  const types = new Map((await db.query<{ id: string; code: string; duration_minutes: number }>(`select id, code, duration_minutes from public.appointment_types where tenant_id = $1`, [tenantId])).rows.map((r) => [r.code, r]));
  const nowMs = Date.now();

  const plan: { spec: "opto1" | "opto2"; branch: "CHA" | "CED"; slots: [number, number, string][] }[] = [
    { spec: "opto1", branch: "CHA", slots: [[8, 0, "optometria"], [8, 45, "valoracion"], [9, 30, "control"], [10, 0, "optometria"], [10, 45, "lentes_contacto"], [11, 30, "valoracion"], [14, 0, "optometria"], [15, 0, "control"], [15, 30, "valoracion"], [16, 30, "optometria"]] },
    { spec: "opto2", branch: "CED", slots: [[9, 0, "valoracion"], [10, 0, "optometria"], [11, 0, "control"], [12, 0, "valoracion"], [14, 0, "optometria"], [15, 0, "entrega"], [16, 0, "valoracion"], [17, 0, "control"]] },
  ];

  let pi = 0;
  for (const day of [0, 1]) {
    for (const p of plan) {
      for (const [h, m, code] of p.slots) {
        if (day === 1 && rand() < 0.4) continue;
        const t = types.get(code)!;
        const start = bogota(day, h, m);
        const end = new Date(start.getTime() + t.duration_minutes * 60_000);
        let status = "scheduled";
        if (day === 0) {
          if (end.getTime() < nowMs) status = rand() < 0.1 ? "no_show" : "completed";
          else if (start.getTime() <= nowMs) status = "in_consultation";
          else if (start.getTime() - nowMs < 50 * 60_000) status = "waiting";
          else status = rand() < 0.6 ? "confirmed" : "scheduled";
        }
        const patient = patients[pi++ % patients.length]!;
        await db.query(
          `insert into public.appointments (tenant_id, branch_id, patient_id, specialist_id, appointment_type_id, starts_at, ends_at, status, source, created_by,
              confirmed_at, checked_in_at, started_at, completed_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
              case when $8 <> 'scheduled' then now() - interval '1 day' end,
              case when $8 in ('waiting','in_consultation','completed') then least(now(), $6::timestamptz) - interval '12 minutes' end,
              case when $8 in ('in_consultation','completed') then $6::timestamptz end,
              case when $8 = 'completed' then $7::timestamptz end)`,
          [tenantId, branches.get(p.branch), patient, uid(p.spec), t.id, start.toISOString(), end.toISOString(), status, rand() < 0.3 ? "online" : "internal", uid("recep")],
        );
      }
    }
  }
  console.log("✓ Agenda de hoy y mañana generada");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  connect()
    .then(async (db) => { try { await runSeed(db); } finally { await db.end(); } })
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
