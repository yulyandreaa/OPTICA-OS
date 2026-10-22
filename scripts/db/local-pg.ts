/**
 * Local Postgres for SQL validation without Docker: PGlite (Postgres→WASM) exposed on a TCP port,
 * with a minimal stub of Supabase's auth schema and roles. NOT a Supabase replacement (no Auth/Storage API);
 * it exists so migrations, generated types and RLS tests can run offline / in CI.
 *   npx tsx scripts/db/local-pg.ts        → postgresql://postgres@127.0.0.1:54329/postgres
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { SUPABASE_STUB } from "./supabase-stub";

const PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);



async function main() {
  const db = await PGlite.create({ extensions: { btree_gist, citext, pg_trgm } });
  await db.exec(SUPABASE_STUB);
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  console.log(`PGlite listo en postgresql://postgres@127.0.0.1:${PORT}/postgres`);
  process.on("SIGINT", async () => { await server.stop(); await db.close(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
