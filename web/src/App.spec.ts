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
    document.body.innerHTML = "";
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
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    const banner = wrapper.find('[current-app-slug="model-gateway"]');
    expect(banner.exists()).toBe(true);
    expect((banner.element as HTMLElement & { sites: unknown[] }).sites).toEqual([
      { slug: "files", name: "Files", baseUrl: "/files" },
      { slug: "model-gateway", name: "Model Gateway", baseUrl: "/gateway" }
    ]);
    expect(banner.attributes("current-app-slug")).toBe("model-gateway");
    expect(banner.attributes("account-settings-url")).toBe("/identity?tab=account-settings");
    await customElements.whenDefined(banner.element.localName);
    await flushPromises();
    expect(banner.element.shadowRoot?.querySelector(".banner")).toBeTruthy();

    const appsButton = banner.element.shadowRoot?.querySelector<HTMLButtonElement>("[data-toggle-apps]");
    expect(appsButton).toBeTruthy();
    appsButton!.click();
    const filesLink = banner.element.shadowRoot?.querySelector<HTMLAnchorElement>('a[href="/files"]');
    expect(filesLink?.href).toBe("http://localhost:3000/files");
    expect(filesLink?.textContent).toContain("Files");
    expect(wrapper.find("header.topbar").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the federated banner visible when OAuth has no app inventory", async () => {
    vi.mocked(request).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return {
        authenticated: true,
        user: { id: "user-1", email: "owner@example.test", displayName: "Owner", isAdmin: true, isOwner: false },
        federatedApps: [],
        accountSettingsUrl: "/identity?tab=account-settings"
      };
      if (path === "/keys") return { keys: [] };
      if (path === "/usage") return { series: [] };
      throw new Error(`Unexpected request: ${path}`);
    });

    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    const banner = wrapper.find('[current-app-slug="model-gateway"]');
    expect(banner.exists()).toBe(true);
    await customElements.whenDefined(banner.element.localName);
    await flushPromises();
    expect(banner.element.shadowRoot?.querySelector(".banner")).toBeTruthy();
    expect(banner.element.shadowRoot?.querySelector("[data-toggle-apps]")).toBeFalsy();
    expect(wrapper.find("header.topbar").exists()).toBe(false);
    wrapper.unmount();
  });

  it("retains the deployment-neutral header in standalone mode", async () => {
    vi.mocked(request).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return {
        authenticated: true,
        user: { id: "user-1", email: "owner@example.test", displayName: "Owner", isAdmin: true, isOwner: false },
        federatedApps: [],
        accountSettingsUrl: "#"
      };
      if (path === "/keys") return { keys: [] };
      if (path === "/usage") return { series: [] };
      throw new Error(`Unexpected request: ${path}`);
    });

    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.find('[current-app-slug="model-gateway"]').exists()).toBe(false);
    expect(wrapper.find("header.topbar").exists()).toBe(true);
    wrapper.unmount();
  });
});
