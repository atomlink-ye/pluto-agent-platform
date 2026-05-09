#!/bin/bash
set -euo pipefail
TASK_ID="pluto-v2-t9-s2-wait-as-lifecycle-20260509"
WORKSPACE="/workspace"
BUNDLE_DIR="${WORKSPACE}/tasks/remote/${TASK_ID}"
WORKTREE_ROOT="${WORKSPACE}/.worktrees/${TASK_ID}"
INTEGRATION_WORKTREE="${WORKTREE_ROOT}/integration"
BRANCH="pluto/v2/t9-s2-wait-as-lifecycle"

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
bootstrap() { cd "${INTEGRATION_WORKTREE}"; timed_run "${BUNDLE_DIR}/artifacts/gate-bootstrap.txt" env NODE_ENV=development pnpm install --force; }

restore_zod_shim() {
  cd "${INTEGRATION_WORKTREE}"
  if [ ! -f packages/pluto-v2-core/node_modules/zod/package.json ]; then
    mkdir -p packages/pluto-v2-core/node_modules
    cp -RL packages/pluto-v2-runtime/node_modules/zod packages/pluto-v2-core/node_modules/zod
  fi
  ls packages/pluto-v2-core/node_modules/zod/package.json
}

gate_typecheck() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime.txt" pnpm --filter @pluto/v2-runtime typecheck
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-root.txt" pnpm exec tsc -p tsconfig.json --noEmit
}

gate_test() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-runtime.txt" pnpm --filter @pluto/v2-runtime test
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-root.txt" pnpm test
}

gate_no_kernel_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-kernel-mutation.txt"
  set +e; git diff --name-only main..HEAD -- packages/pluto-v2-core/ > "${out}" 2>&1; set -e
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
    packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts \
    packages/pluto-v2-runtime/src/evidence/ \
    packages/pluto-v2-runtime/scripts/smoke-live.ts > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then echo "FAIL: predecessor mutation"; cat "${out}"; return 1; fi
  echo "OK"; : > "${out}"
}

gate_no_verbatim_payload_prompts() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-verbatim-payload-prompts.txt"
  set +e
  grep -rnE 'must match exactly|payload must match exactly' \
    packages/pluto-v2-runtime/src/ packages/pluto-v2-runtime/__tests__/ tests/ src/ > "${out}" 2>&1
  local rc=$?; set -e
  if [ ${rc} -eq 0 ]; then echo "FAIL"; cat "${out}"; return 1; fi
  echo "OK"; : > "${out}"
}

gate_diff_hygiene() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-diff-hygiene.txt"
  local allowed_re='^(packages/pluto-v2-runtime/src/cli/pluto-tool\.ts|packages/pluto-v2-runtime/src/api/(pluto-local-api|wait-registry)\.ts|packages/pluto-v2-runtime/src/adapters/paseo/(run-paseo|agentic-tool-prompt-builder)\.ts|packages/pluto-v2-runtime/scripts/smoke-acceptance\.ts|packages/pluto-v2-runtime/__tests__/(api|cli|adapters/paseo)/|tasks/remote/pluto-v2-t9-s2-wait-as-lifecycle-20260509/)'
  set +e
  local violations
  violations="$(git diff --name-only main..HEAD | grep -vE "${allowed_re}" || true)"
  set -e
  if [ -n "${violations}" ]; then echo "FAIL"; echo "${violations}"; return 1; fi
  echo "OK"; : > "${out}"
}

commit_and_push() {
  cd "${INTEGRATION_WORKTREE}"
  local message="${1:-feat(v2): T9-S2 wait as turn lifecycle}"
  git -c user.name=pluto -c user.email=pluto@local add -A
  if git -c user.name=pluto -c user.email=pluto@local diff --cached --quiet; then
    echo "no changes"
  else
    git -c user.name=pluto -c user.email=pluto@local commit -m "${message}"
  fi
  git push origin "${BRANCH}"
  local sha; sha="$(git rev-parse HEAD)"
  printf "%s\n" "${sha}" > "${BUNDLE_DIR}/artifacts/branch-pushed-sha.txt"
  printf "branch=%s\nsha=%s\n" "${BRANCH}" "${sha}"
}

force_add_report() {
  cd "${INTEGRATION_WORKTREE}"
  local report_src="${BUNDLE_DIR}/artifacts/REPORT.md"
  local report_dst="${INTEGRATION_WORKTREE}/tasks/remote/${TASK_ID}/artifacts/REPORT.md"
  if [ ! -f "${report_src}" ]; then echo "WARN: no REPORT.md"; return 0; fi
  mkdir -p "$(dirname "${report_dst}")"
  cp "${report_src}" "${report_dst}"
  git -c user.name=pluto -c user.email=pluto@local add -f "tasks/remote/${TASK_ID}/artifacts/REPORT.md"
  git -c user.name=pluto -c user.email=pluto@local commit -m "docs(tasks): add T9-S2 report" || echo "no change"
  git push origin "${BRANCH}" || echo "WARN: push failed (auth) — operator handles locally"
}

case "${1:-}" in
  setup_repo) setup_repo ;;
  setup_worktrees) setup_worktrees ;;
  bootstrap) bootstrap ;;
  restore_zod_shim) restore_zod_shim ;;
  gate_typecheck) gate_typecheck ;;
  gate_test) gate_test ;;
  gate_no_kernel_mutation) gate_no_kernel_mutation ;;
  gate_no_predecessor_mutation) gate_no_predecessor_mutation ;;
  gate_no_verbatim_payload_prompts) gate_no_verbatim_payload_prompts ;;
  gate_diff_hygiene) gate_diff_hygiene ;;
  commit_and_push) shift; commit_and_push "${@}" ;;
  force_add_report) force_add_report ;;
  "") echo "usage: $0 <step>"; exit 0 ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
