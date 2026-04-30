#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";

import { type ExtensionInstallV0, type ExtensionListItemV0, type ExtensionListOutputV0 } from "../extensions/contracts.js";
import { deriveRequestedPrivilegedCapabilities } from "../extensions/activation.js";
import { ExtensionStore } from "../extensions/extension-store.js";
import { activateExtension, installExtension, revokeExtension } from "../extensions/lifecycle.js";
import { validateExtensionManifest } from "../extensions/manifest.js";

function usage(): never {
  console.error(`Usage:
  pnpm extensions list [--json]
  pnpm extensions show <installId> [--json]
  pnpm extensions install <packageId> [--install-id ID] [--installed-path PATH] [--requested-by ACTOR] [--json]
  pnpm extensions activate <installId> [--actor ACTOR] [--json]
  pnpm extensions revoke <installId> --reason TEXT [--actor ACTOR] [--replaced-by ID] [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const subcommand = argv[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(arg);
  }

  return { subcommand, positional, flags };
}

async function main() {
  const dataDir = resolve(process.env["PLUTO_DATA_DIR"] ?? ".pluto");
  const store = new ExtensionStore({ dataDir });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!subcommand) usage();

  switch (subcommand) {
    case "list":
      return handleList(store, jsonMode);
    case "show":
      return handleShow(store, positional[0], jsonMode);
    case "install":
      return handleInstall(store, positional[0], flags, jsonMode);
    case "activate":
      return handleActivate(store, positional[0], flags, jsonMode);
    case "revoke":
      return handleRevoke(store, positional[0], flags, jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

async function handleList(store: ExtensionStore, jsonMode: boolean): Promise<void> {
  const installs = await store.list("installs");
  const items = installs
    .map(summarizeInstall)
    .sort((a, b) => `${a.extensionId}:${a.installId}`.localeCompare(`${b.extensionId}:${b.installId}`));

  if (jsonMode) {
    const output: ExtensionListOutputV0 = {
      schema: "pluto.extensions.list-output",
      schemaVersion: 0,
      items,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log("No extension installs found.");
    return;
  }

  console.log(`${"Install ID".padEnd(22)} ${"Extension".padEnd(28)} ${"State".padEnd(10)} Version`);
  console.log("-".repeat(80));
  for (const item of items) {
    console.log(
      `${item.installId.slice(0, 22).padEnd(22)} ${item.extensionId.slice(0, 28).padEnd(28)} ${item.state.padEnd(10)} ${item.version}`,
    );
  }
}

async function handleShow(store: ExtensionStore, installId: string | undefined, jsonMode: boolean): Promise<void> {
  if (!installId) {
    fail("Missing <installId> argument for 'show'");
  }

  const install = await store.read("installs", installId);
  if (!install) {
    fail(`Extension install not found: ${installId}`);
  }

  const item = summarizeInstall(install);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, item, record: install }, null, 2));
    return;
  }

  console.log(`Install: ${item.installId}`);
  console.log(`Extension: ${item.extensionId}`);
  console.log(`Version: ${item.version}`);
  console.log(`State: ${item.state}`);
  console.log(`Install status: ${item.status}`);
  console.log(`Lifecycle: ${item.lifecycleStatus}`);
  console.log(`Signature: ${item.signatureStatus}`);
  console.log(`Trust review: ${item.trustVerdict ?? "none"}`);
  console.log(`Provenance: ${item.provenanceSource} ${item.provenanceOrigin}`);
}

async function handleInstall(
  store: ExtensionStore,
  packageId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!packageId) {
    fail("Missing <packageId> argument for 'install'");
  }

  const pkg = await store.read("packages", packageId);
  if (!pkg) {
    fail(`Extension package not found: ${packageId}`);
  }

  const installId = asOptionalString(flags["install-id"]) ?? `${pkg.extensionId}@${pkg.version}`;
  const installedPath = asOptionalString(flags["installed-path"]) ?? `.pluto/extensions/${pkg.extensionId}/${pkg.version}`;
  const requestedBy = asOptionalString(flags["requested-by"]) ?? "operator:local";

  const install = await installExtension({
    store,
    installId,
    packageRecord: pkg,
    installedPath,
    requestedBy,
  });

  printMutation(install, jsonMode);
}

async function handleActivate(
  store: ExtensionStore,
  installId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!installId) {
    fail("Missing <installId> argument for 'activate'");
  }

  const install = await store.read("installs", installId);
  if (!install) {
    fail(`Extension install not found: ${installId}`);
  }

  const requestedCapabilities = install.manifest.capabilities.map((capability) => capability.name);
  const requestedPrivilegedCapabilities = deriveRequestedPrivilegedCapabilities(requestedCapabilities);
  const approvedPrivilegedCapabilities = new Set(install.trustReview?.privilegedCapabilities ?? []);
  const unapprovedPrivilegedCapabilities = requestedPrivilegedCapabilities.filter(
    (capability) => !approvedPrivilegedCapabilities.has(capability),
  );

  const result = await activateExtension({
    store,
    installId,
    manifest: validateExtensionManifest(install.manifest),
    requestedCapabilities,
    privilegedCapabilities: requestedPrivilegedCapabilities,
    secretBindings: install.manifest.secretNames.length === 0
      ? { state: "ready" }
      : { state: "unresolved", missing: install.manifest.secretNames.map((secret) => secret.name) },
    capabilityCompatibility: unapprovedPrivilegedCapabilities.length === 0
      ? { state: "compatible" }
      : {
        state: "incompatible",
        reasons: unapprovedPrivilegedCapabilities.map(
          (capability) => `privileged_scope_unapproved:${capability}`,
        ),
      },
    policyReconciliation: { state: "reconciled" },
    actor: asOptionalString(flags["actor"]),
  });

  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, state: result.state, reasons: result.reasons, item: summarizeInstall(result.install), record: result.install }, null, 2));
    return;
  }

  console.log(`${result.install.installId} -> ${result.state}${result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : ""}`);
}

async function handleRevoke(
  store: ExtensionStore,
  installId: string | undefined,
  flags: Record<string, string | boolean>,
  jsonMode: boolean,
): Promise<void> {
  if (!installId) {
    fail("Missing <installId> argument for 'revoke'");
  }
  const reason = asOptionalString(flags["reason"]);
  if (!reason) {
    fail("Missing required --reason for 'revoke'");
  }

  const install = await revokeExtension({
    store,
    installId,
    actor: asOptionalString(flags["actor"]),
    reason,
    replacedBy: asOptionalString(flags["replaced-by"]),
  });

  printMutation(install, jsonMode);
}

function printMutation(install: ExtensionInstallV0, jsonMode: boolean): void {
  const item = summarizeInstall(install);
  if (jsonMode) {
    console.log(JSON.stringify({ schemaVersion: 0, item, record: install }, null, 2));
    return;
  }

  console.log(`${install.installId} -> ${item.state}`);
}

function summarizeInstall(install: ExtensionInstallV0): ExtensionListItemV0 {
  return {
    installId: install.installId,
    extensionId: install.extensionId,
    version: install.version,
    state: deriveState(install),
    status: install.status,
    lifecycleStatus: install.lifecycle.status,
    packageId: install.packageId,
    installedPath: install.installedPath,
    requestedBy: install.requestedBy,
    trustVerdict: install.trustReview?.verdict ?? null,
    signatureStatus: install.signature.status,
    provenanceSource: install.signature.provenance.source,
    provenanceOrigin: install.signature.provenance.origin,
  };
}

function deriveState(install: ExtensionInstallV0): ExtensionListItemV0["state"] {
  if (install.lifecycle.status === "revoked") {
    return "revoked";
  }
  if (install.status === "blocked") {
    return "blocked";
  }
  if (install.lifecycle.status === "active") {
    return "active";
  }
  return "draft";
}

function asOptionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
