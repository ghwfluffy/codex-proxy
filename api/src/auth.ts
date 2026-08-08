import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Settings } from "./config.js";
import type { Db } from "./db.js";
import { pkceChallenge, randomToken, sha256, uuid } from "./crypto.js";
import type { Session, User } from "./types.js";

function userFromRow(row: Record<string, unknown>, settings: Settings): User {
  return {
    id: String(row.id), subject: String(row.subject), email: String(row.email), displayName: String(row.display_name),
    isAdmin: Boolean(row.is_admin), isOwner: Boolean(row.is_admin) || String(row.subject) === settings.ownerSubject,
    monthlyBudgetMicrousd: Number(row.monthly_budget_microusd)
  };
}

export async function getSession(context: Context, db: Db, settings: Settings): Promise<User | null> {
  const token = getCookie(context, settings.sessionCookieName);
  if (!token) return null;
  const result = await db.query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`, [sha256(`${settings.sessionSecret}:${token}`)]);
  return result.rows[0] ? userFromRow(result.rows[0], settings) : null;
}

export async function createSession(context: Context, db: Db, settings: Settings, input: { subject: string; email: string; displayName: string; isAdmin: boolean }): Promise<User> {
  const userId = `oauth:${input.subject}`;
  const result = await db.query(`INSERT INTO users(id,subject,email,display_name,is_admin,monthly_budget_microusd) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(subject) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,is_admin=excluded.is_admin,updated_at=now() RETURNING *`,
    [userId, input.subject, input.email, input.displayName, input.isAdmin, settings.defaultUserBudgetMicrousd]);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + settings.sessionDurationMinutes * 60_000);
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [sha256(`${settings.sessionSecret}:${token}`), userId, expiresAt]);
  setCookie(context, settings.sessionCookieName, token, { httpOnly: true, secure: settings.appEnv === "production", sameSite: "Lax", path: settings.sessionCookiePath, expires: expiresAt });
  return userFromRow(result.rows[0], settings);
}

export async function logout(context: Context, db: Db, settings: Settings): Promise<void> {
  const token = getCookie(context, settings.sessionCookieName);
  if (token) await db.query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", [sha256(`${settings.sessionSecret}:${token}`)]);
  deleteCookie(context, settings.sessionCookieName, { path: settings.sessionCookiePath });
}

export function callbackUrl(settings: Settings): string {
  return `${settings.publicUrl.replace(/\/$/, "")}${settings.appBasePath}/api/v1/auth/oauth/callback`;
}

export async function startOauth(db: Db, settings: Settings, next: string): Promise<string> {
  const state = randomToken(24);
  const verifier = randomToken(32);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  await db.query("INSERT INTO oauth_states(state_hash,verifier,next_path,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')", [sha256(state), verifier, safeNext]);
  const params = new URLSearchParams({ response_type: "code", client_id: settings.oauthClientId, redirect_uri: callbackUrl(settings), scope: settings.oauthScope, state, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" });
  return `${settings.authBaseUrl.replace(/\/$/, "")}/oauth/authorize?${params}`;
}

export async function finishOauth(context: Context, db: Db, settings: Settings, fetcher: typeof fetch): Promise<{ user: User; next: string } | null> {
  const code = context.req.query("code");
  const state = context.req.query("state");
  if (!code || !state) return null;
  const stateResult = await db.query("DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING verifier,next_path", [sha256(state)]);
  if (!stateResult.rows[0]) return null;
  const base = settings.oauthServerBaseUrl ?? settings.authBaseUrl;
  const tokenResponse = await fetcher(`${base.replace(/\/$/, "")}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: settings.oauthClientId, code, redirect_uri: callbackUrl(settings), code_verifier: String(stateResult.rows[0].verifier) }) });
  if (!tokenResponse.ok) return null;
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return null;
  const infoResponse = await fetcher(`${base.replace(/\/$/, "")}/oauth/userinfo`, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!infoResponse.ok) return null;
  const info = await infoResponse.json() as Record<string, unknown>;
  if (typeof info.sub !== "string") return null;
  return {
    user: await createSession(context, db, settings, { subject: info.sub, email: typeof info.email === "string" ? info.email : `${info.sub}@invalid`, displayName: typeof info.name === "string" ? info.name : String(info.preferred_username ?? info.sub), isAdmin: info.is_admin === true }),
    next: String(stateResult.rows[0].next_path)
  };
}

export async function ensureDevSession(context: Context, db: Db, settings: Settings): Promise<User> {
  return createSession(context, db, settings, { subject: settings.ownerSubject, email: settings.devUserEmail, displayName: settings.devUserName, isAdmin: settings.devUserIsAdmin });
}
