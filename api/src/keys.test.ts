import { describe, expect, it } from "vitest";
import type { Settings } from "./config.js";
import type { Db } from "./db.js";
import { claimOwnerServiceKeys, createKey } from "./keys.js";
import type { User } from "./types.js";

const owner: User = {
  id: "oauth:owner-subject",
  subject: "owner-subject",
  email: "owner@example.test",
  displayName: "Owner",
  isAdmin: true,
  isOwner: true,
  monthlyBudgetMicrousd: 40_000_000
};

describe("service key ownership", () => {
  it("creates Codex service keys for the requesting owner", async () => {
    const db = {
      query: async (_sql: string, values: unknown[]) => ({
        rows: [{
          id: "key-id",
          owner_id: values[1],
          name: values[2],
          backend: values[3],
          prefix: values[4],
          monthly_budget_microusd: values[6],
          rpm: values[7],
          concurrency: values[8],
          revoked_at: null,
          created_at: new Date().toISOString()
        }]
      })
    } as unknown as Db;
    const settings = {
      keyPepper: "test-key-pepper-long-enough",
      defaultKeyBudgetMicrousd: 2_000_000,
      defaultRpm: 60,
      defaultConcurrency: 4
    } as Settings;

    const created = await createKey(db, settings, owner, { name: "Assistant", backend: "codex_subscription" });

    expect(created.key.ownerId).toBe(owner.id);
  });

  it("claims bootstrap keys and their historical usage together", async () => {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql);
        return sql.includes("RETURNING id") ? { rows: [{ id: "key-id" }], rowCount: 1 } : { rows: [], rowCount: 0 };
      },
      release: () => undefined
    };
    const db = { connect: async () => client } as unknown as Db;

    await expect(claimOwnerServiceKeys(db, owner.id)).resolves.toBe(1);
    expect(statements.some((sql) => sql.includes("UPDATE api_keys"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE usage_requests"))).toBe(true);
  });
});
