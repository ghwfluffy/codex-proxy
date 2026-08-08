import { describe,expect,it } from "vitest";
import { calculateCost,usageFromPayload } from "./usage.js";

describe("usage accounting",()=>{
  it("separates cache reads and writes",()=>{
    const usage=usageFromPayload({usage:{input_tokens:3000,input_tokens_details:{cached_tokens:2000,cache_write_tokens:500},output_tokens:100,output_tokens_details:{reasoning_tokens:25},total_tokens:3100}},"/responses");
    expect(usage).toEqual({inputTokens:3000,cachedInputTokens:2000,cacheWriteTokens:500,outputTokens:100,reasoningTokens:25,totalTokens:3100});
    expect(calculateCost(usage,{id:"p",model:"m",input:1_000_000,cachedInput:100_000,cacheWrite:1_250_000,output:6_000_000})).toBe(1925);
  });
});
