/**
 * Minimal, transactional migration runner for Supabase (no Docker / CLI required).
 * Applies supabase/migrations/*.sql in lexical order, once each, recording a checksum.
 *   npm run db:migrate            apply pending
 *   npm run db:migrate -- --status
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definido (.env.local)");

  const client = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`set search_path = public, extensions`);
  await client.query(`
    create schema if not exists private;
    create table if not exists private.schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query<{ version: string; checksum: string }>(`select version, checksum from private.schema_migrations`);
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const statusOnly = process.argv.includes("--status");

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prev = applied.get(file);
    if (prev) {
      if (prev !== checksum) console.warn(`⚠  ${file} cambió después de aplicarse. Crea una migración nueva en vez de editarla.`);
      else if (statusOnly) console.log(`✓  ${file}`);
      continue;
    }
    if (statusOnly) { console.log(`·  ${file} (pendiente)`); continue; }

    process.stdout.write(`→  ${file} … `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into private.schema_migrations (version, checksum) values ($1, $2)`, [file, checksum]);
      await client.query("commit");
      console.log("ok");
    } catch (err) {
      await client.query("rollback");
      console.log("FALLÓ");
      throw err;
    }
  }
  // Ask PostgREST to pick up new tables/functions.
  if (!statusOnly) await client.query(`notify pgrst, 'reload schema'`);
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
