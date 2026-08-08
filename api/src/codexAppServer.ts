import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { Settings } from "./config.js";
import type { Usage } from "./types.js";
import { randomToken } from "./crypto.js";

type RpcMessage = { id?: string | number; method?: string; params?: any; result?: any; error?: any };
type Pending = { resolve: (value: any) => void; reject: (reason: unknown) => void; timer: NodeJS.Timeout };
type Outcome = { type: "tool"; requestId: string | number; callId: string; name: string; arguments: unknown; turnId: string } | { type: "complete"; text: string; usage: Usage; turnId: string };

const emptyUsage = (): Usage => ({ inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });

export class CodexAppServer {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<string | number, Pending>();
  private readonly events = new EventEmitter();
  private readonly messages = new Map<string, string>();
  private readonly usages = new Map<string, Usage>();
  private readonly outcomes = new Map<string, Outcome[]>();
  private rateLimitsValue: any = null;
  private rateLimitsAt = 0;

  constructor(private readonly settings: Settings) { this.events.setMaxListeners(200); }

  async start(): Promise<void> {
    if (this.process && !this.process.killed) return;
    this.process = spawn(this.settings.codexExecutable, ["app-server", "--listen", "stdio://"], {
      cwd: this.settings.codexCwd,
      env: { ...process.env, CODEX_HOME: this.settings.codexHome },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.process.stderr.on("data", (chunk) => process.stderr.write(`[codex-app-server] ${String(chunk)}`));
    this.process.once("exit", () => {
      for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(new Error("codex_app_server_exited")); }
      this.pending.clear(); this.process = undefined; this.events.emit("exit");
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      try { this.onMessage(JSON.parse(line) as RpcMessage); } catch { /* never log protocol bodies */ }
    });
    await this.request("initialize", { clientInfo: { name: "model_gateway", title: "Model Gateway", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    this.notify("initialized", {});
  }

  private onMessage(message: RpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(String(message.error.message ?? "codex_rpc_error"))) : pending.resolve(message.result); }
      return;
    }
    if (message.method === "account/rateLimits/updated") { this.rateLimitsValue = message.params; this.rateLimitsAt = Date.now(); }
    const threadId = typeof message.params?.threadId === "string" ? message.params.threadId : "";
    if (threadId && message.method === "item/agentMessage/delta") this.messages.set(threadId, `${this.messages.get(threadId) ?? ""}${String(message.params.delta ?? "")}`);
    if (threadId && message.method === "item/completed" && message.params?.item?.type === "agentMessage") this.messages.set(threadId, String(message.params.item.text ?? this.messages.get(threadId) ?? ""));
    if (threadId && message.method === "thread/tokenUsage/updated") {
      const last = message.params?.tokenUsage?.last ?? {};
      this.usages.set(threadId, { inputTokens: Number(last.inputTokens ?? 0), cachedInputTokens: Number(last.cachedInputTokens ?? 0), cacheWriteTokens: Number(last.cacheWriteInputTokens ?? 0), outputTokens: Number(last.outputTokens ?? 0), reasoningTokens: Number(last.reasoningOutputTokens ?? 0), totalTokens: Number(last.totalTokens ?? 0) });
    }
    if (message.method === "item/tool/call" && message.id !== undefined) this.pushOutcome(threadId, { type: "tool", requestId: message.id, callId: String(message.params.callId), name: String(message.params.tool), arguments: message.params.arguments, turnId: String(message.params.turnId) });
    if (threadId && message.method === "turn/completed") this.pushOutcome(threadId, { type: "complete", text: this.messages.get(threadId) ?? "", usage: this.usages.get(threadId) ?? emptyUsage(), turnId: String(message.params?.turn?.id ?? "") });
    if (message.id !== undefined && message.method && message.method.includes("requestApproval")) this.respond(message.id, { decision: "decline" });
    if (message.id !== undefined && message.method === "item/permissions/requestApproval") this.respond(message.id, { permissions: [], scope: "turn" });
  }

  private pushOutcome(threadId: string, outcome: Outcome): void {
    if (!this.events.emit(`outcome:${threadId}`, outcome)) {
      const queue = this.outcomes.get(threadId) ?? [];
      queue.push(outcome);
      this.outcomes.set(threadId, queue);
    }
  }

  private write(message: RpcMessage): void {
    if (!this.process?.stdin.writable) throw new Error("codex_app_server_unavailable");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method: string, params: any): void { this.write({ method, params }); }
  respond(id: string | number, result: any): void { this.write({ id, result }); }

  async request(method: string, params?: any, timeoutMs = this.settings.requestTimeoutSeconds * 1000): Promise<any> {
    await this.startIfNeeded(method);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("codex_rpc_timeout")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  private async startIfNeeded(method: string): Promise<void> { if (method !== "initialize" && !this.process) await this.start(); }

  async account(): Promise<any> { return this.request("account/read", { refreshToken: false }); }
  async loginStart(): Promise<any> { return this.request("account/login/start", { type: "chatgptDeviceCode" }); }
  async loginCancel(loginId: string): Promise<any> { return this.request("account/login/cancel", { loginId }); }
  async logout(): Promise<any> { return this.request("account/logout"); }
  async usage(): Promise<any> { return this.request("account/usage/read"); }
  async models(): Promise<any> { return this.request("model/list", { limit: 100, includeHidden: false }); }

  async rateLimits(force = false): Promise<any> {
    if (!force && this.rateLimitsValue && Date.now() - this.rateLimitsAt < 60_000) return { ...this.rateLimitsValue, observedAt: new Date(this.rateLimitsAt).toISOString() };
    const value = await this.request("account/rateLimits/read");
    this.rateLimitsValue = value; this.rateLimitsAt = Date.now();
    return { ...value, observedAt: new Date(this.rateLimitsAt).toISOString() };
  }

  async startThread(model: string, tools: any[]): Promise<string> {
    const dynamicTools = tools.filter((tool) => tool?.type === "function").map((tool) => ({ type: "function", name: String(tool.name ?? tool.function?.name), description: String(tool.description ?? tool.function?.description ?? ""), inputSchema: tool.parameters ?? tool.function?.parameters ?? { type: "object", properties: {} } }));
    const result = await this.request("thread/start", { model, cwd: this.settings.codexCwd, approvalPolicy: "never", sandbox: "read-only", serviceName: "model_gateway", baseInstructions: "Act only as a language model. Do not use shell, filesystem, web, apps, skills, plugins, MCP, collaboration, or built-in tools. Use only the dynamic functions supplied by the host.", dynamicTools });
    return String(result.thread.id);
  }

  async resumeThread(threadId: string): Promise<void> { await this.request("thread/resume", { threadId, cwd: this.settings.codexCwd, approvalPolicy: "never", sandbox: "read-only" }); }

  async startTurn(threadId: string, input: string, model: string, effort?: string): Promise<void> {
    this.messages.set(threadId, ""); this.usages.set(threadId, emptyUsage());
    await this.request("turn/start", { threadId, input: [{ type: "text", text: input }], model, effort: effort ?? null, approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false } });
  }

  resolveTool(requestId: string | number, output: string, success = true): void { this.respond(requestId, { success, contentItems: [{ type: "inputText", text: output }] }); }

  waitForOutcome(threadId: string): Promise<Outcome> {
    const queued = this.outcomes.get(threadId);
    if (queued?.length) return Promise.resolve(queued.shift()!);
    return new Promise((resolve, reject) => {
      const event = `outcome:${threadId}`;
      const timer = setTimeout(() => { this.events.removeListener(event, onOutcome); reject(new Error("codex_turn_timeout")); }, this.settings.requestTimeoutSeconds * 1000);
      const onOutcome = (outcome: Outcome) => { clearTimeout(timer); resolve(outcome); };
      this.events.once(event, onOutcome);
    });
  }

  responseId(): string { return `resp_${randomToken(18)}`; }
}
