import pg from "pg";
import type { Settings } from "./config.js";

const { Pool } = pg;

export type Db = pg.Pool;

export function createDb(settings: Settings): Db {
  return new Pool({ connectionString: settings.databaseUrl, max: 10 });
}

export async function transaction<T>(db: Db, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
