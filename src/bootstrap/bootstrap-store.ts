import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";

import type {
  BootstrapChecklistV0,
  BootstrapFailureV0,
  BootstrapSessionV0,
  BootstrapStepV0,
} from "./contracts.js";
import {
  validateBootstrapFailureV0,
  validateBootstrapSessionV0,
  validateBootstrapStepV0,
} from "./contracts.js";
import { projectBootstrapChecklistV0 } from "./checklist.js";

export interface BootstrapStoreOptions {
  dataDir?: string;
}

export class BootstrapStore {
  private readonly dataDir: string;

  constructor(options: BootstrapStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async putSession(record: BootstrapSessionV0): Promise<BootstrapSessionV0> {
    const validated = validateSession(record);
    await mkdir(this.sessionDir(validated.workspaceRef.workspaceId, validated.id), { recursive: true });
    await this.writeJsonFile(this.sessionPath(validated.workspaceRef.workspaceId, validated.id), validated);
    return validated;
  }

  async getSession(workspaceId: string, sessionId: string): Promise<BootstrapSessionV0 | null> {
    const parsed = await this.readJsonFile(this.sessionPath(workspaceId, sessionId));
    if (parsed === null) {
      return null;
    }

    return validateSession(parsed);
  }

  async listSessions(workspaceId: string): Promise<BootstrapSessionV0[]> {
    let entries: Dirent[];
    try {
      entries = (await readdir(this.workspaceSessionsDir(workspaceId), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return [];
    }

    const sessions: BootstrapSessionV0[] = [];
    for (const entry of entries) {
      const session = await this.getSession(workspaceId, entry.name);
      if (session !== null) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  async putStep(record: BootstrapStepV0): Promise<BootstrapStepV0> {
    const validated = validateStep(record);
    await this.requireSession(validated.workspaceRef.workspaceId, validated.sessionId);
    await mkdir(this.stepsDir(validated.workspaceRef.workspaceId, validated.sessionId), { recursive: true });
    await this.writeJsonFile(
      this.stepPath(validated.workspaceRef.workspaceId, validated.sessionId, validated.id),
      validated,
    );
    return validated;
  }

  async getStep(workspaceId: string, sessionId: string, stepId: string): Promise<BootstrapStepV0 | null> {
    const parsed = await this.readJsonFile(this.stepPath(workspaceId, sessionId, stepId));
    if (parsed === null) {
      return null;
    }

    return validateStep(parsed);
  }

  async listSteps(workspaceId: string, sessionId: string): Promise<BootstrapStepV0[]> {
    return this.listRecords(
      this.stepsDir(workspaceId, sessionId),
      (entry) => entry.name.slice(0, -5),
      (id) => this.getStep(workspaceId, sessionId, id),
    );
  }

  async putFailure(record: BootstrapFailureV0): Promise<BootstrapFailureV0> {
    const validated = validateFailure(record);
    await this.requireSession(validated.workspaceRef.workspaceId, validated.sessionId);

    if (validated.stepId !== null) {
      const step = await this.getStep(validated.workspaceRef.workspaceId, validated.sessionId, validated.stepId);
      if (step === null) {
        throw new Error(
          `Bootstrap step not found: ${validated.workspaceRef.workspaceId}/${validated.sessionId}/${validated.stepId}`,
        );
      }
    }

    await mkdir(this.failuresDir(validated.workspaceRef.workspaceId, validated.sessionId), { recursive: true });
    await this.writeJsonFile(
      this.failurePath(validated.workspaceRef.workspaceId, validated.sessionId, validated.id),
      validated,
    );
    return validated;
  }

  async getFailure(workspaceId: string, sessionId: string, failureId: string): Promise<BootstrapFailureV0 | null> {
    const parsed = await this.readJsonFile(this.failurePath(workspaceId, sessionId, failureId));
    if (parsed === null) {
      return null;
    }

    return validateFailure(parsed);
  }

  async listFailures(workspaceId: string, sessionId: string): Promise<BootstrapFailureV0[]> {
    return this.listRecords(
      this.failuresDir(workspaceId, sessionId),
      (entry) => entry.name.slice(0, -5),
      (id) => this.getFailure(workspaceId, sessionId, id),
    );
  }

  async getChecklist(workspaceId: string, sessionId: string): Promise<BootstrapChecklistV0 | null> {
    const session = await this.getSession(workspaceId, sessionId);
    if (session === null) {
      return null;
    }

    return projectBootstrapChecklistV0({
      session,
      steps: await this.listSteps(workspaceId, sessionId),
    });
  }

  private async requireSession(workspaceId: string, sessionId: string): Promise<BootstrapSessionV0> {
    const session = await this.getSession(workspaceId, sessionId);
    if (session === null) {
      throw new Error(`Bootstrap session not found: ${workspaceId}/${sessionId}`);
    }

    return session;
  }

  private bootstrapDir(): string {
    return join(this.dataDir, "bootstrap");
  }

  private workspaceDir(workspaceId: string): string {
    return join(this.bootstrapDir(), workspaceId);
  }

  private workspaceSessionsDir(workspaceId: string): string {
    return join(this.workspaceDir(workspaceId), "sessions");
  }

  private sessionDir(workspaceId: string, sessionId: string): string {
    return join(this.workspaceDir(workspaceId), "sessions", sessionId);
  }

  private sessionPath(workspaceId: string, sessionId: string): string {
    return join(this.sessionDir(workspaceId, sessionId), "session.json");
  }

  private stepsDir(workspaceId: string, sessionId: string): string {
    return join(this.sessionDir(workspaceId, sessionId), "steps");
  }

  private stepPath(workspaceId: string, sessionId: string, stepId: string): string {
    return join(this.stepsDir(workspaceId, sessionId), `${stepId}.json`);
  }

  private failuresDir(workspaceId: string, sessionId: string): string {
    return join(this.sessionDir(workspaceId, sessionId), "failures");
  }

  private failurePath(workspaceId: string, sessionId: string, failureId: string): string {
    return join(this.failuresDir(workspaceId, sessionId), `${failureId}.json`);
  }

  private async readJsonFile(path: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  private async writeJsonFile(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async listRecords<T>(
    dir: string,
    toId: (entry: Dirent) => string,
    read: (id: string) => Promise<T | null>,
  ): Promise<T[]> {
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return [];
    }

    const records: T[] = [];
    for (const entry of entries) {
      const record = await read(toId(entry));
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }
}

function validateSession(value: unknown): BootstrapSessionV0 {
  const result = validateBootstrapSessionV0(value);
  if (!result.ok) {
    throw new Error(`Invalid bootstrap session: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function validateStep(value: unknown): BootstrapStepV0 {
  const result = validateBootstrapStepV0(value);
  if (!result.ok) {
    throw new Error(`Invalid bootstrap step: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function validateFailure(value: unknown): BootstrapFailureV0 {
  const result = validateBootstrapFailureV0(value);
  if (!result.ok) {
    throw new Error(`Invalid bootstrap failure: ${result.errors.join(", ")}`);
  }

  return result.value;
}
