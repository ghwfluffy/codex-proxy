import { describe, expect, it } from "vitest";
import { accountSettingsUrl, parseFederatedApps } from "./federation.js";

describe("federated app navigation", () => {
  it("accepts an explicit deployment app inventory", () => {
    expect(parseFederatedApps(JSON.stringify([
      { slug: "one", name: "One", baseUrl: "/one" },
      { slug: "two", name: "Two", baseUrl: "/two", description: "Second app" }
    ]))).toHaveLength(2);
    expect(parseFederatedApps("")).toEqual([]);
  });

  it("rejects invalid app inventory data", () => {
    expect(() => parseFederatedApps('[{"slug":"one"}]')).toThrow(/valid app links/);
    expect(() => parseFederatedApps('[{"slug":"bad","name":"Bad","baseUrl":"javascript:alert(1)"}]')).toThrow(/valid app links/);
    expect(() => parseFederatedApps("not-json")).toThrow(/valid JSON/);
  });

  it("exposes central account settings only in OAuth mode", () => {
    expect(accountSettingsUrl("oauth", "/identity/")).toBe("/identity?tab=account-settings");
    expect(accountSettingsUrl("standalone", "/identity")).toBe("#");
  });
});
