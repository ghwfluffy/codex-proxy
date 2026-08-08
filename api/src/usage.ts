import type { Settings } from "./config.js";
import type { Db } from "./db.js";
import { transaction } from "./db.js";
import { keyForUpdate } from "./keys.js";
import type { GatewayKey, Price, Usage } from "./types.js";
import { uuid } from "./crypto.js";

export function usageFromPayload(payload: Record<string, any>, endpoint: string): Usage {
  const usage = payload.usage ?? {};
  if (endpoint.endsWith("chat/completions")) return { inputTokens: Number(usage.prompt_tokens ?? 0), cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0), cacheWriteTokens: Number(usage.prompt_tokens_details?.cache_write_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0), reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0), totalTokens: Number(usage.total_tokens ?? 0) };
  return { inputTokens: Number(usage.input_tokens ?? 0), cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens ?? 0), cacheWriteTokens: Number(usage.input_tokens_details?.cache_write_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0), reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens ?? 0), totalTokens: Number(usage.total_tokens ?? 0) };
}

export function calculateCost(usage: Usage, price: Price): number {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens);
  return Math.ceil((uncached * price.input + usage.cachedInputTokens * price.cachedInput + usage.cacheWriteTokens * price.cacheWrite + usage.outputTokens * price.output) / 1_000_000);
}

export async function currentPrice(db: Db, model: string): Promise<Price | null> {
  const result = await db.query(`SELECT * FROM model_prices WHERE model=$1 AND effective_at<=now() AND (expires_at IS NULL OR expires_at>now()) ORDER BY effective_at DESC LIMIT 1`, [model]);
  const row = result.rows[0];
  return row ? { id: String(row.id), model: String(row.model), input: Number(row.input_per_million_microusd), cachedInput: Number(row.cached_input_per_million_microusd), cacheWrite: Number(row.cache_write_per_million_microusd), output: Number(row.output_per_million_microusd) } : null;
}

export function estimateInputTokens(body: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(body).length / 3));
}

export async function reserveUsage(db: Db, settings: Settings, key: GatewayKey, endpoint: string, model: string, stream: boolean, body: Record<string, any>): Promise<{ id: string; price: Price | null; reserved: number }> {
  const price = key.backend === "openai_api" ? await currentPrice(db, model) : null;
  if (key.backend === "openai_api" && !price) throw new Error("unpriced_model");
  const inputTokens = estimateInputTokens(body);
  const maxOutput = Math.min(Number(body.max_output_tokens ?? body.max_completion_tokens ?? settings.maxOutputTokens), settings.maxOutputTokens);
  const reserved = price ? Math.ceil((inputTokens * price.input + maxOutput * price.output) / 1_000_000) : 0;
  const id = uuid();
  await transaction(db, async (client) => {
    const locked = await keyForUpdate(client, key.id);
    if (!locked) throw new Error("invalid_key");
    if (locked.backend === "openai_api") {
      const spent = await client.query(`SELECT COALESCE(sum(COALESCE(estimated_cost_microusd,reserved_cost_microusd)),0)::bigint AS cost FROM usage_requests WHERE api_key_id=$1 AND started_at>=date_trunc('month',now())`, [key.id]);
      if (Number(spent.rows[0].cost) + reserved > Number(locked.monthlyBudgetMicrousd ?? 0)) throw new Error("key_budget_exceeded");
      if (locked.ownerId) {
        const owner = await client.query("SELECT monthly_budget_microusd FROM users WHERE id=$1 FOR UPDATE", [locked.ownerId]);
        const ownerSpent = await client.query(`SELECT COALESCE(sum(COALESCE(estimated_cost_microusd,reserved_cost_microusd)),0)::bigint AS cost FROM usage_requests WHERE owner_id=$1 AND started_at>=date_trunc('month',now())`, [locked.ownerId]);
        if (Number(ownerSpent.rows[0].cost) + reserved > Number(owner.rows[0]?.monthly_budget_microusd ?? 0)) throw new Error("user_budget_exceeded");
      }
    }
    await client.query(`INSERT INTO usage_requests(id,api_key_id,owner_id,backend,endpoint,requested_model,streaming,reserved_cost_microusd,price_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, key.id, key.ownerId, key.backend, endpoint, model, stream, reserved, price?.id ?? null]);
  });
  return { id, price, reserved };
}

export async function finishUsage(db: Db, id: string, started: number, status: number, usage: Usage, price: Price | null, extra: { resolvedModel?: string; upstreamRequestId?: string; errorClass?: string } = {}): Promise<number | null> {
  const cost = price ? calculateCost(usage, price) : null;
  await db.query(`UPDATE usage_requests SET finished_at=now(),duration_ms=$2,status_code=$3,error_class=$4,upstream_request_id=$5,resolved_model=$6,input_tokens=$7,cached_input_tokens=$8,cache_write_tokens=$9,output_tokens=$10,reasoning_tokens=$11,total_tokens=$12,estimated_cost_microusd=$13 WHERE id=$1`, [id, Date.now()-started, status, extra.errorClass ?? null, extra.upstreamRequestId ?? null, extra.resolvedModel ?? null, usage.inputTokens, usage.cachedInputTokens, usage.cacheWriteTokens, usage.outputTokens, usage.reasoningTokens, usage.totalTokens, cost]);
  return cost;
}

export async function usageSummary(db: Db, ownerId?: string): Promise<any[]> {
  const result = await db.query(`SELECT date_trunc('hour',started_at) AS bucket,api_key_id,backend,requested_model AS model,count(*)::int AS requests,COALESCE(sum(input_tokens),0)::bigint AS input_tokens,COALESCE(sum(cached_input_tokens),0)::bigint AS cached_tokens,COALESCE(sum(cache_write_tokens),0)::bigint AS cache_write_tokens,COALESCE(sum(output_tokens),0)::bigint AS output_tokens,COALESCE(sum(estimated_cost_microusd),0)::bigint AS estimated_cost_microusd,avg(duration_ms)::int AS avg_duration_ms FROM usage_requests WHERE ($1::text IS NULL OR owner_id=$1) AND started_at>=now()-interval '90 days' GROUP BY 1,2,3,4 ORDER BY 1 DESC`, [ownerId ?? null]);
  return result.rows;
}
