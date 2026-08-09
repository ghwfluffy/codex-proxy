import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { request } from "./api";

vi.mock("./api", () => ({
  loginUrl: () => "/api/v1/auth/login?next=/",
  request: vi.fn()
}));

describe("app navigation", () => {
  beforeEach(() => {
    vi.mocked(request).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return {
        authenticated: true,
        user: { id: "user-1", email: "owner@example.test", displayName: "Owner", isAdmin: true, isOwner: false },
        federatedApps: [
          { slug: "files", name: "Files", baseUrl: "/files" },
          { slug: "model-gateway", name: "Model Gateway", baseUrl: "/gateway" }
        ],
        accountSettingsUrl: "/identity?tab=account-settings"
      };
      if (path === "/keys") return { keys: [] };
      if (path === "/usage") return { series: [] };
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it("renders the shared banner with configured app links for an authenticated user", async () => {
    const wrapper = mount(App);
    await flushPromises();

    const banner = wrapper.find('[current-app-slug="model-gateway"]');
    expect(banner.exists()).toBe(true);
    expect((banner.element as HTMLElement & { sites: unknown[] }).sites).toEqual([
      { slug: "files", name: "Files", baseUrl: "/files" },
      { slug: "model-gateway", name: "Model Gateway", baseUrl: "/gateway" }
    ]);
    expect(banner.attributes("current-app-slug")).toBe("model-gateway");
    expect(banner.attributes("account-settings-url")).toBe("/identity?tab=account-settings");
  });
});
