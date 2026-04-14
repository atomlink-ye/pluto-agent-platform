import type { Logger } from "pino";

export class WaitForAgentTracker {
  private waiters = new Map<string, Set<(reason?: string) => void>>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: "agent", component: "wait-for-agent-tracker" });
  }

  register(agentId: string, cancel: (reason?: string) => void): () => void {
    if (!this.waiters.has(agentId)) {
      this.waiters.set(agentId, new Set());
    }
    const waitersForAgent = this.waiters.get(agentId)!;
    waitersForAgent.add(cancel);

    return () => {
      const current = this.waiters.get(agentId);
      if (!current) return;
      current.delete(cancel);
      if (current.size === 0) this.waiters.delete(agentId);
    };
  }

  cancel(agentId: string, reason?: string): boolean {
    const waitersForAgent = this.waiters.get(agentId);
    if (!waitersForAgent || waitersForAgent.size === 0) return false;
    this.waiters.delete(agentId);
    for (const cancel of waitersForAgent) {
      try {
        cancel(reason);
      } catch (error) {
        this.logger.warn({ err: error, agentId }, "Cancel callback failed");
      }
    }
    return true;
  }
}
