import { z } from "zod";

function isAllowedAppUrl(value: string): boolean {
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value);
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

const federatedAppSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().min(1).max(500).refine(
    isAllowedAppUrl,
    "App links must be root-relative or HTTP(S) URLs."
  ),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(100).optional()
}).strict();

export type FederatedApp = z.infer<typeof federatedAppSchema>;

export function parseFederatedApps(value: string | undefined): FederatedApp[] {
  if (!value?.trim()) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("FEDERATED_APPS must be valid JSON.");
  }
  const result = z.array(federatedAppSchema).safeParse(decoded);
  if (!result.success) throw new Error("FEDERATED_APPS must be an array of valid app links.");
  return result.data;
}

export function accountSettingsUrl(authMode: "standalone" | "oauth", authBaseUrl: string): string {
  if (authMode !== "oauth") return "#";
  const base = authBaseUrl.trim().replace(/\/+$/, "");
  return base ? `${base}?tab=account-settings` : "#";
}
