/**
 * Local Supabase emulator for development WITHOUT an external database.
 *
 * - Postgres: PGlite (real Postgres compiled to WASM), persisted in `.local-db/`.
 * - Auth: minimal GoTrue-compatible endpoints (password login, signup, user, refresh, logout).
 * - REST: the subset of PostgREST that this app uses (select with embeds, filters, order, limit, count,
 *   insert/update/delete with `returning`, RPC).
 * - Every request runs as `anon` / `authenticated` / `service_role` with JWT claims set, so RLS is REAL.
 *
 * It is a development tool only — never a production backend. Swap to a real Supabase project by
 * putting its keys in `.env.local` and running `npm run dev` instead of `npm run dev:local`.
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { SUPABASE_STUB } from "../db/supabase-stub";

export const LOCAL_JWT_SECRET = "optica-os-local-development-secret-not-for-production";
const IDENT = /^[a-z_][a-z0-9_]*$/;

// ───────────────────────────── JWT (HS256) ─────────────────────────────
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
export function signJwt(payload: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", LOCAL_JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token: string): Record<string, unknown> | null {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const expected = createHmac("sha256", LOCAL_JWT_SECRET).update(`${h}.${b}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString()) as Record<string, unknown>;
  if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
  return payload;
}
export const LOCAL_ANON_KEY = signJwt({ iss: "optica-os-local", role: "anon", iat: 1760000000, exp: 2100000000 });
export const LOCAL_SERVICE_KEY = signJwt({ iss: "optica-os-local", role: "service_role", iat: 1760000000, exp: 2100000000 });

function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
function checkPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(pw, Buffer.from(salt!, "hex"), 32);
  return timingSafeEqual(candidate, Buffer.from(hash!, "hex"));
}

// ───────────────────────────── Schema metadata ─────────────────────────────
interface Fk { name: string; table: string; cols: string[]; ref: string; refCols: string[] }
interface Fn { args: { name: string; type: string }[]; retset: boolean; table: boolean; ret: string }
interface Meta { tables: Map<string, Set<string>>; fks: Fk[]; fns: Map<string, Fn> }

// ───────────────────────────── Emulator ─────────────────────────────
export async function startLocalSupabase(opts: { port: number; dataDir: string; onFirstBoot?: (db: PGlite) => Promise<void>; onBoot?: (db: PGlite) => Promise<void> }) {
  const fresh = !existsSync(path.join(opts.dataDir, "PG_VERSION"));
  const db = await PGlite.create({ dataDir: opts.dataDir, extensions: { btree_gist, citext, pg_trgm } });

  if (fresh) await db.exec(SUPABASE_STUB);
  await db.exec(`
    alter table auth.users add column if not exists encrypted_password text;
    alter table auth.users add column if not exists email_confirmed_at timestamptz default now();
    create table if not exists auth.refresh_tokens (token text primary key, user_id uuid not null, created_at timestamptz default now());
  `);
  await applyMigrations(db);
  if (fresh && opts.onFirstBoot) await opts.onFirstBoot(db);
  if (opts.onBoot) await opts.onBoot(db);

  let meta = await loadMeta(db);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      console.error("[local-supabase]", err);
      send(res, 500, { message: String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range");
    if (req.method === "OPTIONS") return send(res, 204);

    const url = new URL(req.url ?? "/", "http://local");
    const body = await readBody(req);
    if (url.pathname.startsWith("/auth/v1/")) return serial(() => auth(url, req, res, body));
    if (url.pathname.startsWith("/rest/v1/")) return serial(() => rest(url, req, res, body));
    send(res, 404, { message: "not found" });
  }

  // ─────────────── Auth ───────────────
  async function auth(url: URL, req: IncomingMessage, res: ServerResponse, raw: string) {
    const route = url.pathname.replace("/auth/v1/", "");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";

    if (route === "token" && url.searchParams.get("grant_type") === "password") {
      const r = await db.query<{ id: string; encrypted_password: string | null }>(`select id, encrypted_password from auth.users where lower(email) = lower($1)`, [String(body.email ?? "")]);
      const u = r.rows[0];
      if (!u || !checkPassword(String(body.password ?? ""), u.encrypted_password)) {
        return send(res, 400, { error: "invalid_grant", error_code: "invalid_credentials", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      }
      return send(res, 200, await session(u.id));
    }
    if (route === "token" && url.searchParams.get("grant_type") === "refresh_token") {
      const r = await db.query<{ user_id: string }>(`delete from auth.refresh_tokens where token = $1 returning user_id`, [String(body.refresh_token ?? "")]);
      if (!r.rows[0]) return send(res, 400, { error: "invalid_grant", error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, await session(r.rows[0].user_id));
    }
    if (route === "signup") {
      const email = String(body.email ?? "").toLowerCase();
      const exists = await db.query(`select 1 from auth.users where lower(email) = $1`, [email]);
      if (exists.rows.length) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const id = randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values ($1, $2, $3, $4)`,
        [id, email, JSON.stringify(body.data ?? {}), hashPassword(String(body.password ?? ""))]);
      return send(res, 200, await session(id));
    }
    if (route === "user" && req.method === "GET") {
      const claims = verifyJwt(bearer);
      if (!claims?.sub) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      const user = await userJson(String(claims.sub));
      return user ? send(res, 200, user) : send(res, 404, { msg: "User not found" });
    }
    if (route === "user" && req.method === "PUT") {
      const claims = verifyJwt(bearer);
      if (!claims?.sub) return send(res, 401, { msg: "invalid JWT" });
      if (body.password) await db.query(`update auth.users set encrypted_password = $2 where id = $1`, [claims.sub, hashPassword(String(body.password))]);
      return send(res, 200, await userJson(String(claims.sub)));
    }
    if (route === "logout") return send(res, 204);
    if (route === "otp" || route === "recover") {
      console.info(`[local-supabase] ${route} solicitado para ${String(body.email)} (sin envío de correo en modo local)`);
      return send(res, 200, {});
    }
    if (route === "settings") return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
    send(res, 404, { msg: `auth route ${route} no emulada` });
  }

  async function userJson(id: string) {
    const r = await db.query<{ id: string; email: string; raw_user_meta_data: Record<string, unknown>; created_at: string }>(
      `select id, email, raw_user_meta_data, created_at from auth.users where id = $1`, [id]);
    const u = r.rows[0];
    if (!u) return null;
    return {
      id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at, phone: "",
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {},
      identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
    };
  }

  async function session(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const user = await userJson(userId);
    const access = signJwt({ sub: userId, role: "authenticated", aud: "authenticated", email: user?.email, iat: now, exp: now + 3600, session_id: randomUUID() });
    const refresh = randomBytes(24).toString("base64url");
    await db.query(`insert into auth.refresh_tokens (token, user_id) values ($1, $2)`, [refresh, userId]);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
  }

  // ─────────────── REST ───────────────
  async function rest(url: URL, req: IncomingMessage, res: ServerResponse, raw: string) {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || String(req.headers.apikey ?? "");
    const claims = verifyJwt(token);
    if (!claims) return send(res, 401, { code: "PGRST301", message: "JWT inválido" });
    const role = claims.role === "service_role" ? "service_role" : claims.role === "authenticated" ? "authenticated" : "anon";
    const prefer = String(req.headers.prefer ?? "");
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const resource = url.pathname.replace("/rest/v1/", "");

    try {
      await db.query("begin");
      await db.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
        [JSON.stringify(claims), JSON.stringify({ "user-agent": req.headers["user-agent"] ?? "", "x-forwarded-for": "127.0.0.1" })]);
      await db.query(`set local role ${role}`);

      let rows: unknown[] = [];
      let count: number | null = null;
      let scalar: { value: unknown } | null = null;

      if (resource.startsWith("rpc/")) {
        scalar = await rpc(resource.slice(4), raw ? JSON.parse(raw) : {});
      } else {
        const table = resource;
        if (!meta.tables.has(table)) throw Object.assign(new Error(`relation "public.${table}" does not exist`), { code: "42P01" });
        const params: unknown[] = [];
        const where = buildWhere(url.searchParams, "t0", params);
        const select = parseSelect(url.searchParams.get("select") ?? "*");
        const proj = projection(table, select, "t0");
        const innerConds = proj.inner.length ? ` and ${proj.inner.join(" and ")}` : "";

        if (req.method === "GET" || req.method === "HEAD") {
          const order = buildOrder(url.searchParams.get("order"), "t0");
          const limit = url.searchParams.get("limit");
          const offset = url.searchParams.get("offset");
          const sql = `select ${proj.expr} as j from public."${table}" t0 where ${where}${innerConds}${order}${limit ? ` limit ${Number(limit)}` : ""}${offset ? ` offset ${Number(offset)}` : ""}`;
          if (req.method === "GET") rows = (await db.query<{ j: unknown }>(sql, params)).rows.map((r) => r.j);
          if (wantCount || req.method === "HEAD") {
            count = (await db.query<{ n: number }>(`select count(*)::int as n from public."${table}" t0 where ${where}${innerConds}`, params)).rows[0]!.n;
          }
        } else if (req.method === "POST") {
          const body = JSON.parse(raw || "[]") as Record<string, unknown> | Record<string, unknown>[];
          const list = Array.isArray(body) ? body : [body];
          const cols = [...new Set(list.flatMap((r) => Object.keys(r)))].filter((c) => IDENT.test(c) && meta.tables.get(table)!.has(c));
          const p: unknown[] = [JSON.stringify(list)];
          const colList = cols.map((c) => `"${c}"`).join(", ");
          const sql = `with ins as (insert into public."${table}" (${colList}) select ${colList} from jsonb_populate_recordset(null::public."${table}", $1::jsonb) returning *)
                       select ${proj.expr} as j from ins t0`;
          rows = (await db.query<{ j: unknown }>(sql, p)).rows.map((r) => r.j);
          count = rows.length;
        } else if (req.method === "PATCH") {
          const body = JSON.parse(raw || "{}") as Record<string, unknown>;
          const cols = Object.keys(body).filter((c) => IDENT.test(c) && meta.tables.get(table)!.has(c));
          if (!cols.length) throw Object.assign(new Error("Nada que actualizar"), { code: "PGRST102" });
          params.push(JSON.stringify(body));
          const v = `$${params.length}`;
          const sets = cols.map((c) => `"${c}" = v."${c}"`).join(", ");
          const sql = `with upd as (update public."${table}" as t0 set ${sets} from (select * from jsonb_populate_record(null::public."${table}", ${v}::jsonb)) v where ${where} returning t0.*)
                       select ${proj.expr} as j from upd t0`;
          rows = (await db.query<{ j: unknown }>(sql, params)).rows.map((r) => r.j);
          count = rows.length;
        } else if (req.method === "DELETE") {
          const sql = `with del as (delete from public."${table}" as t0 where ${where} returning t0.*) select ${proj.expr} as j from del t0`;
          rows = (await db.query<{ j: unknown }>(sql, params)).rows.map((r) => r.j);
          count = rows.length;
        }
      }
      await db.query("commit");

      if (scalar) {
        if (wantsObject && Array.isArray(scalar.value)) {
          const arr = scalar.value as unknown[];
          if (arr.length !== 1) return send(res, 406, pgrst116(arr.length));
          return send(res, 200, arr[0]);
        }
        return send(res, 200, scalar.value);
      }
      if (count !== null) res.setHeader("Content-Range", `${rows.length ? `0-${rows.length - 1}` : "*"}/${count}`);
      if (req.method === "HEAD") return send(res, 200);
      if (req.method !== "GET" && !prefer.includes("return=representation")) return send(res, req.method === "POST" ? 201 : 204);
      if (wantsObject) {
        if (rows.length !== 1) return send(res, 406, pgrst116(rows.length));
        return send(res, 200, rows[0]);
      }
      return send(res, req.method === "POST" ? 201 : 200, rows);
    } catch (err) {
      await db.query("rollback").catch(() => undefined);
      const e = err as { code?: string; message?: string; detail?: string; hint?: string };
      const status = e.code === "23505" ? 409 : e.code === "42501" ? (role === "anon" ? 401 : 403) : e.code === "42P01" ? 404 : 400;
      return send(res, status, { code: e.code ?? "PGRST000", message: e.message ?? String(err), details: e.detail ?? null, hint: e.hint ?? null });
    }
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const fn = meta.fns.get(name);
    if (!fn || !IDENT.test(name)) throw Object.assign(new Error(`Could not find the function public.${name}`), { code: "PGRST202" });
    const params: unknown[] = [];
    const named = fn.args.filter((a) => a.name in args).map((a) => {
      const v = args[a.name];
      params.push(v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : v);
      return `${a.name} => $${params.length}::${a.type}`;
    }).join(", ");
    const call = `public."${name}"(${named})`;
    if (fn.retset || fn.table) {
      const r = await db.query<{ v: unknown }>(`select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v from ${call} r`, params);
      return { value: r.rows[0]!.v };
    }
    if (fn.ret === "void") { await db.query(`select ${call}`, params); return { value: null }; }
    const r = await db.query<{ v: unknown }>(`select to_jsonb(${call}) as v`, params);
    return { value: r.rows[0]!.v };
  }

  // ─────────────── Query building ───────────────
  type SelectItem = { kind: "star" } | { kind: "col"; name: string; alias: string } | { kind: "embed"; alias: string; rel: string; hint?: string; inner: boolean; items: SelectItem[] };

  function splitTop(s: string) {
    const out: string[] = [];
    let depth = 0, cur = "", quoted = false;
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === "(") depth++;
      if (!quoted && ch === ")") depth--;
      if (!quoted && ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }

  function parseSelect(s: string): SelectItem[] {
    return splitTop(s.replace(/\s+/g, " ")).map((part): SelectItem => {
      if (part === "*") return { kind: "star" };
      const paren = part.indexOf("(");
      if (paren > -1) {
        const head = part.slice(0, paren).trim();
        const inner = part.slice(paren + 1, part.lastIndexOf(")"));
        const [aliasPart, relPart] = head.includes(":") ? head.split(":") as [string, string] : [undefined, head];
        const [rel, ...mods] = relPart.split("!");
        const hint = mods.find((m) => m !== "inner" && m !== "left");
        return { kind: "embed", alias: (aliasPart ?? rel!).trim(), rel: rel!.trim(), hint, inner: mods.includes("inner"), items: parseSelect(inner || "*") };
      }
      const [aliasPart, colPart] = part.includes(":") ? part.split(":") as [string, string] : [undefined, part];
      const name = colPart.split("::")[0]!.trim();
      if (!IDENT.test(name)) throw Object.assign(new Error(`columna inválida ${name}`), { code: "PGRST100" });
      return { kind: "col", name, alias: (aliasPart ?? name).trim() };
    });
  }

  let aliasSeq = 0;
  function projection(table: string, items: SelectItem[], a: string): { expr: string; inner: string[] } {
    const cols = meta.tables.get(table)!;
    const parts: string[] = [];
    const inner: string[] = [];
    let base = "'{}'::jsonb";
    if (items.some((i) => i.kind === "star")) base = `to_jsonb(${a})`;
    const plain = items.filter((i): i is Extract<SelectItem, { kind: "col" }> => i.kind === "col");
    if (plain.length) {
      for (const c of plain) if (!cols.has(c.name)) throw Object.assign(new Error(`column ${table}.${c.name} does not exist`), { code: "42703" });
      parts.push(`jsonb_build_object(${plain.map((c) => `'${c.alias}', ${a}."${c.name}"`).join(", ")})`);
    }
    for (const e of items.filter((i): i is Extract<SelectItem, { kind: "embed" }> => i.kind === "embed")) {
      const { fk, toOne } = resolveFk(table, e.rel, e.hint);
      const b = `t${++aliasSeq}`;
      const sub = projection(e.rel, e.items, b);
      const join = toOne
        ? fk.cols.map((c, i) => `${b}."${fk.refCols[i]}" = ${a}."${c}"`).join(" and ")
        : fk.cols.map((c, i) => `${b}."${c}" = ${a}."${fk.refCols[i]}"`).join(" and ");
      const subWhere = sub.inner.length ? ` and ${sub.inner.join(" and ")}` : "";
      const expr = toOne
        ? `(select ${sub.expr} from public."${e.rel}" ${b} where ${join}${subWhere} limit 1)`
        : `(select coalesce(jsonb_agg(${sub.expr}), '[]'::jsonb) from public."${e.rel}" ${b} where ${join}${subWhere})`;
      parts.push(`jsonb_build_object('${e.alias}', ${expr})`);
      if (e.inner) inner.push(toOne ? `${expr} is not null` : `jsonb_array_length(${expr}) > 0`);
    }
    return { expr: [base, ...parts].join(" || "), inner };
  }

  function resolveFk(table: string, rel: string, hint?: string) {
    if (!meta.tables.has(rel)) throw Object.assign(new Error(`Could not find a relationship between '${table}' and '${rel}'`), { code: "PGRST200" });
    const toOne = meta.fks.filter((f) => f.table === table && f.ref === rel);
    const toMany = meta.fks.filter((f) => f.table === rel && f.ref === table);
    const all = [...toOne.map((fk) => ({ fk, toOne: true })), ...toMany.map((fk) => ({ fk, toOne: false }))];
    const match = hint ? all.filter((x) => x.fk.name === hint || x.fk.cols.includes(hint)) : all;
    if (!match.length) throw Object.assign(new Error(`Could not find a relationship between '${table}' and '${rel}'`), { code: "PGRST200" });
    if (match.length > 1 && !hint) {
      // Prefer single-column FKs when the composite ones carry tenant_id redundantly.
      const nonTenant = match.filter((x) => !(x.fk.cols.length === 1 && x.fk.cols[0] === "tenant_id"));
      if (nonTenant.length !== 1) throw Object.assign(new Error(`Más de una relación entre '${table}' y '${rel}'; usa !hint`), { code: "PGRST201" });
      return nonTenant[0]!;
    }
    return match[0]!;
  }

  const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"]);
  function buildWhere(sp: URLSearchParams, a: string, params: unknown[]) {
    const conds: string[] = ["true"];
    for (const [key, value] of sp.entries()) {
      if (key === "or" || key === "and") conds.push(logic(key, value.slice(1, -1), a, params));
      else if (!RESERVED.has(key)) conds.push(condition(key, value, a, params));
    }
    return conds.join(" and ");
  }
  function logic(kind: string, inner: string, a: string, params: unknown[]): string {
    const parts = splitTop(inner).map((p) => {
      const m = /^(not\.)?(and|or)\((.*)\)$/.exec(p);
      if (m) return `${m[1] ? "not " : ""}${logic(m[2]!, m[3]!, a, params)}`;
      const dot = p.indexOf(".");
      return condition(p.slice(0, dot), p.slice(dot + 1), a, params);
    });
    return `(${parts.join(kind === "or" ? " or " : " and ")})`;
  }
  function condition(col: string, expr: string, a: string, params: unknown[]): string {
    if (!IDENT.test(col)) throw Object.assign(new Error(`filtro no soportado: ${col}`), { code: "PGRST100" });
    let negate = false;
    if (expr.startsWith("not.")) { negate = true; expr = expr.slice(4); }
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot);
    let val = expr.slice(dot + 1);
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    const c = `${a}."${col}"`;
    const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let sql: string;
    switch (op) {
      case "eq": sql = `${c} = ${push(val)}`; break;
      case "neq": sql = `${c} <> ${push(val)}`; break;
      case "gt": sql = `${c} > ${push(val)}`; break;
      case "gte": sql = `${c} >= ${push(val)}`; break;
      case "lt": sql = `${c} < ${push(val)}`; break;
      case "lte": sql = `${c} <= ${push(val)}`; break;
      case "like": sql = `${c}::text like ${push(val.replaceAll("*", "%"))}`; break;
      case "ilike": sql = `${c}::text ilike ${push(val.replaceAll("*", "%"))}`; break;
      case "is": sql = `${c} is ${({ null: "null", true: "true", false: "false", unknown: "unknown" } as Record<string, string>)[val] ?? "null"}`; break;
      case "in": sql = `${c}::text = any(${push(splitTop(val.slice(1, -1)).map((x) => x.replace(/^"|"$/g, "")))}::text[])`; break;
      default: throw Object.assign(new Error(`operador no soportado: ${op}`), { code: "PGRST100" });
    }
    return negate ? `not (${sql})` : sql;
  }
  function buildOrder(order: string | null, a: string) {
    if (!order) return "";
    const parts = order.split(",").map((o) => {
      const [col, ...mods] = o.split(".");
      if (!IDENT.test(col!)) throw Object.assign(new Error(`orden inválido ${col}`), { code: "PGRST100" });
      const dir = mods.includes("desc") ? "desc" : "asc";
      const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
      return `${a}."${col}" ${dir}${nulls}`;
    });
    return ` order by ${parts.join(", ")}`;
  }

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  return {
    db,
    url: `http://127.0.0.1:${opts.port}`,
    reloadMeta: async () => { meta = await loadMeta(db); },
    close: async () => { server.close(); await db.close(); },
  };
}

function pgrst116(n: number) {
  return { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${n} rows`, hint: null };
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined || status === 204) { res.writeHead(status); res.end(); return; }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function applyMigrations(db: PGlite) {
  await db.exec(`create schema if not exists private;
    create table if not exists private.schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const applied = new Set((await db.query<{ version: string }>(`select version from private.schema_migrations`)).rows.map((r) => r.version));
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort()) {
    if (applied.has(f)) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    await db.exec(`begin; set search_path = public, extensions;\n${sql}\n; insert into private.schema_migrations (version, checksum) values ('${f}', 'local'); commit;`);
    console.log(`[local-supabase] migración aplicada: ${f}`);
  }
  await db.exec("set search_path = public, extensions");
}

async function loadMeta(db: PGlite): Promise<Meta> {
  const cols = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`);
  const tables = new Map<string, Set<string>>();
  for (const c of cols.rows) tables.set(c.table_name, (tables.get(c.table_name) ?? new Set()).add(c.column_name));
  const fks = await db.query<{ name: string; table: string; cols: string[]; ref: string; ref_cols: string[] }>(`
    select con.conname as name, cl.relname as table,
           array(select a.attname::text from unnest(con.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as cols,
           rcl.relname as ref,
           array(select a.attname::text from unnest(con.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o) as ref_cols
    from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_class rcl on rcl.oid = con.confrelid join pg_namespace rn on rn.oid = rcl.relnamespace
    where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'`);
  const fns = await db.query<{ name: string; args: { name: string; type: string; mode: string }[] | null; retset: boolean; ret: string }>(`
    select p.proname as name,
           (select json_agg(json_build_object('name', coalesce(p.proargnames[i], ''), 'type', format_type(t, null), 'mode', coalesce(p.proargmodes[i], 'i')))
              from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(t, i)) as args,
           p.proretset as retset, format_type(p.prorettype, null) as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`);
  const fnMap = new Map<string, Fn>();
  for (const f of fns.rows) {
    const args = f.args ?? [];
    fnMap.set(f.name, {
      args: args.filter((a) => a.mode === "i" || a.mode === "b").map((a) => ({ name: a.name, type: a.type })),
      retset: f.retset, table: args.some((a) => a.mode === "t"), ret: f.ret,
    });
  }
  return { tables, fks: fks.rows.map((f) => ({ name: f.name, table: f.table, cols: f.cols, ref: f.ref, refCols: f.ref_cols })), fns: fnMap };
}

export { hashPassword };
