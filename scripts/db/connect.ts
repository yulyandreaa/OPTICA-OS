import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { SUPABASE_STUB } from "./supabase-stub";

/** Minimal query surface shared by `pg.Client` and in-process PGlite. */
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * DATABASE_URL set → real Postgres/Supabase (use a disposable project!).
 * Otherwise → in-process PGlite with the Supabase stub + all migrations applied.
 */
export async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
    await client.connect();
    await client.query("set search_path = public, extensions");
    return client as unknown as Db;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { citext } = await import("@electric-sql/pglite/contrib/citext");
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const pg = await PGlite.create({ extensions: { btree_gist, citext, pg_trgm } });
  await pg.exec(SUPABASE_STUB);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort()) {
    await pg.exec(`set search_path = public, extensions;\n${await readFile(path.join(dir, f), "utf8")}`);
  }
  await pg.exec("set search_path = public, extensions");
  return {
    async query<R>(sql: string, params: unknown[] = []) {
      const res = await pg.query<R>(sql, params.map(toParam));
      // PGlite reports affectedRows = 0 for SELECT; use the row count when rows came back.
      return { rows: res.rows, rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0) };
    },
    end: () => pg.close(),
  };
}

/** Same convention as node-pg: arrays of scalars → Postgres arrays; objects (and arrays of objects) → JSON. */
function toParam(p: unknown) {
  if (p === null || typeof p !== "object") return p;
  if (Array.isArray(p) && p.every((x) => x === null || typeof x !== "object")) return p;
  return JSON.stringify(p);
}
