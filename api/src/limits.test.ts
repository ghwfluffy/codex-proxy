import { describe,expect,it } from "vitest";
import { LocalLimits } from "./limits.js";
import type { GatewayKey } from "./types.js";
const key:GatewayKey={id:"k",ownerId:"u",name:"k",backend:"openai_api",prefix:"x",monthlyBudgetMicrousd:1,rpm:2,concurrency:1,revokedAt:null,createdAt:new Date().toISOString()};
describe("LocalLimits",()=>{it("enforces concurrency and releases",()=>{const limits=new LocalLimits();const release=limits.enter(key);expect(()=>limits.enter(key)).toThrow("concurrency_exceeded");release();expect(()=>limits.enter(key)).not.toThrow()})});
