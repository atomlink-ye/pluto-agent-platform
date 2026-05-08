# GPT Pro architectural review on MCP-driven agentic loop (2026-05-08)

External independent strategic review received from operator after
T3 text-parsing blocker. Treat as ground-truth peer review on the
MCP migration direction.

## Headline judgment

> 现在代码已经把 hardcoded phase plan → lead-driven text directive
> loop 走了一大步；但你指出的 blocker 证明：下一步不能再修
> regex/fence，而应该把 lead/sub-actor 操作 RunKernel 的方式升级
> 为 MCP/tool-mediated control plane。

> assistant text != state
> tool/protocol request -> harness validation -> event log

This validates: the architecture issue, the MCP direction, and
the principle that text parsing as control plane was never
correct in v2's design — it was always a temporary scaffold.

## Confirmed alignments with local manager's discovery brief

- MCP > function-calling. OpenCode has native MCP support (local /
  remote in config), Paseo has OpenCode as first-class provider.
- Tool surface = 5 primitives mirroring kernel intents + a few
  inspection tools. No new RunEvent kinds.
- Tool schemas derived from v2-core payload schemas (no
  duplication).
- Kernel closed schema unchanged; replay determinism preserved.
- Transcripts still captured but only as audit, not control
  plane.
- T3 closure: keep `.pluto/runs/<runId>/`, full run directory,
  usageStatus, playbook resolution, projections, evidence
  packet, final report, docs sync. Stop patching the
  text-parsing live smoke.

## Key architectural insight GPT Pro added (NOT in my brief)

**IPC architecture for MCP server vs RunKernel ownership.**

Critical implementation detail: MCP server is its own
process; RunKernel currently lives in the `runPaseo()` driver
process. Three implementation options:

- **A — ToolBridge IPC (RECOMMENDED)**:
  ```
  runPaseo() owns RunKernel
    → starts local ToolBridge (unix socket / localhost random
      port, bearer token, bind 127.0.0.1)
    → launches OpenCode with MCP env:
        PLUTO_TOOL_BRIDGE_URL
        PLUTO_TOOL_BRIDGE_TOKEN
    → MCP server receives tool call from LLM
    → POST /tool/<name> to ToolBridge
    → ToolBridge calls RunKernel.submit()
    → returns accepted/rejected event to MCP
    → MCP returns to LLM
  ```
  Pro: minimal driver invasion, kernel ownership preserved,
  testable via in-process mock bridge.
  Con: must write a small IPC bridge (auth + routing + JSON over
  HTTP).

- **B — MCP owns RunKernel**: simpler tool handler but driver
  rewrites entirely; testing + replay re-derivation; rejected.

- **C — file-backed queue**: avoid HTTP but synchronous semantics
  + locking + crash recovery hell; rejected.

**Decision: adopt A.**

Architecture diagram:

```
+-----------------------+        spawn agent w/ MCP config
|  runPaseo() driver    |  ----------------------------+
|  - owns RunKernel     |                              |
|  - owns ToolBridge    |  <--- HTTP+token (localhost) |
|  - reads kernel       |                              v
|    events for         |     +------------------+   spawn
|    delegation/budget  |     | OpenCode agent   |  (paseo run)
+-----------------------+     | + MCP server     |
                              |   pluto_*        |
                              +------------------+
                                  |  ^
                                  v  |
                              tool calls
                                  |
                              JSON over MCP
```

## GPT Pro's slice refinement (more granular than my draft)

```
T4-D0  Discovery (read-only):
       - Paseo OpenCode provider startup path
       - opencode.json / .opencode/opencode.json injection
       - per-run config writability
       - global config + env fallback
       - MCP cwd / env propagation
       - tool name prefix rules

T4-S1  Tool surface contract (pure, in-process):
       - packages/pluto-v2-runtime/src/tools/pluto-tool-schemas.ts
       - packages/pluto-v2-runtime/src/tools/pluto-tool-handlers.ts
       - schemas derived from v2-core payload types
       - tests: arg parse, tool→ProtocolRequest, authority
         rejection, accepted-event serialization
       NO MCP server yet — handlers callable in-process

T4-S2  ToolBridge + MCP server:
       - packages/pluto-v2-runtime/src/mcp/pluto-mcp-server.ts
       - packages/pluto-v2-runtime/src/adapters/paseo/tool-bridge.ts
       - random localhost port, bearer token, 127.0.0.1 only,
         auto-shutdown on run completion
       - integration tests via in-process MCP client

T4-S3  Tool-driven runPaseo lane:
       - new orchestration.mode: 'agentic_tool'
       - rename current 'agentic' → 'agentic_text' (experimental)
       - lane never calls extractDirective
       - prompts no longer demand fenced JSON
       - terminal signal = pluto_complete_run tool call
       - delegation pointer triggered by tool calls (same
         scheduler logic, different signal source)

T4-S4  Live smoke + invariant test:
       - status === 'succeeded'
       - lead tool calls ≥ 2
       - sub-actor tool calls ≥ 1
       - mailbox message from sub-actor to lead ≥ 1
       - extractDirective unused in tool lane
       - events.jsonl free of parser-repair artifacts
       - usageStatus honest
```

## GPT Pro's short-term stopgap (only if T3 must ship a working
text live smoke; recommended NOT to pursue):

- Don't render JSON Schema in ```json fenced block in prompt
- Use sentinel `<pluto-directive>...</pluto-directive>` instead
  of markdown fence
- Or accept raw JSON object, no fence
- Parse repair prompt MUST NOT paste excerpts containing fences
- Mark as fallback lane only

This is bleeding-stop only. Not the real fix.

## Source of truth for "text != state" principle

GPT Pro cited Pluto's TRD + design docs:
- "普通 assistant text 不能等于 task state、mailbox message、
  evidence 或 artifact"
- "只有结构化 protocol message 或 tool call 才能改变状态"
- "model text 不是状态源" listed as explicit non-goal in TRD
- "protocol message 经过 parse/schema/sender/authority/
  current-state validation 后才 emit event"

The current text-parsing agentic mode violates these explicitly.
T4 brings the implementation back in line with the original
design.

## How to apply this in T4 plan

- Adopt slice cut T4-D0 / S1 / S2 / S3 / S4 verbatim.
- Adopt IPC architecture option A (ToolBridge).
- Adopt mode naming: `agentic_text` (experimental, deprecated)
  / `agentic_tool` (main).
- Reconcile with the in-flight MCP discovery (task-bd3a09 /
  bg b941zubg0) when it returns.
- Cite Pluto's TRD principle explicitly in the plan
  motivation.
