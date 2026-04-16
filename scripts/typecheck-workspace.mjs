#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"

const WORKSPACE_PACKAGES = [
  { name: "@pluto-agent-platform/contracts", pathPrefix: "packages/contracts/" },
  { name: "@pluto-agent-platform/paseo", pathPrefix: "packages/paseo/" },
  { name: "@pluto-agent-platform/control-plane", pathPrefix: "packages/control-plane/" },
  { name: "@pluto-agent-platform/server", pathPrefix: "packages/server/" },
  { name: "@pluto-agent-platform/app", pathPrefix: "packages/app/" },
  { name: "@pluto-agent-platform/cli", pathPrefix: "packages/cli/" },
]

const SHARED_INPUTS = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.base.json",
])
const BUILD_BACKED_TYPECHECK_PACKAGES = new Set([
  "@pluto-agent-platform/contracts",
  "@pluto-agent-platform/paseo",
  "@pluto-agent-platform/control-plane",
  "@pluto-agent-platform/server",
  "@pluto-agent-platform/cli",
])

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch (error) {
    if (allowFailure) {
      return null
    }
    throw error
  }
}

function parseLines(output) {
  if (!output) return []
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function resolveBaseSha() {
  const directCandidates = [
    process.env.TYPECHECK_BASE_SHA,
    process.env.GITHUB_BASE_SHA,
  ].filter(Boolean)

  for (const candidate of directCandidates) {
    const resolved = runGit(["rev-parse", "--verify", `${candidate}^{commit}`], { allowFailure: true })
    if (resolved) {
      return resolved
    }
  }

  const refCandidates = [
    process.env.TYPECHECK_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    process.env.GITHUB_BASE_REF,
    "origin/main",
    "main",
  ].filter(Boolean)

  for (const candidate of refCandidates) {
    const resolved = runGit(["rev-parse", "--verify", `${candidate}^{commit}`], { allowFailure: true })
    if (resolved) {
      const mergeBase = runGit(["merge-base", "HEAD", resolved], { allowFailure: true })
      if (mergeBase) {
        return mergeBase
      }
    }
  }

  return null
}

function collectChangedFiles() {
  const changedFiles = new Set()
  const baseSha = resolveBaseSha()

  if (baseSha) {
    for (const file of parseLines(runGit(["diff", "--name-only", `${baseSha}...HEAD`], { allowFailure: true }))) {
      changedFiles.add(file)
    }
  }

  for (const file of parseLines(runGit(["diff", "--name-only"], { allowFailure: true }))) {
    changedFiles.add(file)
  }

  for (const file of parseLines(runGit(["diff", "--name-only", "--cached"], { allowFailure: true }))) {
    changedFiles.add(file)
  }

  for (const file of parseLines(runGit(["ls-files", "--others", "--exclude-standard"], { allowFailure: true }))) {
    changedFiles.add(file)
  }

  return {
    baseSha,
    changedFiles: [...changedFiles].sort(),
  }
}

function shouldCheckPackage(pkg, changedFiles, baseSha) {
  if (!baseSha) {
    return {
      include: true,
      reason: "No comparable git base found; including package for safety.",
    }
  }

  const relevantChange = changedFiles.find((file) => {
    return file.startsWith(pkg.pathPrefix) || SHARED_INPUTS.has(file)
  })

  if (!relevantChange) {
    return {
      include: false,
      reason: `No changes detected in ${pkg.pathPrefix} or shared TypeScript inputs.`,
    }
  }

  return {
    include: true,
    reason: `Relevant change detected: ${relevantChange}`,
  }
}

function getPackagesToCheck() {
  const { baseSha, changedFiles } = collectChangedFiles()
  const decisions = WORKSPACE_PACKAGES.map((pkg) => ({
    ...pkg,
    decision: shouldCheckPackage(pkg, changedFiles, baseSha),
  }))
  const packages = decisions.filter((pkg) => pkg.decision.include).map((pkg) => pkg.name)

  return {
    baseSha,
    changedFiles,
    packages,
    decisions,
  }
}

function getPackageCommand(packageName, mode) {
  if (mode === "build") {
    return "build"
  }

  return BUILD_BACKED_TYPECHECK_PACKAGES.has(packageName) ? "build" : "typecheck"
}

function runPackageCommand(packageName, mode) {
  const command = getPackageCommand(packageName, mode)
  const result = spawnSync("pnpm", ["--filter", packageName, command], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function main() {
  const printPlanOnly = process.argv.includes("--print-plan")
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="))
  const mode = modeArg?.split("=")[1] ?? "typecheck"
  const { baseSha, changedFiles, packages, decisions } = getPackagesToCheck()

  if (mode !== "typecheck" && mode !== "build") {
    throw new Error(`Unsupported mode: ${mode}`)
  }

  console.log(`[typecheck] Mode: ${mode}`)
  console.log(`[typecheck] Base: ${baseSha ?? "unavailable"}`)
  for (const pkg of decisions) {
    console.log(`[typecheck] ${pkg.name}: ${pkg.decision.include ? "included" : "skipped"} — ${pkg.decision.reason}`)
  }
  console.log(`[typecheck] Packages: ${packages.join(", ")}`)

  if (changedFiles.length > 0) {
    console.log(`[typecheck] Changed files (${changedFiles.length}):`)
    for (const file of changedFiles) {
      console.log(`  - ${file}`)
    }
  } else {
    console.log("[typecheck] No changed files detected.")
  }

  if (printPlanOnly) {
    return
  }

  for (const packageName of packages) {
    console.log(`\n[typecheck] Running ${packageName} (${getPackageCommand(packageName, mode)})`)
    runPackageCommand(packageName, mode)
  }
}

main()
