/** Dry-run the demo seed against in-process PGlite and print what the owner's dashboard would show. */
import { connect } from "./connect";
import { runSeed } from "./seed-demo";

async function main() {
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = await connect();
  await runSeed(db);
  await runSeed(db); // idempotency
  const t = (await db.query<{ id: string }>(`select id from public.tenants where slug = 'novavision'`)).rows[0]!;
  const owner = (await db.query<{ id: string }>(`select id from auth.users where email = 'owner@novavision.demo'`)).rows[0]!;
  const recep = (await db.query<{ id: string }>(`select id from auth.users where email = 'recepcion@novavision.demo'`)).rows[0]!;
  for (const [label, uid] of [["OWNER", owner.id], ["RECEPCIÓN (solo Chapinero)", recep.id]] as const) {
    await db.query("begin");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await db.query("set local role authenticated");
    console.log(label, (await db.query(`select public.dashboard_metrics($1) as m`, [t.id])).rows[0]);
    console.log(label, "branches visible in appts:", (await db.query(`select count(distinct branch_id)::int as n from public.appointments`)).rows[0]);
    await db.query("rollback");
  }
  await db.query("begin");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: "authenticated" })]);
  await db.query("set local role authenticated");
  console.log((await db.query(`select full_name, months_since from public.recall_opportunities($1, 3)`, [t.id])).rows);
  console.log((await db.query(`select public.recall_opportunities_count($1) as n`, [t.id])).rows[0]);
  console.log((await db.query(`select status, count(*)::int from public.appointments where starts_at::date = (now() at time zone 'America/Bogota')::date group by 1`)).rows);
  await db.query("rollback");
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
