import { describe,expect,it,vi } from "vitest";
import { request } from "./api";
describe("api",()=>{it("throws a server message",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:"denied"}}),{status:403,headers:{"content-type":"application/json"}})));await expect(request("/keys")).rejects.toThrow("denied")})});
