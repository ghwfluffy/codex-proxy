import { createHash } from "node:crypto";

function textBlock(block: unknown): block is Record<string, any> {
  if (!block || typeof block !== "object") return false;
  const type = String((block as any).type ?? "");
  return ["input_text", "text", "output_text", "refusal"].includes(type);
}

export function applyPromptCaching(body: Record<string, any>, keyId: string): Record<string, any> {
  const model = String(body.model ?? "");
  if (!model.startsWith("gpt-5.6")) return body;
  const copy = structuredClone(body);
  const threadHint = typeof copy.metadata?.conversation_id === "string" ? copy.metadata.conversation_id : typeof copy.gateway?.thread_id === "string" ? copy.gateway.thread_id : "shared";
  const toolHash = createHash("sha256").update(JSON.stringify(copy.tools ?? [])).digest("hex").slice(0, 12);
  copy.prompt_cache_key ??= `gateway:${keyId}:${threadHint}:${model}:${toolHash}`;
  copy.prompt_cache_options ??= { mode: "explicit", ttl: "30m" };

  const collection = Array.isArray(copy.input) ? copy.input : Array.isArray(copy.messages) ? copy.messages : [];
  let marked = false;
  for (let i = collection.length - 2; i >= 0 && !marked; i -= 1) {
    const item = collection[i];
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.content)) {
      for (let j = item.content.length - 1; j >= 0; j -= 1) {
        if (textBlock(item.content[j])) {
          item.content[j].prompt_cache_breakpoint = { mode: "explicit" };
          marked = true;
          break;
        }
      }
    }
  }
  if (!marked) delete copy.prompt_cache_options;
  delete copy.gateway;
  return copy;
}
