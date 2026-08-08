import { Hono, type Context } from "hono";
import type { Settings } from "./config.js";
import type { Db } from "./db.js";
import { authenticateKey, createKey, listKeys, revokeKey, updateLimits } from "./keys.js";
import { ensureDevSession, finishOauth, getSession, logout, startOauth } from "./auth.js";
import { usageSummary } from "./usage.js";
import { ModelProxy } from "./proxy.js";
import type { User } from "./types.js";

const bad = (context: Context, status: number, code: string, message: string) => context.json({ error: { code, message } }, status as any);

export function buildApp(settings: Settings, db: Db, fetcher: typeof fetch = fetch): Hono {
  const app = new Hono();
  const proxy = new ModelProxy(db, settings, fetcher);
  const appUrl = (path = "/") => `${settings.appBasePath}${path}` || "/";
  async function user(context: Context): Promise<User | Response> { const value = await getSession(context, db, settings); return value ?? bad(context, 401, "not_authenticated", "Sign in required."); }
  async function admin(context: Context): Promise<User | Response> { const value = await user(context); return value instanceof Response || value.isAdmin ? value : bad(context, 403, "admin_required", "Administrator access required."); }
  async function owner(context: Context): Promise<User | Response> { const value = await user(context); return value instanceof Response || value.isOwner ? value : bad(context, 403, "owner_required", "Configured account owner access required."); }

  app.get("/healthz", async (context) => { try { await db.query("SELECT 1"); return context.json({ status: "ok" }); } catch { return context.json({ status: "error" }, 503); } });
  app.get("/readyz", async (context) => { try { await db.query("SELECT 1 FROM schema_migrations LIMIT 1"); return context.json({ status: "ready" }); } catch { return context.json({ status: "not_ready" }, 503); } });

  app.get("/api/v1/auth/me", async (context) => { const value = await getSession(context,db,settings); return context.json({ authenticated: Boolean(value), user: value }); });
  app.post("/api/v1/auth/dev-login", async (context) => settings.authMode === "standalone" ? context.json({ user: await ensureDevSession(context,db,settings) }) : bad(context,404,"not_found","Not found."));
  app.get("/api/v1/auth/login", async (context) => settings.authMode === "standalone" ? context.redirect(appUrl("/")) : context.redirect(await startOauth(db,settings,context.req.query("next") ?? "/")));
  app.get("/api/v1/auth/oauth/callback", async (context) => { const result = await finishOauth(context,db,settings,fetcher); return result ? context.redirect(appUrl(result.next)) : context.redirect(`${appUrl("/")}?oauth_error=oauth_failed`); });
  app.post("/api/v1/auth/logout", async (context) => { await logout(context,db,settings); return context.json({ authenticated: false }); });

  app.get("/api/v1/keys", async (context) => { const current=await user(context); return current instanceof Response?current:context.json({ keys:await listKeys(db,current) }); });
  app.post("/api/v1/keys", async (context) => { const current=await user(context); if(current instanceof Response)return current; const body=await context.req.json().catch(()=>({})); try { const created=await createKey(db,settings,current,{name:String(body.name??"API key"),backend:"openai_api"}); return context.json(created,201); } catch(error){const code=error instanceof Error?error.message:"create_failed";return bad(context,code==="key_limit"?409:400,code,code.replaceAll("_"," "));} });
  app.delete("/api/v1/keys/:id", async (context) => { const current=await user(context); if(current instanceof Response)return current; return (await revokeKey(db,current,context.req.param("id")))?context.body(null,204):bad(context,404,"not_found","Key not found."); });
  app.get("/api/v1/usage", async (context) => { const current=await user(context); return current instanceof Response?current:context.json({series:await usageSummary(db,current.id)}); });

  app.get("/api/v1/admin/keys", async (context) => { const current=await admin(context); return current instanceof Response?current:context.json({keys:await listKeys(db,current,true)}); });
  app.patch("/api/v1/admin/keys/:id/limits", async (context) => { const current=await admin(context); if(current instanceof Response)return current; const body=await context.req.json().catch(()=>({})); const key=await updateLimits(db,context.req.param("id"),{budgetMicrousd:Number.isInteger(body.budget_microusd)?body.budget_microusd:undefined,rpm:Number.isInteger(body.rpm)?body.rpm:undefined,concurrency:Number.isInteger(body.concurrency)?body.concurrency:undefined}); return key?context.json({key}):bad(context,404,"not_found","Key not found."); });
  app.get("/api/v1/admin/usage", async (context) => { const current=await admin(context); return current instanceof Response?current:context.json({series:await usageSummary(db)}); });
  app.post("/api/v1/owner/service-keys", async (context) => { const current=await owner(context); if(current instanceof Response)return current; const body=await context.req.json().catch(()=>({})); try{return context.json(await createKey(db,settings,current,{name:String(body.name??"Service key"),backend:"codex_subscription",ownerId:null}),201);}catch(error){return bad(context,400,"create_failed",error instanceof Error?error.message:"create failed");} });
  app.get("/api/v1/owner/codex", async (context) => { const current=await owner(context); if(current instanceof Response)return current; try{return context.json(await proxy.codex.health());}catch(error){return context.json({connected:false,error:error instanceof Error?error.message:"unavailable"},503);} });
  app.post("/api/v1/owner/codex/login", async (context) => { const current=await owner(context); return current instanceof Response?current:context.json(await proxy.appServer.loginStart()); });
  app.post("/api/v1/owner/codex/login/:id/cancel", async (context) => { const current=await owner(context); return current instanceof Response?current:context.json(await proxy.appServer.loginCancel(context.req.param("id"))); });
  app.post("/api/v1/owner/codex/logout", async (context) => { const current=await owner(context); return current instanceof Response?current:context.json(await proxy.appServer.logout()); });

  async function gatewayKey(context: Context) { const header=context.req.header("authorization")??""; if(!header.startsWith("Bearer "))return null; return authenticateKey(db,settings,header.slice(7).trim()); }
  app.get("/v1/models", async (context) => { const key=await gatewayKey(context); return key?context.json(await proxy.models(key)):context.json({error:{message:"Invalid API key.",type:"invalid_request_error",code:"invalid_api_key",param:null}},401); });
  for (const endpoint of ["responses","chat/completions"]) app.post(`/v1/${endpoint}`, async (context) => { const key=await gatewayKey(context); if(!key)return context.json({error:{message:"Invalid API key.",type:"invalid_request_error",code:"invalid_api_key",param:null}},401); const length=Number(context.req.header("content-length")??0); if(length>settings.maxBodyBytes)return context.json({error:{message:"Request body too large.",type:"invalid_request_error",code:"body_too_large",param:null}},413); const text=await context.req.text(); if(Buffer.byteLength(text)>settings.maxBodyBytes)return context.json({error:{message:"Request body too large.",type:"invalid_request_error",code:"body_too_large",param:null}},413); let body:Record<string,any>;try{body=JSON.parse(text);}catch{return context.json({error:{message:"Invalid JSON.",type:"invalid_request_error",code:"invalid_json",param:null}},400);} return proxy.handle(context,key,`/${endpoint}`,body); });
  return app;
}
