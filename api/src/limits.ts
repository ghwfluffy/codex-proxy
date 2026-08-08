import type { GatewayKey } from "./types.js";

type Bucket = { minute: number; count: number; active: number };

export class LocalLimits {
  private readonly buckets = new Map<string, Bucket>();

  enter(key: GatewayKey): () => void {
    const minute = Math.floor(Date.now() / 60_000);
    const bucket = this.buckets.get(key.id) ?? { minute, count: 0, active: 0 };
    if (bucket.minute !== minute) { bucket.minute = minute; bucket.count = 0; }
    if (bucket.count >= key.rpm) throw new Error("rpm_exceeded");
    if (bucket.active >= key.concurrency) throw new Error("concurrency_exceeded");
    bucket.count += 1;
    bucket.active += 1;
    this.buckets.set(key.id, bucket);
    let released = false;
    return () => { if (!released) { released = true; bucket.active = Math.max(0, bucket.active - 1); } };
  }
}
