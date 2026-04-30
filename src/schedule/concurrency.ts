import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export interface AcquireScheduleConcurrencyLeaseInputV0 {
  dataDir?: string;
  scheduleId: string;
}

export interface ScheduleConcurrencyLeaseV0 {
  scheduleId: string;
  acquired: boolean;
  lockPath: string;
  release(): Promise<void>;
}

export async function acquireScheduleConcurrencyLease(
  input: AcquireScheduleConcurrencyLeaseInputV0,
): Promise<ScheduleConcurrencyLeaseV0> {
  const dataDir = input.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  const locksDir = join(dataDir, "schedule", "local-v0", "concurrency");
  await mkdir(locksDir, { recursive: true });

  const lockPath = join(locksDir, `${sanitizeScheduleId(input.scheduleId)}.lock`);
  try {
    await mkdir(lockPath);
    return createLease(input.scheduleId, lockPath, true);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return createLease(input.scheduleId, lockPath, false);
    }
    throw error;
  }
}

function createLease(scheduleId: string, lockPath: string, acquired: boolean): ScheduleConcurrencyLeaseV0 {
  let released = !acquired;
  return {
    scheduleId,
    acquired,
    lockPath,
    async release() {
      if (released) {
        return;
      }

      released = true;
      await rm(lockPath, { recursive: true, force: true });
    },
  };
}

function sanitizeScheduleId(scheduleId: string): string {
  return scheduleId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
