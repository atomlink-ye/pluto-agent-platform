import { describe, expect, it } from "vitest";

import { loadFourLayerWorkspace, renderRolePrompt, resolveFourLayerSelection } from "@/four-layer/index.js";

const LOCKED_COLLAR = "Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence.";

describe("prompt collar", () => {
  it("matches the lead collar snapshot", async () => {
    const prompt = await renderPrompt("hello-team", "lead");
    expect(extractCollar(prompt)).toMatchInlineSnapshot(`"Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence."`);
  });

  it("matches the planner collar snapshot", async () => {
    const prompt = await renderPrompt("hello-team", "planner");
    expect(extractCollar(prompt)).toMatchInlineSnapshot(`"Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence."`);
  });

  it("matches the generator collar snapshot", async () => {
    const prompt = await renderPrompt("hello-team", "generator");
    expect(extractCollar(prompt)).toMatchInlineSnapshot(`"Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence."`);
  });

  it("matches the evaluator collar snapshot", async () => {
    const prompt = await renderPrompt("hello-team", "evaluator");
    expect(extractCollar(prompt)).toMatchInlineSnapshot(`"Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence."`);
  });

  it("matches the custom-playbook coder collar snapshot", async () => {
    const prompt = await renderPrompt("add-greeting-fn", "coder");
    expect(extractCollar(prompt)).toMatchInlineSnapshot(`"Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence."`);
  });
});

async function renderPrompt(scenario: string, role: string): Promise<string> {
  const workspace = await loadFourLayerWorkspace(process.cwd());
  const resolved = await resolveFourLayerSelection(workspace, { scenario });
  return renderRolePrompt(resolved, role, { runId: "run-123" });
}

function extractCollar(prompt: string): string {
  expect(prompt).toContain(LOCKED_COLLAR);
  const start = prompt.indexOf(LOCKED_COLLAR);
  return prompt.slice(start, start + LOCKED_COLLAR.length);
}
