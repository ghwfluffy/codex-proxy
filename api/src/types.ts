export type User = { id: string; subject: string; email: string; displayName: string; isAdmin: boolean; isOwner: boolean; monthlyBudgetMicrousd: number };
export type Session = { token: string; user: User; expiresAt: string };
export type GatewayKey = { id: string; ownerId: string | null; name: string; backend: "openai_api" | "codex_subscription"; prefix: string; monthlyBudgetMicrousd: number | null; rpm: number; concurrency: number; revokedAt: string | null; createdAt: string };
export type Usage = { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number };
export type Price = { id: string; model: string; input: number; cachedInput: number; cacheWrite: number; output: number };
