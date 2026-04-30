import { describe, expect, it } from "vitest";

import { normalizeBootstrapStatusV0 } from "@/bootstrap/contracts.js";

describe("bootstrap status compatibility", () => {
  it("treats legacy done as a synonym for succeeded", () => {
    expect(normalizeBootstrapStatusV0("done")).toBe("succeeded");
    expect(normalizeBootstrapStatusV0("succeeded")).toBe("succeeded");
  });

  it("passes through current and future additive values", () => {
    expect(normalizeBootstrapStatusV0("blocked")).toBe("blocked");
    expect(normalizeBootstrapStatusV0("future_status")).toBe("future_status");
    expect(normalizeBootstrapStatusV0(42)).toBeNull();
  });
});
