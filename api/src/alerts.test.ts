import { describe,expect,it } from "vitest";
import { flattenLimits } from "./alerts.js";
describe("flattenLimits",()=>{it("returns every primary and secondary bucket",()=>{expect(flattenLimits({rateLimitsByLimitId:{codex:{primary:{usedPercent:80,resetsAt:1},secondary:{usedPercent:50,resetsAt:2}}}})).toHaveLength(2)})});
