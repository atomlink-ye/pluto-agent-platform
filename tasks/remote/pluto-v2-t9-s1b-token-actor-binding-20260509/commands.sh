#!/bin/bash
set -euo pipefail
TASK_ID="pluto-v2-t9-s1b-token-actor-binding-20260509"
WORKSPACE="/workspace"
BUNDLE_DIR="${WORKSPACE}/tasks/remote/${TASK_ID}"
WORKTREE_ROOT="${WORKSPACE}/.worktrees/${TASK_ID}"
INTEGRATION_WORKTREE="${WORKTREE_ROOT}/integration"
BRANCH="pluto/v2/t9-s1b-token-actor-binding"

# OOM discipline (from T9-S4):
# If typecheck exits 137 ("Killed" / cgroup OOM-killer) or 134 ("FATAL ERROR: ...heap..."):
#   - Record exit code in artifact and continue.
#   - Do NOT retry with NODE_OPTIONS=--max-old-space-size (raises Node ceiling
#     closer to cgroup limit; OOM happens sooner).
#   - Do NOT invoke ./node_modules/.bin/tsc directly (bash wrapper, not Node-loadable).

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

# Sync bundle into worktree so REPORT path is unambiguous.
# After this step, the agent writes REPORT to the worktree-side
# path, which is what gets committed.
sync_bundle_into_worktree() {
  cd "${INTEGRATION_WORKTREE}"
  mkdir -p "tasks/remote/${TASK_ID}/artifacts"
  cp -f "${BUNDLE_DIR}/prompt.md" "tasks/remote/${TASK_ID}/prompt.md" 2>/dev/null || true
  cp -f "${BUNDLE_DIR}/commands.sh" "tasks/remote/${TASK_ID}/commands.sh" 2>/dev/null || true
  ls "tasks/remote/${TASK_ID}/"
}

# Fast-path typecheck (T9-S4): src-only runtime + root.
gate_typecheck() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime-src.txt" \
    pnpm --filter @pluto/v2-runtime typecheck:src
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-root.txt" \
    pnpm exec tsc -p tsconfig.json --noEmit
}

gate_typecheck_full() {
  gate_typecheck
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime-test.txt" \
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

gate_no_predecessor_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-predecessor-mutation.txt"
  set +e
  git diff --name-only main..HEAD -- \
    packages/pluto-v2-runtime/src/tools/ \
    packages/pluto-v2-runtime/src/mcp/ \
    packages/pluto-v2-runtime/src/adapters/paseo/wakeup-delta.ts \
    packages/pluto-v2-runtime/src/adapters/paseo/task-closeout.ts \
    packages/pluto-v2-runtime/src/adapters/paseo/bridge-self-check.ts \
    packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts \
    packages/pluto-v2-runtime/src/api/wait-registry.ts \
    packages/pluto-v2-runtime/src/api/composite-tools.ts \
    packages/pluto-v2-runtime/src/evidence/ \
    packages/pluto-v2-runtime/scripts/ > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then echo "FAIL: predecessor mutation"; cat "${out}"; return 1; fi
  echo "OK"; : > "${out}"
}

gate_no_verbatim_payload_prompts() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-verbatim-payload-prompts.txt"
  set +e
  grep -rnE 'must match exactly|payload must match exactly' \
    packages/pluto-v2-runtime/src/ packages/pluto-v2-runtime/__tests__/ src/ > "${out}" 2>&1
  local rc=$?; set -e
  if [ ${rc} -eq 0 ]; then echo "FAIL"; cat "${out}"; return 1; fi
  echo "OK"; : > "${out}"
}

gate_diff_hygiene() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-diff-hygiene.txt"
  local allowed_re='^(packages/pluto-v2-runtime/src/adapters/paseo/(run-paseo|actor-bridge)\.ts|packages/pluto-v2-runtime/src/api/pluto-local-api\.ts|packages/pluto-v2-runtime/src/cli/pluto-tool\.ts|packages/pluto-v2-runtime/__tests__/(api|adapters/paseo|cli)/|tasks/remote/pluto-v2-t9-s1b-token-actor-binding-20260509/)'
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
  sync_bundle_into_worktree) sync_bundle_into_worktree ;;
  gate_typecheck) gate_typecheck ;;
  gate_typecheck_full) gate_typecheck_full ;;
  gate_test) gate_test ;;
  gate_no_kernel_mutation) gate_no_kernel_mutation ;;
  gate_no_predecessor_mutation) gate_no_predecessor_mutation ;;
  gate_no_verbatim_payload_prompts) gate_no_verbatim_payload_prompts ;;
  gate_diff_hygiene) gate_diff_hygiene ;;
  "") echo "usage: $0 <step>"; exit 0 ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
