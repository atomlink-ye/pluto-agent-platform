import { describe, expect, it } from "vitest";

import { loadFourLayerWorkspace, renderRolePrompt, resolveFourLayerSelection } from "@/four-layer/index.js";

describe("agent teams v1.6 render", () => {
  it("renders coordination guidance instead of spawn-command templates for the lead", async () => {
    const workspace = await loadFourLayerWorkspace(process.cwd());
    const resolved = await resolveFourLayerSelection(workspace, { scenario: "hello-team" });

    const leadPrompt = renderRolePrompt(resolved, "lead", { runId: "run-123" });
    const plannerPrompt = renderRolePrompt(resolved, "planner", { runId: "run-123" });

    expect(leadPrompt).toContain("## Coordination via SendMessage and TaskTools");
    expect(leadPrompt).toContain("task.create");
    expect(leadPrompt).toContain("SendMessage");
    expect(leadPrompt).toContain("spawn_request");
    expect(leadPrompt).toContain("final_reconciliation");
    expect(leadPrompt).not.toContain("paseo run --provider");
    expect(leadPrompt).not.toContain("STAGE:");
    expect(plannerPrompt).not.toContain("## Coordination via SendMessage and TaskTools");
  });
});
