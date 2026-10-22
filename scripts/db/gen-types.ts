/**
 * Generates src/lib/supabase/database.types.ts from the live schema (supabase-js format).
 * Replacement for `supabase gen types` that needs no Docker.
 *   npm run db:types          (live DB from .env.local)
 *   npm run db:types:local    (in-process PGlite, no credentials needed)
 */
import { writeFile } from "node:fs/promises";
import { connect } from "./connect";

const OUT = "src/lib/supabase/database.types.ts";

function tsType(udt: string, isArray = false): string {
  const base = udt.replace(/^_/, "");
  let t: string;
  switch (base) {
    case "int2": case "int4": case "int8": case "float4": case "float8": case "numeric": t = "number"; break;
    case "bool": t = "boolean"; break;
    case "json": case "jsonb": t = "Json"; break;
    default: t = "string";
  }
  return isArray || udt.startsWith("_") ? `${t}[]` : t;
}

async function main() {
  // DATABASE_URL → live DB; otherwise an in-process PGlite with all migrations applied.
  const client = await connect();

  const cols = await client.query<{
    table_name: string; column_name: string; udt_name: string; is_nullable: string;
    column_default: string | null; is_identity: string; is_generated: string; kind: string;
  }>(`
    select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default, c.is_identity, c.is_generated,
           case when t.table_type = 'VIEW' then 'view' else 'table' end as kind
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
    order by c.table_name, c.ordinal_position`);

  const fks = await client.query<{ name: string; table_name: string; columns: string[]; ref_table: string; ref_columns: string[]; one_to_one: boolean }>(`
    select con.conname as name, cl.relname as table_name,
           array(select a.attname from unnest(con.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as columns,
           rcl.relname as ref_table,
           array(select a.attname from unnest(con.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as ref_columns,
           exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique and (i.indkey::int2[] @> con.conkey and con.conkey @> i.indkey::int2[])) as one_to_one
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_class rcl on rcl.oid = con.confrelid
    join pg_namespace rn on rn.oid = rcl.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
    order by con.conname`);

  const fns = await client.query<{ name: string; args: { name: string; type: string; mode: string }[] | null; ret: string; retset: boolean; ndefaults: number }>(`
    select p.proname as name,
           (select json_agg(json_build_object('name', coalesce(p.proargnames[i], ''), 'type', format_type(t, null), 'mode', coalesce(p.proargmodes[i], 'i')))
              from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(t, i)) as args,
           format_type(p.prorettype, null) as ret, p.proretset as retset, p.pronargdefaults::int as ndefaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
    order by p.proname`);
  await client.end();

  const pgToTs = (t: string) => {
    const arr = t.endsWith("[]");
    const base = t.replace("[]", "");
    const map: Record<string, string> = {
      uuid: "string", text: "string", "extensions.citext": "string", citext: "string", date: "string",
      "timestamp with time zone": "string", "time without time zone": "string", boolean: "boolean",
      integer: "number", smallint: "number", bigint: "number", numeric: "number", jsonb: "Json", json: "Json", void: "undefined",
    };
    const ts = map[base] ?? "unknown";
    return arr ? `${ts}[]` : ts;
  };

  const tables = new Map<string, typeof cols.rows>();
  for (const c of cols.rows) tables.set(c.table_name, [...(tables.get(c.table_name) ?? []), c]);

  const q = (s: string) => JSON.stringify(s);
  let tablesTs = "";
  let viewsTs = "";
  for (const [name, columns] of tables) {
    const isView = columns[0]!.kind === "view";
    const row = columns.map((c) => `          ${c.column_name}: ${tsType(c.udt_name)}${c.is_nullable === "YES" ? " | null" : ""}`).join("\n");
    const ins = columns
      .filter((c) => c.is_generated !== "ALWAYS" && !(c.is_identity === "YES"))
      .map((c) => {
        const optional = c.is_nullable === "YES" || c.column_default !== null;
        return `          ${c.column_name}${optional ? "?" : ""}: ${tsType(c.udt_name)}${c.is_nullable === "YES" ? " | null" : ""}`;
      }).join("\n");
    const upd = ins.replace(/^(\s+\w+)\??:/gm, "$1?:");
    const rels = fks.rows.filter((f) => f.table_name === name).map((f) =>
      `          { foreignKeyName: ${q(f.name)}; columns: ${JSON.stringify(f.columns)}; isOneToOne: ${f.one_to_one}; referencedRelation: ${q(f.ref_table)}; referencedColumns: ${JSON.stringify(f.ref_columns)} }`,
    ).join(",\n");
    const block = isView
      ? `      ${name}: {\n        Row: {\n${row}\n        }\n        Relationships: []\n      }\n`
      : `      ${name}: {\n        Row: {\n${row}\n        }\n        Insert: {\n${ins}\n        }\n        Update: {\n${upd}\n        }\n        Relationships: [\n${rels}\n        ]\n      }\n`;
    if (isView) viewsTs += block; else tablesTs += block;
  }

  let fnTs = "";
  for (const f of fns.rows) {
    const args = (f.args ?? []);
    const inArgs = args.filter((a) => a.mode === "i" || a.mode === "b");
    const outArgs = args.filter((a) => a.mode === "t" || a.mode === "o");
    const firstOptional = inArgs.length - f.ndefaults;
    const argsTs = inArgs.length ? `{ ${inArgs.map((a, i) => `${a.name}${i >= firstOptional ? "?" : ""}: ${pgToTs(a.type)}`).join("; ")} }` : "Record<PropertyKey, never>";
    let ret: string;
    if (outArgs.length) ret = `{ ${outArgs.map((a) => `${a.name}: ${pgToTs(a.type)} | null`).join("; ")} }[]`;
    else if (f.ret === "trigger") continue;
    else ret = pgToTs(f.ret) + (f.retset ? "[]" : "");
    fnTs += `      ${f.name}: { Args: ${argsTs}; Returns: ${ret} }\n`;
  }

  const out = `// AUTO-GENERATED by scripts/db/gen-types.ts — do not edit by hand.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
${tablesTs}    }
    Views: ${viewsTs ? `{\n${viewsTs}    }` : "Record<string, never>"}
    Functions: {
${fnTs}    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
`;
  await writeFile(OUT, out);
  console.log(`✓ ${OUT} (${tables.size} relaciones, ${fns.rows.length} funciones)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
