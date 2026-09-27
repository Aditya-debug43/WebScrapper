import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env } from "../config/env.js";
import { schema } from "./schema.js";

/**
 * One database handle, two drivers, one schema.
 *
 * `postgres` connects to a real server. `pglite` runs PostgreSQL 17 compiled to
 * WebAssembly in-process against a local directory — the same engine, the same
 * SQL, the same migrations, with nothing to install. Development and CI use it
 * so that migrations are genuinely executed rather than merely written; the
 * environment schema refuses to let it be selected in production.
 *
 * Callers get a Drizzle instance and never see which driver is underneath.
 */

/**
 * One canonical handle type.
 *
 * Deriving it from the return of createDb made it a UNION of the two driver
 * types, and a method call on a union resolves to the intersection of their
 * signatures — which quietly stripped the argument from .returning({...}).
 * Both drivers are a PgDatabase over the same schema, so naming that directly
 * is both accurate and stable.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function createDb() {
  if (env.DB_DRIVER === "postgres") {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
    const db = drizzle(pool, { schema });
    return {
      db,
      driver: "postgres" as const,
      /** Raw SQL escape hatch, used by the migrator and the verifier. */
      exec: async (sql: string) => {
        await pool.query(sql);
      },
      query: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
        const r = await pool.query(sql);
        return r.rows as T[];
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite(env.PGLITE_DATA_DIR);
  await client.waitReady;
  const db = drizzle(client, { schema });
  return {
    db,
    driver: "pglite" as const,
    exec: async (sql: string) => {
      await client.exec(sql);
    },
    query: async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
      const r = await client.query(sql);
      return r.rows as T[];
    },
    close: async () => {
      await client.close();
    },
  };
}
