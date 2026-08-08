import { describe,expect,it } from "vitest";
import { applyPromptCaching } from "./promptCache.js";

describe("applyPromptCaching",()=>{
  it("marks the final completed content block and strips gateway extensions",()=>{
    const body=applyPromptCaching({model:"gpt-5.6-sol",gateway:{thread_id:"thread-1"},input:[{role:"developer",content:[{type:"input_text",text:"stable"}]},{role:"assistant",content:[{type:"output_text",text:"done"}]},{role:"user",content:[{type:"input_text",text:"new"}]}],tools:[{type:"function",name:"read"}]},"key-1");
    expect(body.prompt_cache_options).toEqual({mode:"explicit",ttl:"30m"});
    expect(body.input[1].content[0].prompt_cache_breakpoint).toEqual({mode:"explicit"});
    expect(body.prompt_cache_key).toContain("thread-1");
    expect(body.gateway).toBeUndefined();
  });
  it("does not send unsupported cache controls to older models",()=>expect(applyPromptCaching({model:"gpt-5.5",input:"x"},"key")).toEqual({model:"gpt-5.5",input:"x"}));
});
