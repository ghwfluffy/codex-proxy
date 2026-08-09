import type pg from "pg";
import type { Settings } from "./config.js";
import { hmac, randomToken, uuid } from "./crypto.js";
import { transaction, type Db } from "./db.js";
import type { GatewayKey, User } from "./types.js";

function fromRow(row: Record<string, unknown>): GatewayKey {
  return { id: String(row.id), ownerId: row.owner_id ? String(row.owner_id) : null, name: String(row.name), backend: String(row.backend) as GatewayKey["backend"], prefix: String(row.prefix), monthlyBudgetMicrousd: row.monthly_budget_microusd === null ? null : Number(row.monthly_budget_microusd), rpm: Number(row.rpm), concurrency: Number(row.concurrency), revokedAt: row.revoked_at ? String(row.revoked_at) : null, createdAt: String(row.created_at) };
}

export async function listKeys(db: Db, user: User, all = false): Promise<GatewayKey[]> {
  const result = all && user.isAdmin ? await db.query("SELECT * FROM api_keys ORDER BY created_at DESC") : await db.query("SELECT * FROM api_keys WHERE owner_id=$1 ORDER BY created_at DESC", [user.id]);
  return result.rows.map(fromRow);
}

export async function createKey(db: Db, settings: Settings, user: User, input: { name: string; backend?: GatewayKey["backend"] }): Promise<{ key: GatewayKey; token: string }> {
  const backend = input.backend ?? "openai_api";
  if (backend === "codex_subscription" && !user.isOwner) throw new Error("owner_required");
  const ownerId = user.id;
  if (!user.isAdmin) {
    const count = await db.query("SELECT count(*)::int AS count FROM api_keys WHERE owner_id=$1 AND revoked_at IS NULL", [user.id]);
    if (Number(count.rows[0].count) >= settings.maxUserKeys) throw new Error("key_limit");
  }
  const raw = `mgw_${randomToken(32)}`;
  const prefix = raw.slice(0, 12);
  const result = await db.query(`INSERT INTO api_keys(id,owner_id,name,backend,prefix,secret_hash,monthly_budget_microusd,rpm,concurrency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [uuid(), ownerId, input.name.trim().slice(0, 120), backend, prefix, hmac(raw, settings.keyPepper), backend === "openai_api" ? settings.defaultKeyBudgetMicrousd : null, settings.defaultRpm, settings.defaultConcurrency]);
  return { key: fromRow(result.rows[0]), token: raw };
}

export async function claimOwnerServiceKeys(db: Db, ownerId: string): Promise<number> {
  return transaction(db, async (client) => {
    const claimed = await client.query(
      `UPDATE api_keys
       SET owner_id=$1
       WHERE owner_id IS NULL AND backend='codex_subscription'
       RETURNING id`,
      [ownerId]
    );
    await client.query(
      `UPDATE usage_requests AS usage
       SET owner_id=$1
       FROM api_keys AS key
       WHERE usage.api_key_id=key.id
         AND usage.owner_id IS NULL
         AND key.owner_id=$1
         AND key.backend='codex_subscription'`,
      [ownerId]
    );
    return claimed.rowCount ?? 0;
  });
}

export async function revokeKey(db: Db, user: User, id: string): Promise<boolean> {
  const result = user.isAdmin ? await db.query("UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [id]) : await db.query("UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL", [id, user.id]);
  return Boolean(result.rowCount);
}

export async function authenticateKey(db: Db, settings: Settings, raw: string): Promise<GatewayKey | null> {
  const result = await db.query("SELECT * FROM api_keys WHERE secret_hash=$1 AND revoked_at IS NULL", [hmac(raw, settings.keyPepper)]);
  if (!result.rows[0]) return null;
  await db.query("UPDATE api_keys SET last_used_at=now() WHERE id=$1", [result.rows[0].id]);
  return fromRow(result.rows[0]);
}

export async function updateLimits(db: Db, id: string, input: { budgetMicrousd?: number; rpm?: number; concurrency?: number }): Promise<GatewayKey | null> {
  const result = await db.query(`UPDATE api_keys SET monthly_budget_microusd=COALESCE($2,monthly_budget_microusd),rpm=COALESCE($3,rpm),concurrency=COALESCE($4,concurrency) WHERE id=$1 RETURNING *`, [id, input.budgetMicrousd ?? null, input.rpm ?? null, input.concurrency ?? null]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function keyForUpdate(client: pg.PoolClient, id: string): Promise<GatewayKey | null> {
  const result = await client.query("SELECT * FROM api_keys WHERE id=$1 AND revoked_at IS NULL FOR UPDATE", [id]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}
