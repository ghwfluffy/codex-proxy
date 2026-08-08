import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (value: string): string => createHash("sha256").update(value, "ascii").digest("base64url");
export const uuid = (): string => randomUUID();

export function hmac(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
