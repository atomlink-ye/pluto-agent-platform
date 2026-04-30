import { describe, expect, it } from "vitest";

import { evaluateCatalogActivation } from "@/catalog/activation.js";

describe("evaluateCatalogActivation", () => {
  it("keeps assets inactive while tools, secrets, runtime posture, or dependencies are unresolved", () => {
    const result = evaluateCatalogActivation({
      availableTools: ["node"],
      boundSecrets: [],
      runtimePosture: {
        sandboxed: false,
      },
      assets: [
        {
          assetId: "extension-a",
          requiredTools: ["node", "opencode"],
          requiredSecrets: ["provider-token"],
          requiredRuntime: ["sandboxed"],
          dependencies: [
            {
              code: "policy-review",
              satisfied: false,
              reason: "dependency_unresolved:policy-review",
            },
          ],
        },
      ],
    });

    expect(result.state).toBe("deny");
    expect(result.assets).toEqual([
      {
        assetId: "extension-a",
        state: "deny",
        reasons: [
          "tool_missing:opencode",
          "secret_missing:provider-token",
          "runtime_unresolved:sandboxed",
          "dependency_unresolved:policy-review",
        ],
      },
    ]);
    expect(result.reasons).toEqual([
      "extension-a:tool_missing:opencode",
      "extension-a:secret_missing:provider-token",
      "extension-a:runtime_unresolved:sandboxed",
      "extension-a:dependency_unresolved:policy-review",
    ]);
  });

  it("allows activation when all prerequisites are satisfied", () => {
    const result = evaluateCatalogActivation({
      availableTools: ["node", "opencode"],
      boundSecrets: ["provider-token"],
      runtimePosture: {
        sandboxed: true,
      },
      assets: [
        {
          assetId: "extension-a",
          requiredTools: ["node", "opencode"],
          requiredSecrets: ["provider-token"],
          requiredRuntime: ["sandboxed"],
          dependencies: [{ code: "policy-review", satisfied: true }],
        },
      ],
    });

    expect(result).toEqual({
      state: "allow",
      reasons: [],
      assets: [
        {
          assetId: "extension-a",
          state: "allow",
          reasons: [],
        },
      ],
    });
  });
});
