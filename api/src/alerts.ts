import type { Settings } from "./config.js";
import type { Db } from "./db.js";

type LimitBucket = { usedPercent: number; resetsAt?: number; windowDurationMins?: number };

export function flattenLimits(value: any): Array<{ id: string; bucket: LimitBucket }> {
  const sources = value?.rateLimitsByLimitId && typeof value.rateLimitsByLimitId === "object" ? Object.entries(value.rateLimitsByLimitId) : value?.rateLimits ? [[String(value.rateLimits.limitId ?? "codex"), value.rateLimits]] : [];
  const result: Array<{ id: string; bucket: LimitBucket }> = [];
  for (const [id, limit] of sources as Array<[string, any]>) {
    for (const name of ["primary", "secondary"] as const) if (limit?.[name] && Number.isFinite(Number(limit[name].usedPercent))) result.push({ id: `${id}:${name}`, bucket: limit[name] });
  }
  return result;
}

async function deliver(db: Db, settings: Settings, idempotencyKey: string, payload: Record<string, unknown>): Promise<void> {
  const inserted = await db.query("INSERT INTO alert_deliveries(idempotency_key,kind,payload_json) VALUES($1,'codex_usage',$2) ON CONFLICT DO NOTHING RETURNING idempotency_key", [idempotencyKey, JSON.stringify(payload)]);
  if (!inserted.rowCount || !settings.alertWebhookUrl) return;
  try {
    const response = await fetch(settings.alertWebhookUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${settings.alertWebhookToken}`, "idempotency-key": idempotencyKey }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`alert_http_${response.status}`);
    await db.query("UPDATE alert_deliveries SET delivered_at=now(),attempts=attempts+1,last_error=NULL WHERE idempotency_key=$1", [idempotencyKey]);
  } catch (error) {
    await db.query("UPDATE alert_deliveries SET attempts=attempts+1,last_error=$2 WHERE idempotency_key=$1", [idempotencyKey, error instanceof Error ? error.message.slice(0,200) : "alert_failed"]);
  }
}

export async function enforceCodexLimits(db: Db, settings: Settings, value: any): Promise<void> {
  const stopAt = 100 - settings.codexReservePercent;
  const alertAt = 100 - settings.codexAlertRemainingPercent;
  for (const { id, bucket } of flattenLimits(value)) {
    const window = String(bucket.resetsAt ?? Math.floor(Date.now()/3600000));
    if (bucket.usedPercent >= alertAt) await deliver(db, settings, `codex:${id}:${window}:warning`, { type: "codex_usage_warning", bucket: id, usedPercent: bucket.usedPercent, remainingPercent: Math.max(0,100-bucket.usedPercent), resetsAt: bucket.resetsAt ?? null, message: `Codex capacity is ${Math.max(0,100-bucket.usedPercent)}% remaining.` });
    if (bucket.usedPercent >= stopAt) {
      await deliver(db, settings, `codex:${id}:${window}:paused`, { type: "codex_usage_paused", bucket: id, usedPercent: bucket.usedPercent, remainingPercent: Math.max(0,100-bucket.usedPercent), resetsAt: bucket.resetsAt ?? null, message: `Codex proxy paused at the configured ${settings.codexReservePercent}% reserve.` });
      const error = new Error("codex_reserve_reached") as Error & { resetsAt?: number };
      error.resetsAt = bucket.resetsAt; throw error;
    }
  }
}
