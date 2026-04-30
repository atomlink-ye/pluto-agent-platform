import { describe, expect, it } from "vitest";

import { normalizeScheduleRunStatusV0 } from "@/contracts/schedule.js";

describe("schedule status compatibility", () => {
  it("treats legacy done as a synonym for succeeded", () => {
    expect(normalizeScheduleRunStatusV0("done")).toBe("succeeded");
    expect(normalizeScheduleRunStatusV0("succeeded")).toBe("succeeded");
  });

  it("passes through existing statuses and future additive values", () => {
    expect(normalizeScheduleRunStatusV0("blocked")).toBe("blocked");
    expect(normalizeScheduleRunStatusV0("future_status")).toBe("future_status");
    expect(normalizeScheduleRunStatusV0(42)).toBeNull();
  });
});
