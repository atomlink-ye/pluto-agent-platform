#!/bin/bash
# Command catalog for pluto-v2-s7-archive-legacy-20260508.
# BINDING: commit_and_push runs IMMEDIATELY after gates pass, BEFORE
# the self-review loop. Self-review reads diff from origin.

set -euo pipefail

# === Constants ===
TASK_ID="pluto-v2-s7-archive-legacy-20260508"
SANDBOX_ID="c8ef5890-f1d2-4f53-a76d-b6ec6ae38549"
WORKSPACE="/workspace"
BUNDLE_DIR="${WORKSPACE}/tasks/remote/${TASK_ID}"
WORKTREE_ROOT="${WORKSPACE}/.worktrees/${TASK_ID}"
INTEGRATION_WORKTREE="${WORKTREE_ROOT}/integration"
BRANCH="pluto/v2/s7-archive-legacy-c8ef58"
LEGACY_BRANCH="legacy-v1.6-harness-prototype"

# === Helper: timed_run ===
timed_run() {
  local out="$1"; shift
  local started; started="$(date -Iseconds)"
  local t0; t0="$(date +%s)"
  set +e
  timeout 1200 "$@" >"${out}" 2>&1
  local rc=$?
  set -e
  local t1; t1="$(date +%s)"
  local dur=$((t1 - t0))
  printf "# started: %s\n# duration: %ss\n# exit: %s\n" "${started}" "${dur}" "${rc}" \
    > "${out}.hdr"
  cat "${out}.hdr" "${out}" > "${out}.tmp" && mv "${out}.tmp" "${out}"
  rm -f "${out}.hdr"
  return ${rc}
}

# === Step: setup_repo ===
setup_repo() {
  if [ ! -d "${WORKSPACE}/.git" ]; then
    git clone https://github.com/atomlink-ye/pluto-agent-platform.git "${WORKSPACE}"
  fi
  cd "${WORKSPACE}"
  git fetch --all --prune
  git checkout main
  git pull --ff-only origin main
}

# === Step: setup_worktrees ===
setup_worktrees() {
  cd "${WORKSPACE}"
  mkdir -p "${WORKTREE_ROOT}"
  if ! git worktree list | grep -q "${INTEGRATION_WORKTREE}"; then
    git worktree add -b "${BRANCH}" "${INTEGRATION_WORKTREE}" main
  fi
}

# === Step: bootstrap ===
bootstrap() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-bootstrap.txt" pnpm install
}

# === Step: preflight_legacy_branch ===
# Captures the current SHA of legacy-v1.6-harness-prototype on origin
# BEFORE any deletion happens. HARD gate.
preflight_legacy_branch() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/legacy-branch-sha-pre.txt"
  git ls-remote origin "refs/heads/${LEGACY_BRANCH}" > "${out}"
  if [ ! -s "${out}" ]; then
    echo "FAIL: legacy branch ${LEGACY_BRANCH} not found on origin"
    return 1
  fi
  echo "OK: legacy branch SHA recorded:"
  cat "${out}"
}

# === Step: lane0_inventory ===
# Generates the binding inventory artifact BEFORE any deletion lands.
# Mechanism: tsc --listFiles -p tsconfig.json (root) to enumerate
# files reachable from the retained-entrypoint set; cross-check vs
# package.json scripts and Vitest include patterns.
#
# Output: tasks/remote/.../artifacts/v1.6-inventory.md with three
# sections: KEEP / DELETE / REWRITE.
lane0_inventory() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/v1.6-inventory.md"
  local listfiles="${BUNDLE_DIR}/artifacts/lane0-tsc-listfiles.txt"
  local all_src="${BUNDLE_DIR}/artifacts/lane0-all-src-files.txt"
  local pkgjson="${BUNDLE_DIR}/artifacts/lane0-package-json-scripts.txt"
  local vitest="${BUNDLE_DIR}/artifacts/lane0-vitest-include.txt"

  # 1) tsc --listFiles from root tsconfig (captures everything the
  # retained CLI surface reaches transitively, including v2 packages
  # and v1.6 surface that's still imported by retained code).
  set +e
  pnpm exec tsc -p tsconfig.json --listFiles --noEmit > "${listfiles}" 2>&1
  set -e

  # 2) Enumerate every file under the relevant top-level dirs.
  : > "${all_src}"
  for d in src tests scripts docker scenarios playbooks run-profiles agents evals; do
    if [ -d "${d}" ]; then
      git ls-files -- "${d}" >> "${all_src}"
    fi
  done

  # 3) Capture package.json scripts and vitest include patterns for
  # cross-check.
  cat package.json | grep -A 200 '"scripts"' | head -200 > "${pkgjson}" || true
  cat vitest.config.ts > "${vitest}" 2>&1 || true

  # 4) Render the human-readable inventory. The implementation
  # leaves are responsible for filling in the KEEP/DELETE/REWRITE
  # labels by cross-referencing listfiles + binding deletion list
  # in acceptance.md section C.
  cat > "${out}" <<'INVENTORY'
# v1.6 Inventory — pluto-v2-s7-archive-legacy-20260508

Mechanism: `tsc --listFiles -p tsconfig.json` (root) +
`git ls-files` enumeration of `src/ tests/ scripts/ docker/
scenarios/ playbooks/ run-profiles/ agents/ evals/` + cross-check
against `package.json` scripts and `vitest.config.ts` include
patterns.

Raw inputs:

- `lane0-tsc-listfiles.txt` — every file reachable from the root
  tsconfig.
- `lane0-all-src-files.txt` — every file under the candidate
  top-level dirs.
- `lane0-package-json-scripts.txt` — root package.json scripts.
- `lane0-vitest-include.txt` — vitest include patterns.

## Retained-entrypoint set (binding)

- src/cli/run.ts (post-surgery, v2-only)
- src/cli/v2-cli-bridge.ts
- src/cli/v2-cli-bridge-error.ts
- src/cli/shared/flags.ts
- src/cli/shared/run-selection.ts (post-surgery; may be deleted)
- packages/pluto-v2-core/**
- packages/pluto-v2-runtime/**
- tests/fixtures/live-smoke/86557df1-... (data)
- tsconfig.json, tsconfig.build.json, vitest.config.ts,
  pnpm-workspace.yaml, root package.json
- v2-only retained tests:
  - tests/cli/run-runtime-v2-default.test.ts
  - tests/cli/run-exit-code-2-v2.test.ts
  - tests/cli/run-runtime-precedence.test.ts (REWRITE)
  - tests/cli/run-unsupported-scenario.test.ts (REWRITE)
  - tests/cli/run-v1-flag-archived.test.ts (NEW)

## KEEP

<implementation leaf fills in: every file reachable from retained
entrypoints; every doc/config under the retained set>

## DELETE

<implementation leaf fills in: every file from the binding
deletion list in acceptance.md section C; plus any v1.6-only
file unreachable from retained entrypoints>

## REWRITE

<implementation leaf fills in: src/cli/run.ts (surgery);
src/cli/shared/flags.ts (surgery); tests/cli/run-runtime-
precedence.test.ts (rewrite); tests/cli/run-unsupported-
scenario.test.ts (rewrite); 9 doc files (sweep); package.json
(script removals)>

## Counts

- Pre-S7 total files in candidate dirs: <fill>
- KEEP: <fill>
- DELETE: <fill>
- REWRITE: <fill>
- Post-S7 total files in candidate dirs: <fill>

## Test count target (post-S7)

- pnpm --filter @pluto/v2-core test: ≥ 186 (UNTOUCHED).
- pnpm --filter @pluto/v2-runtime test: ≥ 65 (UNTOUCHED).
- pnpm test (root): <enumerated by inventory>.

INVENTORY

  echo "OK: lane 0 inventory scaffold written to ${out}"
  echo "Implementation leaf MUST fill in KEEP/DELETE/REWRITE sections"
  echo "and counts, then commit BEFORE deletion lands."
}

# === Gate: typecheck ===
gate_typecheck() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-core.txt" \
    pnpm --filter @pluto/v2-core typecheck
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime.txt" \
    pnpm --filter @pluto/v2-runtime typecheck
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-root.txt" \
    pnpm exec tsc -p tsconfig.json --noEmit
}

# === Gate: tests ===
gate_test() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-core.txt" \
    pnpm --filter @pluto/v2-core test
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-runtime.txt" \
    pnpm --filter @pluto/v2-runtime test
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-root.txt" pnpm test
}

# === Gate: build ===
gate_build() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-build-core.txt" \
    pnpm --filter @pluto/v2-core build
  timed_run "${BUNDLE_DIR}/artifacts/gate-build-runtime.txt" \
    pnpm --filter @pluto/v2-runtime build
}

# === Gate: no packages mutation ===
gate_no_packages_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-packages-mutation.txt"
  git fetch origin main >/dev/null 2>&1 || true
  set +e
  git diff --name-only main..HEAD -- packages/ > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: packages/ mutated"; cat "${out}"; return 1
  fi
  echo "OK: no packages/ mutation"
  : > "${out}"
}

# === Gate: no parity-fixture mutation ===
gate_no_parity_fixture_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-parity-fixture-mutation.txt"
  set +e
  git diff --name-only main..HEAD -- 'tests/fixtures/live-smoke/86557df1-*' > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: parity fixture mutated"; cat "${out}"; return 1
  fi
  echo "OK: parity fixture untouched"
  : > "${out}"
}

# === Gate: legacy-branch post check ===
gate_legacy_branch_post_check() {
  cd "${INTEGRATION_WORKTREE}"
  local pre="${BUNDLE_DIR}/artifacts/legacy-branch-sha-pre.txt"
  local post="${BUNDLE_DIR}/artifacts/legacy-branch-sha-post.txt"
  if [ ! -s "${pre}" ]; then
    echo "FAIL: pre-flight SHA missing; preflight_legacy_branch must run first"
    return 1
  fi
  git ls-remote origin "refs/heads/${LEGACY_BRANCH}" > "${post}"
  if [ ! -s "${post}" ]; then
    echo "FAIL: legacy branch missing post-merge"
    return 1
  fi
  local pre_sha post_sha
  pre_sha="$(awk '{print $1}' "${pre}")"
  post_sha="$(awk '{print $1}' "${post}")"
  if [ "${pre_sha}" != "${post_sha}" ]; then
    echo "FAIL: legacy branch SHA changed (pre=${pre_sha} post=${post_sha})"
    return 1
  fi
  echo "OK: legacy branch SHA stable: ${post_sha}"
}

# === Step: commit_and_push ===
commit_and_push() {
  cd "${INTEGRATION_WORKTREE}"
  local message="${1:-feat(v2): S7 archive legacy v1.6 mainline runtime — final slice (gates green at $(date -Iseconds))}"
  git -c user.name=pluto -c user.email=pluto@local add -A
  if git -c user.name=pluto -c user.email=pluto@local diff --cached --quiet; then
    echo "commit_and_push: no staged changes; skipping commit"
  else
    git -c user.name=pluto -c user.email=pluto@local commit -m "${message}"
  fi
  git push origin "${BRANCH}"
  local sha; sha="$(git rev-parse HEAD)"
  printf "%s\n" "${sha}" > "${BUNDLE_DIR}/artifacts/branch-pushed-sha.txt"
  printf "branch=%s\nsha=%s\n" "${BRANCH}" "${sha}"
}

# === Step: artifact_pack ===
artifact_pack() {
  cd "${INTEGRATION_WORKTREE}"
  git fetch origin "${BRANCH}"
  git format-patch --stdout main..origin/"${BRANCH}" > "${BUNDLE_DIR}/artifacts/diff.patch"
  git diff --stat main..origin/"${BRANCH}" > "${BUNDLE_DIR}/artifacts/diff-stat.txt"
  git rev-parse origin/"${BRANCH}" > "${BUNDLE_DIR}/artifacts/branch-head.txt"
}

# === Step: verify_pushed_state ===
verify_pushed_state() {
  cd "${INTEGRATION_WORKTREE}"
  git fetch origin "${BRANCH}"
  local local_sha origin_sha recorded_sha porcelain
  local_sha="$(git rev-parse HEAD)"
  origin_sha="$(git rev-parse origin/${BRANCH})"
  recorded_sha="$(cat ${BUNDLE_DIR}/artifacts/branch-pushed-sha.txt 2>/dev/null || echo missing)"
  porcelain="$(git status --porcelain)"
  printf "local=%s\norigin=%s\nrecorded=%s\nporcelain=%s\n" \
    "${local_sha}" "${origin_sha}" "${recorded_sha}" "${porcelain}"
  if [ "${local_sha}" != "${origin_sha}" ]; then echo "FAIL: local != origin"; return 1; fi
  if [ "${origin_sha}" != "${recorded_sha}" ]; then echo "FAIL: origin != recorded"; return 1; fi
  if [ -n "${porcelain}" ]; then echo "FAIL: porcelain not empty"; return 1; fi
  echo "OK: pushed state verified"
}

case "${1:-}" in
  setup_repo) setup_repo ;;
  setup_worktrees) setup_worktrees ;;
  bootstrap) bootstrap ;;
  preflight_legacy_branch) preflight_legacy_branch ;;
  lane0_inventory) lane0_inventory ;;
  gate_typecheck) gate_typecheck ;;
  gate_test) gate_test ;;
  gate_build) gate_build ;;
  gate_no_packages_mutation) gate_no_packages_mutation ;;
  gate_no_parity_fixture_mutation) gate_no_parity_fixture_mutation ;;
  gate_legacy_branch_post_check) gate_legacy_branch_post_check ;;
  commit_and_push) shift; commit_and_push "${@}" ;;
  artifact_pack) artifact_pack ;;
  verify_pushed_state) verify_pushed_state ;;
  "") echo "usage: $0 <step>"; echo "steps: setup_repo, setup_worktrees, bootstrap, preflight_legacy_branch, lane0_inventory, gate_typecheck, gate_test, gate_build, gate_no_packages_mutation, gate_no_parity_fixture_mutation, gate_legacy_branch_post_check, commit_and_push, artifact_pack, verify_pushed_state"; exit 0 ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
