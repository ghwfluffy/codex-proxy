// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production web image", () => {
  it("builds the shared banner into the served bundle and disables stale shell caching", () => {
    const dockerfile = readFileSync(new URL("../../nginx/Dockerfile", import.meta.url), "utf8");
    const nginx = readFileSync(new URL("../../nginx/default.conf.template", import.meta.url), "utf8");

    expect(dockerfile).toContain("COPY vendor/federated-banner/ /workspace/vendor/federated-banner/");
    expect(dockerfile).toContain("COPY --from=build /workspace/web/dist /usr/share/nginx/html");
    expect(nginx).toContain('Cache-Control "no-store, no-cache, must-revalidate, max-age=0"');
  });
});
