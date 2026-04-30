export interface SecretRedactionTargetV0 {
  envName: string;
  rawValue: string;
  secretRef?: string;
}

export interface SecretLeakV0 {
  path: string;
  envName: string;
  secretRef?: string;
}

export function collectRawSecretLeaksV0(
  value: unknown,
  targets: SecretRedactionTargetV0[],
): SecretLeakV0[] {
  const leaks: SecretLeakV0[] = [];
  visitValue(value, "$", normalizeTargets(targets), leaks);
  return leaks;
}

export function isRedactionSafeV0(
  value: unknown,
  targets: SecretRedactionTargetV0[],
): boolean {
  return collectRawSecretLeaksV0(value, targets).length === 0;
}

export function assertRedactionSafeV0(
  value: unknown,
  targets: SecretRedactionTargetV0[],
): void {
  const leaks = collectRawSecretLeaksV0(value, targets);
  if (leaks.length === 0) {
    return;
  }

  const details = leaks
    .map((leak) => `${leak.path}:${leak.envName}${leak.secretRef ? `:${leak.secretRef}` : ""}`)
    .join(", ");
  throw new Error(`bootstrap_secret_redaction_failed:${details}`);
}

function visitValue(
  value: unknown,
  path: string,
  targets: SecretRedactionTargetV0[],
  leaks: SecretLeakV0[],
): void {
  if (typeof value === "string") {
    for (const target of targets) {
      if (value.includes(target.rawValue)) {
        leaks.push({ path, envName: target.envName, secretRef: target.secretRef });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitValue(entry, `${path}[${index}]`, targets, leaks));
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      visitValue(entry, `${path}.${key}`, targets, leaks);
    }
  }
}

function normalizeTargets(targets: SecretRedactionTargetV0[]): SecretRedactionTargetV0[] {
  return targets.filter((target) => target.rawValue.length > 0);
}
