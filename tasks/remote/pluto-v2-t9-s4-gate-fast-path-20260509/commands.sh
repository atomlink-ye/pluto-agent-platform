#!/bin/bash
set -euo pipefail
TASK_ID="pluto-v2-t9-s4-gate-fast-path-20260509"
WORKSPACE="/workspace"
BUNDLE_DIR="${WORKSPACE}/tasks/remote/${TASK_ID}"
WORKTREE_ROOT="${WORKSPACE}/.worktrees/${TASK_ID}"
INTEGRATION_WORKTREE="${WORKTREE_ROOT}/integration"
BRANCH="pluto/v2/t9-s4-gate-fast-path"

# OOM discipline:
# If a typecheck step exits 137 ("Killed" / sandbox cgroup OOM-killer)
# or aborts with a fatal Node heap OOM (typically exit 134):
#   - Record the exit code in the gate artifact and stop that step.
#   - Do NOT retry with NODE_OPTIONS=--max-old-space-size. Bigger Node
#     heap moves the process closer to the cgroup ceiling and triggers
#     OOM-killer sooner, not later.
#   - Do NOT invoke ./node_modules/.bin/tsc directly — that is a bash
#     wrapper, not a Node-loadable script.
#   - Document the harness limit in REPORT and continue with other gates.

timed_run() {
  local out="$1"; shift
  local started; started="$(date -Iseconds)"; local t0; t0="$(date +%s)"
  set +e; timeout 1800 "$@" >"${out}" 2>&1; local rc=$?; set -e
  local t1; t1="$(date +%s)"; local dur=$((t1 - t0))
  printf "# started: %s\n# duration: %ss\n# exit: %s\n" "${started}" "${dur}" "${rc}" > "${out}.hdr"
  cat "${out}.hdr" "${out}" > "${out}.tmp" && mv "${out}.tmp" "${out}"
  rm -f "${out}.hdr"
  return ${rc}
}

timed_run_allow_oom() {
  local out="$1"; shift
  set +e; timed_run "${out}" "$@"; local rc=$?; set -e
  if [ ${rc} -eq 134 ] || [ ${rc} -eq 137 ]; then
    return 0
  fi
  return ${rc}
}

setup_repo() { cd "${WORKSPACE}"; git fetch --all --prune; git checkout main; git pull --ff-only origin main; }
setup_worktrees() { cd "${WORKSPACE}"; mkdir -p "${WORKTREE_ROOT}"; if ! git worktree list | grep -q "${INTEGRATION_WORKTREE}"; then git worktree add -b "${BRANCH}" "${INTEGRATION_WORKTREE}" main; fi }
bootstrap() { cd "${INTEGRATION_WORKTREE}"; mkdir -p "${BUNDLE_DIR}/artifacts"; timed_run "${BUNDLE_DIR}/artifacts/gate-bootstrap.txt" env NODE_ENV=development pnpm install --force; }

restore_zod_shim() {
  cd "${INTEGRATION_WORKTREE}"
  if [ ! -f packages/pluto-v2-core/node_modules/zod/package.json ]; then
    mkdir -p packages/pluto-v2-core/node_modules
    cp -RL packages/pluto-v2-runtime/node_modules/zod packages/pluto-v2-core/node_modules/zod
  fi
  ls packages/pluto-v2-core/node_modules/zod/package.json
}

# Build v2-core's declarations once so the runtime project reference resolves.
build_v2_core() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-build-v2-core.txt" \
    pnpm --filter @pluto/v2-core exec tsc -p tsconfig.json
}

# Fast-path typecheck: src-only runtime + root only. Default Node heap.
gate_typecheck() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run_allow_oom "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime-src.txt" \
    pnpm --filter @pluto/v2-runtime typecheck:src
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-root.txt" \
    pnpm exec tsc -p tsconfig.json --noEmit
}

# Full typecheck including __tests__/. Slower; only run at validation gates.
gate_typecheck_full() {
  gate_typecheck
  cd "${INTEGRATION_WORKTREE}"
  timed_run_allow_oom "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime-test.txt" \
    pnpm --filter @pluto/v2-runtime typecheck:test
}

gate_test() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-runtime.txt" pnpm --filter @pluto/v2-runtime test
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-root.txt" pnpm test
}

gate_no_kernel_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-kernel-mutation.txt"
  set +e; git diff --name-only main..HEAD -- packages/pluto-v2-core/src/ > "${out}" 2>&1; set -e
  if [ -s "${out}" ]; then echo "FAIL"; cat "${out}"; return 1; fi
  echo "OK"; : > "${out}"
}

gate_no_source_changes() {
  # T9-S4 must not modify any .ts source under runtime/src or __tests__/.
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-source-changes.txt"
  set +e
  git diff --name-only main..HEAD -- \
    packages/pluto-v2-runtime/src/ \
    packages/pluto-v2-runtime/__tests__/ \
    packages/pluto-v2-core/src/ > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then echo "FAIL: source changed (T9-S4 is build-only)"; cat "${out}"; return 1; fi
  echo "OK"; : > "${out}"
}

gate_diff_hygiene() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-diff-hygiene.txt"
  local allowed_re='^(packages/pluto-v2-core/tsconfig(\.test)?\.json|packages/pluto-v2-runtime/tsconfig(\.src|\.test)?\.json|packages/pluto-v2-runtime/package\.json|\.gitignore|docs/notes/t9-context-packet\.md|tasks/remote/pluto-v2-t9-s4-gate-fast-path-20260509/)'
  set +e
  local violations
  violations="$(git diff --name-only main..HEAD | grep -vE "${allowed_re}" || true)"
  set -e
  if [ -n "${violations}" ]; then echo "FAIL"; echo "${violations}"; return 1; fi
  echo "OK"; : > "${out}"
}

case "${1:-}" in
  setup_repo) setup_repo ;;
  setup_worktrees) setup_worktrees ;;
  bootstrap) bootstrap ;;
  restore_zod_shim) restore_zod_shim ;;
  build_v2_core) build_v2_core ;;
  gate_typecheck) gate_typecheck ;;
  gate_typecheck_full) gate_typecheck_full ;;
  gate_test) gate_test ;;
  gate_no_kernel_mutation) gate_no_kernel_mutation ;;
  gate_no_source_changes) gate_no_source_changes ;;
  gate_diff_hygiene) gate_diff_hygiene ;;
  "") echo "usage: $0 <step>"; exit 0 ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
