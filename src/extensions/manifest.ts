export interface ExtensionManifestAsset {
  id?: string;
  kind: string;
  path?: string;
  entry?: string;
  uri?: string;
  digest?: string;
  [key: string]: unknown;
}

export interface ExtensionManifest {
  id?: string;
  name?: string;
  version?: string;
  assets?: ExtensionManifestAsset[];
  capabilities?: string[];
  [key: string]: unknown;
}

export type ForbiddenManifestContentCode =
  | "plaintext_credential_value"
  | "tenant_private_endpoint"
  | "raw_provider_session"
  | "workspace_only_binding";

export interface ForbiddenManifestFinding {
  code: ForbiddenManifestContentCode;
  path: string;
  message: string;
}

export interface ManifestValidationResult {
  state: "allow" | "deny";
  reasons: string[];
  findings: ForbiddenManifestFinding[];
}

export function validateExtensionManifest(manifest: unknown): ManifestValidationResult {
  const reasons: string[] = [];

  if (!isRecord(manifest)) {
    return {
      state: "deny",
      reasons: ["manifest_not_object"],
      findings: [],
    };
  }

  if (!Array.isArray(manifest.assets)) {
    reasons.push("manifest_assets_missing");
  } else {
    manifest.assets.forEach((asset, index) => {
      if (!isRecord(asset)) {
        reasons.push(`asset_${index}_not_object`);
        return;
      }

      if (!isNonEmptyString(asset.kind)) {
        reasons.push(`asset_${index}_kind_missing`);
      }

      const locator = firstString(asset.path, asset.entry, asset.uri);
      if (!isNonEmptyString(locator)) {
        reasons.push(`asset_${index}_locator_missing`);
      } else if (isInvalidAssetLocator(locator)) {
        reasons.push(`asset_${index}_locator_invalid`);
      }

      if (asset.digest !== undefined && !isNonEmptyString(asset.digest)) {
        reasons.push(`asset_${index}_digest_invalid`);
      }
    });
  }

  const findings = detectForbiddenManifestContent(manifest);
  if (findings.length > 0) {
    reasons.push(...findings.map((finding) => `forbidden_${finding.code}`));
  }

  return {
    state: reasons.length === 0 ? "allow" : "deny",
    reasons,
    findings,
  };
}

export function detectForbiddenManifestContent(manifest: unknown): ForbiddenManifestFinding[] {
  const findings: ForbiddenManifestFinding[] = [];
  visitManifestValue(manifest, "$", findings);
  return findings;
}

function visitManifestValue(
  value: unknown,
  path: string,
  findings: ForbiddenManifestFinding[],
): void {
  if (typeof value === "string") {
    const leaf = pathLeaf(path);

    if (isSensitiveLeaf(leaf) && isPlaintextSecretValue(value)) {
      findings.push({
        code: "plaintext_credential_value",
        path,
        message: "Manifest contains a plaintext credential value.",
      });
    }

    if (isEndpointLeaf(leaf) && isTenantPrivateEndpoint(value)) {
      findings.push({
        code: "tenant_private_endpoint",
        path,
        message: "Manifest targets a tenant-private endpoint.",
      });
    }

    if (isSessionLeaf(leaf) && isRawProviderSessionValue(value)) {
      findings.push({
        code: "raw_provider_session",
        path,
        message: "Manifest embeds a raw provider session value.",
      });
    }

    if (isWorkspaceBindingLeaf(leaf) && isWorkspaceBindingValue(value)) {
      findings.push({
        code: "workspace_only_binding",
        path,
        message: "Manifest declares a workspace-only binding.",
      });
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visitManifestValue(entry, `${path}[${index}]`, findings);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (isWorkspaceBindingObject(value)) {
    findings.push({
      code: "workspace_only_binding",
      path,
      message: "Manifest declares a workspace-only binding.",
    });
  }

  Object.entries(value).forEach(([key, entry]) => {
    visitManifestValue(entry, `${path}.${key}`, findings);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function isInvalidAssetLocator(locator: string): boolean {
  if (!locator.trim()) {
    return true;
  }

  if (locator.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(locator)) {
    return true;
  }

  const segments = locator.split(/[\\/]+/);
  return segments.includes("..");
}

function pathLeaf(path: string): string {
  return path.replace(/.*\./, "").replace(/\[\d+\]$/, "");
}

function isSensitiveLeaf(leaf: string): boolean {
  return /(password|secret|token|credential|api[_-]?key|client[_-]?secret)/i.test(leaf);
}

function isEndpointLeaf(leaf: string): boolean {
  return /(endpoint|url|host|baseUrl|webhook)/i.test(leaf);
}

function isSessionLeaf(leaf: string): boolean {
  return /(session|cookie|authorization|authHeader|providerSession)/i.test(leaf);
}

function isWorkspaceBindingLeaf(leaf: string): boolean {
  return /(binding|mount|workspacePath|workspaceUri|scope)/i.test(leaf);
}

function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^\$\{[^}]+\}$/.test(trimmed) ||
    /^(env|secret|vault|ref):/i.test(trimmed) ||
    /^<[^>]+>$/.test(trimmed)
  );
}

function isPlaintextSecretValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !isPlaceholderValue(trimmed);
}

function isTenantPrivateEndpoint(value: string): boolean {
  const trimmed = value.trim();
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".corp") ||
      host.endsWith(".cluster.local") ||
      isPrivateIpv4(host)
    );
  } catch {
    return false;
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) {
    return false;
  }

  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isRawProviderSessionValue(value: string): boolean {
  const trimmed = value.trim();
  return !isPlaceholderValue(trimmed) && /(bearer\s+\S+|sess[_-][\w-]+|session=[^\s;]+|sk-[\w-]+)/i.test(trimmed);
}

function isWorkspaceBindingValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "workspace" || trimmed.startsWith("workspace://") || trimmed.startsWith("workspace/");
}

function isWorkspaceBindingObject(value: Record<string, unknown>): boolean {
  const scope = value["scope"];
  const source = value["source"];
  const bindingType = value["bindingType"];

  return (
    scope === "workspace" ||
    source === "workspace" ||
    bindingType === "workspace" ||
    isWorkspaceBindingValue(String(value["uri"] ?? ""))
  );
}
