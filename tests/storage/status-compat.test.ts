import { describe, expect, it } from "vitest";

import { normalizeStorageEventResultStatusV0 } from "@/storage/event-ledger.js";

describe("storage status compatibility", () => {
  it("treats legacy done as a synonym for succeeded", () => {
    expect(normalizeStorageEventResultStatusV0("done")).toBe("succeeded");
    expect(normalizeStorageEventResultStatusV0("succeeded")).toBe("succeeded");
  });

  it("passes through existing statuses and future additive values", () => {
    expect(normalizeStorageEventResultStatusV0("blocked")).toBe("blocked");
    expect(normalizeStorageEventResultStatusV0("future_status")).toBe("future_status");
    expect(normalizeStorageEventResultStatusV0(42)).toBeNull();
  });
});
