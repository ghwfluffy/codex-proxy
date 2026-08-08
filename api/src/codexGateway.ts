import type { Db } from "./db.js";
import type { Settings } from "./config.js";
import type { GatewayKey, Usage } from "./types.js";
import { CodexAppServer } from "./codexAppServer.js";

type PendingTool = { requestId: string | number; threadId: string; callId: string };

function inputText(body: Record<string, any>): string {
  const source = body.input ?? body.messages ?? "";
  if (typeof source === "string") return source;
  if (!Array.isArray(source)) return JSON.stringify(source);
  const lines: string[] = [];
  for (const item of source) {
    if (item?.type === "function_call_output" || item?.role === "tool") continue;
    const role = String(item?.role ?? (item?.type === "message" ? "user" : "user"));
    if (typeof item?.content === "string") lines.push(`${role}: ${item.content}`);
    else if (Array.isArray(item?.content)) {
      const text = item.content.map((part: any) => part?.text ?? part?.content ?? "").filter(Boolean).join("\n");
      if (text) lines.push(`${role}: ${text}`);
    } else if (typeof item?.text === "string") lines.push(`${role}: ${item.text}`);
  }
  return lines.join("\n\n");
}

function toolOutput(body: Record<string, any>): { callId: string; output: string } | null {
  const source = body.input ?? body.messages;
  if (!Array.isArray(source)) return null;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const item = source[index];
    if (item?.type === "function_call_output" && typeof item.call_id === "string") return { callId: item.call_id, output: typeof item.output === "string" ? item.output : JSON.stringify(item.output) };
    if (item?.role === "tool" && typeof item.tool_call_id === "string") return { callId: item.tool_call_id, output: typeof item.content === "string" ? item.content : JSON.stringify(item.content) };
  }
  return null;
}

function responseObject(id: string, model: string, output: any[], usage: Usage, status = "completed"): Record<string, any> {
  return { id, object: "response", created_at: Math.floor(Date.now()/1000), status, model, output, parallel_tool_calls: false, usage: { input_tokens: usage.inputTokens, input_tokens_details: { cached_tokens: usage.cachedInputTokens, cache_write_tokens: usage.cacheWriteTokens }, output_tokens: usage.outputTokens, output_tokens_details: { reasoning_tokens: usage.reasoningTokens }, total_tokens: usage.totalTokens } };
}

export class CodexGateway {
  private readonly pending = new Map<string, PendingTool>();
  constructor(private readonly appServer: CodexAppServer, private readonly db: Db, private readonly settings: Settings) {}

  async health(): Promise<any> {
    const [account, rateLimits, usage] = await Promise.all([this.appServer.account(), this.appServer.rateLimits(true), this.appServer.usage()]);
    return { account, rateLimits, usage };
  }

  async models(): Promise<string[]> {
    const result = await this.appServer.models();
    const rows = Array.isArray(result?.data) ? result.data : Array.isArray(result?.models) ? result.models : [];
    return rows.map((row: any) => String(row.id ?? row.model ?? row.slug)).filter(Boolean);
  }

  async run(key: GatewayKey, body: Record<string, any>): Promise<Record<string, any>> {
    const model = String(body.model ?? "gpt-5.6-sol");
    const previousId = typeof body.previous_response_id === "string" ? body.previous_response_id : null;
    let threadId: string;
    if (previousId) {
      const mapping = await this.db.query("SELECT * FROM response_threads WHERE response_id=$1 AND api_key_id=$2 AND expires_at>now()", [previousId, key.id]);
      if (!mapping.rows[0]?.codex_thread_id) throw new Error("previous_response_not_found");
      threadId = String(mapping.rows[0].codex_thread_id);
      const output = toolOutput(body);
      if (output) {
        const pending = this.pending.get(previousId);
        if (!pending || pending.callId !== output.callId) throw new Error("pending_tool_not_found");
        this.appServer.resolveTool(pending.requestId, output.output, true);
        this.pending.delete(previousId);
      } else {
        await this.appServer.resumeThread(threadId);
        await this.appServer.startTurn(threadId, inputText(body), model, body.reasoning?.effort);
      }
    } else {
      threadId = await this.appServer.startThread(model, Array.isArray(body.tools) ? body.tools : []);
      await this.appServer.startTurn(threadId, inputText(body), model, body.reasoning?.effort);
    }
    const outcome = await this.appServer.waitForOutcome(threadId);
    const id = this.appServer.responseId();
    if (outcome.type === "tool") {
      this.pending.set(id, { requestId: outcome.requestId, threadId, callId: outcome.callId });
      await this.saveMapping(id, key.id, threadId, "pending_tool");
      return responseObject(id, model, [{ type: "function_call", id: `fc_${outcome.callId}`, call_id: outcome.callId, name: outcome.name, arguments: JSON.stringify(outcome.arguments ?? {}), status: "completed" }], { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }, "completed");
    }
    await this.saveMapping(id, key.id, threadId, "complete");
    return responseObject(id, model, [{ type: "message", id: `msg_${id.slice(5)}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: outcome.text, annotations: [] }] }], outcome.usage);
  }

  private async saveMapping(id: string, keyId: string, threadId: string, status: string): Promise<void> {
    await this.db.query("INSERT INTO response_threads(response_id,api_key_id,backend,codex_thread_id,status,expires_at) VALUES($1,$2,'codex_subscription',$3,$4,now()+interval '30 days')", [id,keyId,threadId,status]);
  }
}
