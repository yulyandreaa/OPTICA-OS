/**
 * `npm run dev:local` — full app without any external database.
 * Boots the local Supabase emulator (PGlite on disk at .local-db/), seeds the demo once,
 * refreshes today's agenda on every boot, then runs `next dev` pointed at the emulator.
 * Reset everything: `npm run dev:local:reset`.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../db/connect";
import { runSeed } from "../db/seed-demo";
import { hashPassword, LOCAL_ANON_KEY, LOCAL_SERVICE_KEY, startLocalSupabase } from "./local-supabase";

const API_PORT = Number(process.env.LOCAL_SUPABASE_PORT ?? 54321);
const APP_PORT = Number(process.env.PORT ?? 3012);
const DATA_DIR = path.join(process.cwd(), ".local-db");
const DEMO_PASSWORD = "NovaVision2026!";

function asDb(pg: PGlite): Db {
  return {
    async query<R>(sql: string, params: unknown[] = []) {
      const res = await pg.query<R>(sql, params.map(toParam));
      return { rows: res.rows, rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0) };
    },
    end: async () => {},
  };
}

async function main() {
  if (process.argv.includes("--reset")) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    console.log("✓ Base local eliminada");
  }
  // The seed must write straight into PGlite, never to a remote project.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.DATABASE_URL;

  console.log("⏳ Iniciando Supabase local (PGlite)…");
  const local = await startLocalSupabase({
    port: API_PORT,
    dataDir: DATA_DIR,
    onBoot: async (pg) => {
      const db = asDb(pg);
      await runSeed(db);
      // Demo users can sign in with the documented password; owner can open /admin.
      const users = await db.query<{ id: string }>(`select id from auth.users where email like '%@novavision.demo' and encrypted_password is null`);
      for (const u of users.rows) await db.query(`update auth.users set encrypted_password = $2 where id = $1`, [u.id, hashPassword(DEMO_PASSWORD)]);
      await db.query(`update public.profiles set is_platform_admin = true where email = 'owner@novavision.demo'`);
    },
  });
  console.log(`✓ Supabase local en ${local.url}`);

  const child = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: local.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_KEY,
      NEXT_PUBLIC_APP_URL: `http://localhost:${APP_PORT}`,
      NEXT_PUBLIC_LOCAL_MODE: "1",
      APP_ENV: "development",
    },
  });
  const stop = async () => { child.kill("SIGINT"); await local.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", async (code) => { await local.close(); process.exit(code ?? 0); });
}

main().catch((e) => { console.error(e); process.exit(1); });

/** Same convention as node-pg: arrays of scalars → Postgres arrays; objects (and arrays of objects) → JSON. */
function toParam(p: unknown) {
  if (p === null || typeof p !== "object") return p;
  if (Array.isArray(p) && p.every((x) => x === null || typeof x !== "object")) return p;
  return JSON.stringify(p);
}
