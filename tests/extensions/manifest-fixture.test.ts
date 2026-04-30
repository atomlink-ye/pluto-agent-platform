import { describe, expect, it } from "vitest";

import type { ExtensionManifestV0 } from "@/extensions/contracts.js";

const fixtureManifest: ExtensionManifestV0 = {
  schemaVersion: 0,
  extensionId: "pluto.fixture.bundle",
  name: "Fixture Bundle",
  version: "0.2.0",
  description: "Fixture manifest covering skill, template, and policy declarations.",
  publisher: {
    name: "Pluto Fixtures",
  },
  license: "Apache-2.0",
  keywords: ["fixture", "skills", "policy"],
  assets: [
    {
      assetId: "manifest",
      kind: "manifest",
      path: "extension/manifest.json",
      mediaType: "application/json",
      checksum: { algorithm: "sha256", value: "fixture-manifest-256" },
    },
    {
      assetId: "skill.triage",
      kind: "skill",
      path: "skills/triage/SKILL.md",
      mediaType: "text/markdown",
      checksum: { algorithm: "sha256", value: "fixture-skill-256" },
    },
    {
      assetId: "template.policy-note",
      kind: "template",
      path: "templates/policy-note.md",
      mediaType: "text/markdown",
      checksum: { algorithm: "sha256", value: "fixture-template-256" },
    },
    {
      assetId: "policy.review-gate",
      kind: "policy",
      path: "policies/review-gate.json",
      mediaType: "application/json",
      checksum: { algorithm: "sha256", value: "fixture-policy-256" },
    },
  ],
  extensionPoints: [
    {
      point: "assistant.skill",
      target: "skill.fixture.triage",
      scope: "runtime",
      description: "Activates the triage skill in later lanes.",
    },
    {
      point: "assistant.template",
      target: "template.fixture.policy-note",
      scope: "session",
      description: "Makes the policy note template available for report generation.",
    },
    {
      point: "assistant.policy",
      target: "policy.fixture.review-gate",
      scope: "policy",
      description: "Applies a review gate before install and activation.",
    },
  ],
  compatibility: {
    pluto: { min: "0.1.0-alpha.0", max: null },
    opencode: { min: "0.3.0", max: null },
  },
  capabilities: [
    {
      name: "workspace.read",
      level: "read",
      reason: "Collect context for a triage run.",
    },
    {
      name: "policy.enforce",
      level: "admin",
      reason: "Attach policy constraints to later activation lanes.",
    },
  ],
  secretNames: [
    {
      name: "PLUTO_POLICY_TOKEN",
      required: true,
      reason: "Authorizes policy-backed fixture flows.",
    },
  ],
  toolSurfaces: [
    {
      tool: "read",
      access: "read",
      reason: "Collect fixture context.",
    },
    {
      tool: "bash",
      access: "exec",
      reason: "Run bounded verification commands when later lanes activate the skill.",
    },
  ],
  sensitivityClaims: [
    {
      domain: "policy.metadata",
      level: "moderate",
      reason: "The fixture captures trust and policy posture for later lanes.",
    },
  ],
  outboundWriteClaims: [
    {
      target: "workspace://policy-notes",
      access: "create",
      reason: "Writes generated policy notes.",
    },
  ],
  postureConstraints: [
    {
      name: "trust.review",
      mode: "require",
      value: "approved-before-activation",
      reason: "R2 stays metadata-only but needs explicit posture constraints for later lanes.",
    },
  ],
  contributions: {
    skills: [
      {
        kind: "skill",
        id: "skill.fixture.triage",
        name: "Triage Skill",
        version: "0.2.0",
        description: "Collects context before a bounded execution lane.",
        entrypoint: "skills/triage/SKILL.md",
        assetRef: "skill.triage",
        extensionPoints: ["assistant.skill"],
        toolSurface: ["read", "bash"],
        capabilityNames: ["workspace.read"],
        secretNames: [],
      },
    ],
    templates: [
      {
        kind: "template",
        id: "template.fixture.policy-note",
        name: "Policy Note Template",
        version: "0.2.0",
        description: "Builds a short policy note.",
        entrypoint: "templates/policy-note.md",
        assetRef: "template.policy-note",
        extensionPoints: ["assistant.template"],
        language: "markdown",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            findings: { type: "array", items: { type: "string" } },
          },
        },
      },
    ],
    policies: [
      {
        kind: "policy",
        id: "policy.fixture.review-gate",
        name: "Review Gate",
        version: "0.2.0",
        description: "Requires a trust review before install.",
        entrypoint: "policies/review-gate.json",
        assetRef: "policy.review-gate",
        extensionPoints: ["assistant.policy"],
        appliesTo: ["skill.fixture.triage"],
        ruleIds: ["trust-review-required", "verified-signature-required"],
      },
    ],
  },
  lifecycle: {
    status: "draft",
    channel: "preview",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
  },
};

describe("extension manifest fixture", () => {
  it("covers skill, template, and policy declarations expected by later lanes", () => {
    expect(fixtureManifest.contributions.skills).toHaveLength(1);
    expect(fixtureManifest.contributions.templates).toHaveLength(1);
    expect(fixtureManifest.contributions.policies).toHaveLength(1);
    expect(fixtureManifest.contributions.skills[0]?.entrypoint).toContain("SKILL.md");
    expect(fixtureManifest.contributions.skills[0]?.assetRef).toBe("skill.triage");
    expect(fixtureManifest.contributions.templates[0]?.language).toBe("markdown");
    expect(fixtureManifest.contributions.policies[0]?.ruleIds).toContain("trust-review-required");
  });

  it("keeps assets, extension points, capabilities, tools, and secret names explicit", () => {
    expect(fixtureManifest.assets.map((asset) => asset.assetId)).toEqual([
      "manifest",
      "skill.triage",
      "template.policy-note",
      "policy.review-gate",
    ]);
    expect(fixtureManifest.extensionPoints.map((point) => point.point)).toEqual([
      "assistant.skill",
      "assistant.template",
      "assistant.policy",
    ]);
    expect(fixtureManifest.capabilities.map((capability) => capability.name)).toEqual([
      "workspace.read",
      "policy.enforce",
    ]);
    expect(fixtureManifest.toolSurfaces.map((surface) => surface.tool)).toEqual(["read", "bash"]);
    expect(fixtureManifest.secretNames.map((secret) => secret.name)).toEqual(["PLUTO_POLICY_TOKEN"]);
  });

  it("captures posture, sensitivity, outbound writes, and compatibility metadata for later lanes", () => {
    expect(fixtureManifest.sensitivityClaims[0]?.domain).toBe("policy.metadata");
    expect(fixtureManifest.outboundWriteClaims[0]?.target).toBe("workspace://policy-notes");
    expect(fixtureManifest.postureConstraints[0]?.name).toBe("trust.review");
    expect(fixtureManifest.compatibility.opencode?.min).toBe("0.3.0");
  });

  it("round-trips as JSON without custom classes or runtime state", () => {
    expect(JSON.parse(JSON.stringify(fixtureManifest))).toEqual(fixtureManifest);
  });
});
