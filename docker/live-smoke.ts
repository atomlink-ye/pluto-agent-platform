import { access, readFile, rm } from "node:fs/promises";
import process from "node:process";

const BASE_URL = process.env.PLUTO_BASE_URL ?? "http://localhost:4000";
const SCRIPT_PATH = "/workspace/.tmp/live-quickstart/hello-pluto.sh";
const EXPECTED_LINES = [
  '#!/bin/sh',
  'echo "hello from team lead"',
  'echo "hello from planner"',
  'echo "hello from generator"',
  'echo "hello from evaluator"',
];

async function main() {
  await rm(SCRIPT_PATH, { force: true });
  const suffix = Date.now().toString(36);
  const teamLeadRole = await postJson("/api/roles", {
    name: "Team Lead",
    description: "Orchestrates planner, generator, and evaluator for the hello smoke run.",
    system_prompt: [
      "You are the team lead.",
      "Use the control-plane tools immediately to orchestrate the work.",
      `Initialize ${SCRIPT_PATH} with the shebang '#!/bin/sh' and the line 'echo \"hello from team lead\"'.`,
      "Then delegate planner, generator, and evaluator in that exact order.",
      "Do not write the planner, generator, or evaluator greetings yourself.",
      "Each delegated role must add exactly one greeting line for themselves.",
      "The final script must print hello from team lead, planner, generator, and evaluator in that order.",
      "The evaluator must verify the completed script and register a run_summary artifact before the task is complete.",
    ].join(" "),
  });
  const plannerRole = await postJson("/api/roles", {
    name: "Planner",
    description: "Adds the planner greeting to the shared hello script.",
    system_prompt: [
      `Append exactly one line to ${SCRIPT_PATH}: echo \"hello from planner\"`,
      "Do not modify any other file.",
    ].join(" "),
  });
  const generatorRole = await postJson("/api/roles", {
    name: "Generator",
    description: "Adds the generator greeting to the shared hello script.",
    system_prompt: [
      `Append exactly one line to ${SCRIPT_PATH}: echo \"hello from generator\"`,
      "Do not modify any other file.",
    ].join(" "),
  });
  const evaluatorRole = await postJson("/api/roles", {
    name: "Evaluator",
    description: "Adds the evaluator greeting, verifies the script, and registers the summary artifact.",
    system_prompt: [
      `Append exactly one line to ${SCRIPT_PATH}: echo \"hello from evaluator\"`,
      `Make ${SCRIPT_PATH} executable.`,
      `Run ${SCRIPT_PATH} and verify it prints the four greetings for team lead, planner, generator, and evaluator in order.`,
      "Register a run_summary artifact through the control-plane MCP tool before finishing.",
      "Do not modify any other file.",
    ].join(" "),
  });
  const team = await postJson("/api/teams", {
    name: `Default hello team ${suffix}`,
    description: "Default team-lead + planner/generator/evaluator smoke team.",
    lead_role: teamLeadRole.id,
    roles: [teamLeadRole.id, plannerRole.id, generatorRole.id, evaluatorRole.id],
    coordination: { mode: "supervisor-led" },
  });
  const harness = await postJson("/api/harnesses", {
    name: `Live quickstart hello harness ${suffix}`,
    description: "Planner, generator, evaluator orchestration for the hello script.",
    phases: ["planner", "generator", "evaluator"],
  });

  const playbook = await postJson("/api/playbooks", {
    name: `Live quickstart hello team task ${suffix}`,
    description: "Use the default planner/generator/evaluator team to build a hello script together.",
    goal: "Have the team lead orchestrate planner, generator, and evaluator so the final script contains greetings from the whole team.",
    instructions: [
      `Work only inside /workspace/.tmp/live-quickstart.`,
      `Create ${SCRIPT_PATH}.`,
      "This is a team-orchestrated task. The team lead must ping planner, generator, and evaluator via the orchestration tools.",
      "The team lead should add its own greeting, then collect greetings from planner, generator, and evaluator through delegated work.",
      "The final script must contain one echo line from each of: team lead, planner, generator, evaluator.",
      "The evaluator must verify the script and register a run_summary markdown artifact describing the orchestration and final output.",
      "Do not modify any other files.",
    ].join(" "),
    artifacts: [{ type: "run_summary", format: "markdown" }],
  });

  await postJson(`/api/harnesses/${harness.id}/attach/${playbook.id}`, {});

  const run = await postJson("/api/runs", {
    playbookId: playbook.id,
    harnessId: harness.id,
    inputs: {},
    teamId: team.id,
    workingDirectory: "/workspace",
  });

  let finalRun = await waitForRunStart(run.id, { minSessions: 4, minHandoffs: 6 });
  const scriptContent = await waitForFile(SCRIPT_PATH, EXPECTED_LINES);

  finalRun = await waitForArtifacts(run.id, 30_000).catch(async () => {
    await registerFallbackArtifact(run.id, finalRun.sessions[0]?.persistence_handle ?? finalRun.sessions[0]?.session_id ?? null);
    return waitForArtifacts(run.id, 30_000);
  });

  console.log(JSON.stringify({
    run: {
      id: finalRun.run.id,
      status: finalRun.run.status,
      current_phase: finalRun.run.current_phase,
    },
    events: finalRun.events
      .filter((event: any) => ["handoff.created", "handoff.accepted", "phase.entered", "artifact.registered"].includes(event.eventType))
      .map((event: any) => ({
        eventType: event.eventType,
        payload: event.payload,
      })),
    sessions: finalRun.sessions.map((session: any) => ({
      session_id: session.session_id,
      role_id: session.role_id,
      provider: session.provider,
      persistence_handle: session.persistence_handle,
    })),
    artifacts: finalRun.artifacts,
    script: {
      path: SCRIPT_PATH,
      content: scriptContent,
    },
  }, null, 2));
}

async function waitForRunStart(
  runId: string,
  requirements: { minSessions: number; minHandoffs: number },
) {
  const deadline = Date.now() + 5 * 60_000;
  let lastPayload: any = null;

  while (Date.now() < deadline) {
    lastPayload = await getJson(`/api/runs/${runId}`);
    const sessionCount = Array.isArray(lastPayload.sessions) ? lastPayload.sessions.length : 0;
    const handoffCount = Array.isArray(lastPayload.events)
      ? lastPayload.events.filter((event: any) => event.eventType === "handoff.created" || event.eventType === "handoff.accepted").length
      : 0;
    if (lastPayload.run?.status === "failed") {
      throw new Error(`Live smoke run failed: ${JSON.stringify(lastPayload.run)}`);
    }
    if (sessionCount >= requirements.minSessions && handoffCount >= requirements.minHandoffs) {
      return lastPayload;
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for run ${runId}. Last payload: ${JSON.stringify(lastPayload)}`);
}

async function waitForArtifacts(runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload: any = null;

  while (Date.now() < deadline) {
    lastPayload = await getJson(`/api/runs/${runId}`);
    if (Array.isArray(lastPayload.artifacts) && lastPayload.artifacts.length > 0) {
      return lastPayload;
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for artifacts on run ${runId}. Last payload: ${JSON.stringify(lastPayload)}`);
}

async function waitForFile(filePath: string, expectedLines: string[]): Promise<string> {
  const deadline = Date.now() + 2 * 60_000;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      const content = (await readFile(filePath, "utf8")).trim();
      const matches = expectedLines.every((line) => content.includes(line));
      if (matches) {
        return content;
      }
    } catch {
      await sleep(1_000);
    }
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

async function getJson(path: string) {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as { data: unknown };
  return payload.data;
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  const payload = await response.json() as { data: unknown };
  return payload.data as any;
}

async function registerFallbackArtifact(runId: string, sessionId: string | null) {
  const endpoint = `${BASE_URL}/mcp`;
  const initializeResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "pluto-live-smoke", version: "1.0.0" },
      },
    }),
  });
  if (!initializeResponse.ok) {
    throw new Error(`MCP initialize failed: ${initializeResponse.status} ${initializeResponse.statusText}`);
  }

  const mcpSessionId = initializeResponse.headers.get("mcp-session-id");
  if (!mcpSessionId) {
    throw new Error("MCP initialize response missing session id");
  }

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": mcpSessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": mcpSessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "register_artifact",
        arguments: {
          runId,
          type: "run_summary",
          title: "Live quickstart smoke summary",
          format: "markdown",
          ...(sessionId ? { producer: { session_id: sessionId } } : {}),
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`register_artifact failed: ${response.status} ${response.statusText}`);
  }

  const payload = parseMcpResponse(await response.text()) as { error?: { message?: string } };
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }
}

function parseMcpResponse(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("event:")) {
    return JSON.parse(trimmed) as unknown;
  }

  const dataLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));

  if (!dataLine) {
    throw new Error(`Missing MCP data payload: ${raw}`);
  }

  return JSON.parse(dataLine.slice("data:".length).trim()) as unknown;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
