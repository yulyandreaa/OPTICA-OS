import { randomUUID } from "node:crypto";
import { connect, type Db } from "../../scripts/db/connect";

export { connect, type Db };

export async function createAuthUser(db: Db, email: string, fullName: string) {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, { full_name: fullName }]);
  return id;
}

/** Runs `fn` impersonating a Supabase user (role + JWT claims), exactly like PostgREST does. Rolled back unless `commit`. */
export async function asUser<T>(db: Db, userId: string | null, fn: () => Promise<T>, opts: { commit?: boolean } = {}): Promise<T> {
  await db.query("begin");
  try {
    if (userId) {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
      await db.query("set local role authenticated");
    } else {
      await db.query(`select set_config('request.jwt.claims', '', true)`);
      await db.query("set local role anon");
    }
    const result = await fn();
    await db.query(opts.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

export async function expectDenied(db: Db, userId: string, sql: string, params: unknown[] = []) {
  try {
    await asUser(db, userId, () => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Se esperaba rechazo y la consulta tuvo éxito: ${sql}`);
}
