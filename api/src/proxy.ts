import type { Context } from "hono";
import type { Settings } from "./config.js";
import type { Db } from "./db.js";
import type { GatewayKey, Usage } from "./types.js";
import { LocalLimits } from "./limits.js";
import { applyPromptCaching } from "./promptCache.js";
import { finishUsage, reserveUsage, usageFromPayload } from "./usage.js";
import { CodexGateway } from "./codexGateway.js";
import { CodexAppServer } from "./codexAppServer.js";
import { enforceCodexLimits } from "./alerts.js";

const zeroUsage = (): Usage => ({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });

function errorBody(message: string, code: string, type = "invalid_request_error"): Record<string, unknown> {
  return { error: { message, type, code, param: null } };
}

function usageExtension(requestId: string, key: GatewayKey, usage: Usage, cost: number | null): Record<string, unknown> {
  return { request_id: requestId, backend: key.backend, billing_basis: key.backend === "openai_api" ? "metered_api" : "subscription", estimated_cost_usd: cost === null ? null : (cost / 1_000_000).toFixed(6), input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedInputTokens, cache_write_tokens: usage.cacheWriteTokens, output_tokens: usage.outputTokens, reasoning_tokens: usage.reasoningTokens, total_tokens: usage.totalTokens };
}

function chatFromResponse(response: Record<string, any>): Record<string, any> {
  const calls = response.output?.filter((item: any) => item.type === "function_call") ?? [];
  const text = response.output?.flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === "output_text").map((item: any) => item.text).join("") ?? "";
  return { id: response.id.replace(/^resp_/, "chatcmpl_"), object: "chat.completion", created: response.created_at, model: response.model, choices: [{ index: 0, message: { role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((call: any) => ({ id: call.call_id, type: "function", function: { name: call.name, arguments: call.arguments } })) } : {}) }, finish_reason: calls.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: response.usage?.input_tokens ?? 0, prompt_tokens_details: response.usage?.input_tokens_details ?? {}, completion_tokens: response.usage?.output_tokens ?? 0, completion_tokens_details: response.usage?.output_tokens_details ?? {}, total_tokens: response.usage?.total_tokens ?? 0 } };
}

function sseFromObject(payload: Record<string, any>, endpoint: string, extension: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    if (endpoint.endsWith("chat/completions")) {
      const chat = chatFromResponse(payload);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chat)}\n\nevent: gateway.usage\ndata: ${JSON.stringify(extension)}\n\ndata: [DONE]\n\n`));
    } else {
      controller.enqueue(encoder.encode(`event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { ...payload, output: [] } })}\n\n`));
      for (const item of payload.output ?? []) {
        if (item.type === "message") for (const content of item.content ?? []) if (content.type === "output_text") controller.enqueue(encoder.encode(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: content.text })}\n\n`));
        if (item.type === "function_call") controller.enqueue(encoder.encode(`event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item })}\n\n`));
      }
      controller.enqueue(encoder.encode(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: payload })}\n\nevent: gateway.usage\ndata: ${JSON.stringify(extension)}\n\n`));
    }
    controller.close();
  }});
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

export class ModelProxy {
  readonly appServer: CodexAppServer;
  readonly codex: CodexGateway;
  private readonly limits = new LocalLimits();
  constructor(private readonly db: Db, private readonly settings: Settings, private readonly fetcher: typeof fetch = fetch) {
    this.appServer = new CodexAppServer(settings);
    this.codex = new CodexGateway(this.appServer, db, settings);
  }

  async models(key: GatewayKey): Promise<Record<string, unknown>> {
    const models = key.backend === "codex_subscription" ? await this.codex.models() : (await this.db.query("SELECT DISTINCT model FROM model_prices WHERE effective_at<=now() AND (expires_at IS NULL OR expires_at>now()) ORDER BY model")).rows.map((row) => String(row.model));
    return { object: "list", data: models.map((id) => ({ id, object: "model", created: 0, owned_by: key.backend })) };
  }

  async handle(context: Context, key: GatewayKey, endpoint: string, body: Record<string, any>): Promise<Response> {
    const release = this.limits.enter(key);
    const started = Date.now();
    const model = typeof body.model === "string" ? body.model : "";
    if (!model) { release(); return context.json(errorBody("model is required", "model_required"), 400); }
    if (body.background === true || body.modalities || body.audio) { release(); return context.json(errorBody("This gateway supports text and function tools only.", "unsupported_feature"), 400); }
    const stream = body.stream === true;
    let reservation: Awaited<ReturnType<typeof reserveUsage>>;
    try { reservation = await reserveUsage(this.db, this.settings, key, endpoint, model, stream, body); }
    catch (error) { release(); const code = error instanceof Error ? error.message : "quota_error"; return context.json(errorBody(code.replaceAll("_", " "), code, code.includes("budget") ? "insufficient_quota" : "invalid_request_error"), code.includes("budget") ? 429 : 400); }
    try {
      if (key.backend === "codex_subscription") {
        const limits = await this.appServer.rateLimits(true);
        await enforceCodexLimits(this.db, this.settings, limits);
        const response = await this.codex.run(key, endpoint.endsWith("chat/completions") ? this.chatToResponses(body) : body);
        const payload = endpoint.endsWith("chat/completions") ? chatFromResponse(response) : response;
        const usage = usageFromPayload(payload, endpoint);
        const cost = await finishUsage(this.db, reservation.id, started, 200, usage, null, { resolvedModel: String(response.model) });
        const extension = usageExtension(reservation.id, key, usage, cost);
        release();
        if (stream) return sseFromObject(response, endpoint, extension);
        return context.json({ ...payload, gateway_usage: extension });
      }
      return await this.paidApi(context, key, endpoint, body, reservation, started, release);
    } catch (error) {
      const code = error instanceof Error ? error.message : "upstream_error";
      await finishUsage(this.db, reservation.id, started, code === "codex_reserve_reached" ? 429 : 502, zeroUsage(), reservation.price, { errorClass: code });
      release();
      const status = code === "codex_reserve_reached" ? 429 : code.includes("previous_response") || code.includes("pending_tool") ? 409 : 502;
      const headers: Record<string,string> = {};
      if (error && typeof error === "object" && "resetsAt" in error && Number((error as any).resetsAt)) headers["retry-after"] = String(Math.max(1, Number((error as any).resetsAt)-Math.floor(Date.now()/1000)));
      return context.json(errorBody(code.replaceAll("_", " "), code, status === 429 ? "rate_limit_error" : "upstream_error"), status, headers);
    }
  }

  private chatToResponses(body: Record<string, any>): Record<string, any> {
    const tools = Array.isArray(body.tools) ? body.tools.map((tool: any) => tool.type === "function" && tool.function ? { type: "function", ...tool.function } : tool) : [];
    return { model: body.model, input: body.messages, tools, previous_response_id: body.previous_response_id, reasoning: body.reasoning };
  }

  private async paidApi(context: Context, key: GatewayKey, endpoint: string, body: Record<string, any>, reservation: Awaited<ReturnType<typeof reserveUsage>>, started: number, release: () => void): Promise<Response> {
    const upstreamBody = applyPromptCaching(body, key.id);
    if (endpoint.endsWith("responses")) upstreamBody.max_output_tokens = Math.min(Number(upstreamBody.max_output_tokens ?? this.settings.maxOutputTokens), this.settings.maxOutputTokens);
    else { upstreamBody.max_completion_tokens = Math.min(Number(upstreamBody.max_completion_tokens ?? this.settings.maxOutputTokens), this.settings.maxOutputTokens); if (upstreamBody.stream) upstreamBody.stream_options = { ...(upstreamBody.stream_options ?? {}), include_usage: true }; }
    delete upstreamBody.gateway;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.settings.requestTimeoutSeconds * 1000);
    const upstream = await this.fetcher(`${this.settings.openaiBaseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`, { method: "POST", headers: { authorization: `Bearer ${this.settings.openaiApiKey}`, "content-type": "application/json" }, body: JSON.stringify(upstreamBody), signal: controller.signal });
    clearTimeout(timeout);
    if (!upstream.ok || !upstream.body) {
      const error = await upstream.json().catch(() => errorBody(`Upstream HTTP ${upstream.status}`, "upstream_http_error"));
      await finishUsage(this.db, reservation.id, started, upstream.status, zeroUsage(), reservation.price, { errorClass: `http_${upstream.status}`, upstreamRequestId: upstream.headers.get("x-request-id") ?? undefined }); release();
      return context.json(error as any, upstream.status as any);
    }
    if (!body.stream) {
      const payload = await upstream.json() as Record<string, any>;
      const usage = usageFromPayload(payload, endpoint);
      const cost = await finishUsage(this.db, reservation.id, started, upstream.status, usage, reservation.price, { resolvedModel: String(payload.model ?? body.model), upstreamRequestId: upstream.headers.get("x-request-id") ?? undefined });
      release(); return context.json({ ...payload, gateway_usage: usageExtension(reservation.id, key, usage, cost) });
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder(); const encoder = new TextEncoder(); let buffer = ""; let terminal: Record<string, any> | null = null;
    const output = new ReadableStream({
      pull: async (streamController) => {
        const { done, value } = await reader.read();
        if (!done) {
          const text = decoder.decode(value, { stream: true }); buffer += text;
          for (const line of buffer.split("\n")) if (line.startsWith("data: ") && line.slice(6) !== "[DONE]") { try { const parsed = JSON.parse(line.slice(6)); if (parsed.type === "response.completed") terminal = parsed.response; else if (parsed.usage) terminal = parsed; } catch {} }
          buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
          if (!text.includes("data: [DONE]")) streamController.enqueue(value); else {
            const withoutDone = text.replace(/data: \[DONE\]\s*/g, ""); if (withoutDone) streamController.enqueue(encoder.encode(withoutDone));
          }
          return;
        }
        const usage = terminal ? usageFromPayload(terminal, endpoint) : zeroUsage();
        const cost = await finishUsage(this.db, reservation.id, started, 200, usage, reservation.price, { resolvedModel: String(terminal?.model ?? body.model), upstreamRequestId: upstream.headers.get("x-request-id") ?? undefined });
        streamController.enqueue(encoder.encode(`event: gateway.usage\ndata: ${JSON.stringify(usageExtension(reservation.id, key, usage, cost))}\n\n${endpoint.endsWith("chat/completions") ? "data: [DONE]\n\n" : ""}`));
        release(); streamController.close();
      },
      cancel: async () => { await reader.cancel(); await finishUsage(this.db, reservation.id, started, 499, zeroUsage(), reservation.price, { errorClass: "client_disconnect" }); release(); }
    });
    return new Response(output, { status: upstream.status, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-gateway-request-id": reservation.id } });
  }
}
