import { z } from "zod";

const federatedAppSchema = z.object({
  slug: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().min(1).max(500).refine(
    (value) => value.startsWith("/") || /^https?:\/\//.test(value),
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
