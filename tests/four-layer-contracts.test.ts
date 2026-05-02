import { describe, expect, it } from "vitest";
import {
  FOUR_LAYER_AUTHORED_OBJECT_KINDS,
  FOUR_LAYER_DIRECTORY_NAMES,
  FOUR_LAYER_OBJECT_KINDS,
  RUN_STATUSES,
} from "@/index.js";

describe("four-layer contract exports", () => {
  it("exports the canonical authored and runtime object kinds", () => {
    expect(FOUR_LAYER_AUTHORED_OBJECT_KINDS).toEqual([
      "agent",
      "playbook",
      "scenario",
      "run_profile",
    ]);
    expect(FOUR_LAYER_OBJECT_KINDS).toEqual([
      "agent",
      "playbook",
      "scenario",
      "run_profile",
      "run",
      "evidence_packet",
    ]);
  });

  it("keeps authored directory names and run statuses stable", () => {
    expect(FOUR_LAYER_DIRECTORY_NAMES.run_profile).toBe("run-profiles");
    expect(RUN_STATUSES).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
      "failed_audit",
      "cancelled",
    ]);
  });
});
