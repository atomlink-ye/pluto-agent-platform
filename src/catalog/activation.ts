export interface CatalogActivationDependency {
  code: string;
  satisfied: boolean;
  reason?: string;
}

export interface CatalogAssetActivationInput {
  assetId: string;
  requiredTools?: string[];
  requiredSecrets?: string[];
  requiredRuntime?: string[];
  dependencies?: CatalogActivationDependency[];
}

export interface CatalogActivationInput {
  assets: CatalogAssetActivationInput[];
  availableTools?: string[];
  boundSecrets?: string[];
  runtimePosture?: Record<string, boolean>;
}

export interface CatalogAssetActivationResult {
  assetId: string;
  state: "allow" | "deny";
  reasons: string[];
}

export interface CatalogActivationResult {
  state: "allow" | "deny";
  reasons: string[];
  assets: CatalogAssetActivationResult[];
}

export function evaluateCatalogActivation(input: CatalogActivationInput): CatalogActivationResult {
  const availableTools = new Set(input.availableTools ?? []);
  const boundSecrets = new Set(input.boundSecrets ?? []);
  const runtimePosture = input.runtimePosture ?? {};

  const assets = input.assets.map((asset) => {
    const reasons: string[] = [];

    for (const tool of asset.requiredTools ?? []) {
      if (!availableTools.has(tool)) {
        reasons.push(`tool_missing:${tool}`);
      }
    }

    for (const secret of asset.requiredSecrets ?? []) {
      if (!boundSecrets.has(secret)) {
        reasons.push(`secret_missing:${secret}`);
      }
    }

    for (const runtimeRequirement of asset.requiredRuntime ?? []) {
      if (runtimePosture[runtimeRequirement] !== true) {
        reasons.push(`runtime_unresolved:${runtimeRequirement}`);
      }
    }

    for (const dependency of asset.dependencies ?? []) {
      if (!dependency.satisfied) {
        reasons.push(dependency.reason ?? `dependency_unresolved:${dependency.code}`);
      }
    }

    return {
      assetId: asset.assetId,
      state: reasons.length === 0 ? "allow" : "deny",
      reasons,
    } satisfies CatalogAssetActivationResult;
  });

  const reasons = assets.flatMap((asset) =>
    asset.state === "deny" ? asset.reasons.map((reason) => `${asset.assetId}:${reason}`) : [],
  );

  if (assets.length === 0) {
    reasons.push("catalog_assets_missing");
  }

  return {
    state: reasons.length === 0 ? "allow" : "deny",
    reasons,
    assets,
  };
}
