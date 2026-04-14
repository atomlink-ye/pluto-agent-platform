export function getOrchestratorModeInstructions(): string {
  return `
<orchestrator-mode>
Activation:
- Only activate if the user explicitly says "go into orchestrator mode" (or similar).
- Otherwise, do work directly yourself; do not spawn agents.

Core rules:
- In orchestrator mode, you accomplish tasks only by managing agents; do not perform the work yourself.
- Reuse an existing agent when the next step needs the same context.
- Start a new agent when switching to a different area/module.
</orchestrator-mode>
`;
}
