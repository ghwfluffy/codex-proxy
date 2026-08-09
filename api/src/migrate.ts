import { loadSettings } from "./config.js";
import { createDb, transaction } from "./db.js";
import { migrations } from "./migrations.js";
import { hmac } from "./crypto.js";
import { claimOwnerServiceKeys } from "./keys.js";

export async function migrate(): Promise<void> {
  const settings = loadSettings();
  const db = createDb(settings);
  try {
    await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const migration of migrations) {
      await transaction(db, async (client) => {
        const applied = await client.query("SELECT 1 FROM schema_migrations WHERE id=$1", [migration.id]);
        if (applied.rowCount) return;
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [migration.id]);
      });
    }
    if (settings.bootstrapServiceApiKey) {
      await db.query(`INSERT INTO api_keys(id,owner_id,name,backend,prefix,secret_hash,monthly_budget_microusd,rpm,concurrency)
        VALUES('20000000-0000-4000-8000-000000000001',NULL,'Assistant service','codex_subscription',$1,$2,NULL,$3,$4)
        ON CONFLICT(id) DO UPDATE SET prefix=excluded.prefix,secret_hash=excluded.secret_hash,revoked_at=NULL`, [
        settings.bootstrapServiceApiKey.slice(0, 12),
        hmac(settings.bootstrapServiceApiKey, settings.keyPepper),
        settings.defaultRpm,
        settings.defaultConcurrency
      ]);
    }
    const owner = await db.query("SELECT id FROM users WHERE subject=$1", [settings.ownerSubject]);
    if (owner.rows[0]?.id) {
      await claimOwnerServiceKeys(db, String(owner.rows[0].id));
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith("migrate.js") || process.argv[1]?.endsWith("migrate.ts")) {
  migrate().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
