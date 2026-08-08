import { readFileSync } from "node:fs";
import { z } from "zod";

const booleanValue = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return value;
}, z.boolean());

const schema = z.object({
  appEnv: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().min(1).max(65535).default(8000),
  appBasePath: z.string().default(""),
  publicUrl: z.string().url().default("http://localhost:18082"),
  authMode: z.enum(["standalone", "oauth"]).default("standalone"),
  authBaseUrl: z.string().default("/auth"),
  oauthServerBaseUrl: z.string().url().optional(),
  oauthClientId: z.string().default("model-gateway"),
  oauthScope: z.string().default("openid profile"),
  sessionCookieName: z.string().default("model_gateway_session"),
  sessionCookiePath: z.string().default("/"),
  sessionDurationMinutes: z.coerce.number().int().min(1).max(43200).default(1440),
  databaseUrl: z.string().min(1).default("postgres://gateway:gateway@localhost:5432/gateway"),
  keyPepper: z.string().min(16).default("development-key-pepper-change-me"),
  sessionSecret: z.string().min(16).default("development-session-secret-change-me"),
  ownerSubject: z.string().default("dev-owner"),
  bootstrapServiceApiKey: z.string().default(""),
  openaiApiKey: z.string().default(""),
  openaiBaseUrl: z.string().url().default("https://api.openai.com/v1"),
  codexExecutable: z.string().default("/workspace/api/node_modules/.bin/codex"),
  codexHome: z.string().default("/var/lib/model-gateway/codex-home"),
  codexCwd: z.string().default("/var/empty/model-gateway"),
  codexReservePercent: z.coerce.number().int().min(0).max(99).default(10),
  codexAlertRemainingPercent: z.coerce.number().int().min(1).max(99).default(20),
  codexLimitMaxStaleSeconds: z.coerce.number().int().min(30).max(3600).default(300),
  alertWebhookUrl: z.string().url().optional(),
  alertWebhookToken: z.string().default(""),
  defaultKeyBudgetMicrousd: z.coerce.number().int().min(0).default(2_000_000),
  defaultUserBudgetMicrousd: z.coerce.number().int().min(0).default(40_000_000),
  maxUserKeys: z.coerce.number().int().min(1).max(1000).default(20),
  defaultRpm: z.coerce.number().int().min(1).max(10000).default(60),
  defaultConcurrency: z.coerce.number().int().min(1).max(1000).default(4),
  maxOutputTokens: z.coerce.number().int().min(1).max(131072).default(16384),
  requestTimeoutSeconds: z.coerce.number().int().min(1).max(3600).default(500),
  maxBodyBytes: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(2 * 1024 * 1024),
  metricsRetentionDays: z.coerce.number().int().min(1).max(3650).default(365),
  devUserEmail: z.string().email().default("owner@example.test"),
  devUserName: z.string().default("Development Owner"),
  devUserIsAdmin: booleanValue.default(true)
});

export type Settings = z.infer<typeof schema>;

function secret(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const direct = env[name]?.trim();
  const file = env[`${name}_FILE`]?.trim();
  if (direct) return direct;
  if (file) return readFileSync(file, "utf8").trim();
  return undefined;
}

export function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  if (trimmed.includes("://") || trimmed.startsWith("//") || /[?#\\\s]/.test(trimmed)) {
    throw new Error("APP_BASE_PATH must be a path prefix.");
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const parsed = schema.parse({
    appEnv: env.APP_ENV,
    port: env.PORT,
    appBasePath: normalizeBasePath(env.APP_BASE_PATH ?? ""),
    publicUrl: env.PUBLIC_URL,
    authMode: env.AUTH_MODE,
    authBaseUrl: env.AUTH_BASE_URL,
    oauthServerBaseUrl: env.OAUTH_SERVER_BASE_URL,
    oauthClientId: env.OAUTH_CLIENT_ID,
    oauthScope: env.OAUTH_SCOPE,
    sessionCookieName: env.SESSION_COOKIE_NAME,
    sessionCookiePath: env.SESSION_COOKIE_PATH,
    sessionDurationMinutes: env.SESSION_DURATION_MINUTES,
    databaseUrl: env.DATABASE_URL ?? (env.POSTGRES_HOST ? `postgres://${encodeURIComponent(env.POSTGRES_USER ?? "gateway")}:${encodeURIComponent(secret("POSTGRES_PASSWORD", env) ?? "gateway")}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT ?? "5432"}/${env.POSTGRES_DB ?? "gateway"}` : undefined),
    keyPepper: secret("KEY_PEPPER", env),
    sessionSecret: secret("SESSION_SECRET", env),
    ownerSubject: env.OWNER_SUBJECT,
    bootstrapServiceApiKey: secret("BOOTSTRAP_SERVICE_API_KEY", env),
    openaiApiKey: secret("OPENAI_API_KEY", env),
    openaiBaseUrl: env.OPENAI_BASE_URL,
    codexExecutable: env.CODEX_EXECUTABLE,
    codexHome: env.CODEX_HOME,
    codexCwd: env.CODEX_CWD,
    codexReservePercent: env.CODEX_RESERVE_PERCENT,
    codexAlertRemainingPercent: env.CODEX_ALERT_REMAINING_PERCENT,
    codexLimitMaxStaleSeconds: env.CODEX_LIMIT_MAX_STALE_SECONDS,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL,
    alertWebhookToken: secret("ALERT_WEBHOOK_TOKEN", env),
    defaultKeyBudgetMicrousd: env.DEFAULT_KEY_BUDGET_MICROUSD,
    defaultUserBudgetMicrousd: env.DEFAULT_USER_BUDGET_MICROUSD,
    maxUserKeys: env.MAX_USER_KEYS,
    defaultRpm: env.DEFAULT_RPM,
    defaultConcurrency: env.DEFAULT_CONCURRENCY,
    maxOutputTokens: env.MAX_OUTPUT_TOKENS,
    requestTimeoutSeconds: env.REQUEST_TIMEOUT_SECONDS,
    maxBodyBytes: env.MAX_BODY_BYTES,
    metricsRetentionDays: env.METRICS_RETENTION_DAYS,
    devUserEmail: env.DEV_USER_EMAIL,
    devUserName: env.DEV_USER_NAME,
    devUserIsAdmin: env.DEV_USER_IS_ADMIN
  });
  if (parsed.appEnv === "production") {
    if (parsed.authMode !== "oauth" || !parsed.oauthServerBaseUrl) throw new Error("Production requires OAuth.");
    if (parsed.keyPepper.includes("development-") || parsed.sessionSecret.includes("development-")) throw new Error("Production secrets are required.");
    if (parsed.sessionCookiePath === "/") throw new Error("Production session cookie must be path-scoped.");
  }
  return parsed;
}
