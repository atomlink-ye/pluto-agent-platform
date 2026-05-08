#!/bin/bash
# Command catalog for pluto-v2-t1-spec-prompt-view-runtdir-20260508.
# BINDING: commit_and_push runs IMMEDIATELY after gates pass, BEFORE
# the self-review loop. Self-review reads diff from origin.

set -euo pipefail

TASK_ID="pluto-v2-t1-spec-prompt-view-runtdir-20260508"
SANDBOX_ID="c8ef5890-f1d2-4f53-a76d-b6ec6ae38549"
WORKSPACE="/workspace"
BUNDLE_DIR="${WORKSPACE}/tasks/remote/${TASK_ID}"
WORKTREE_ROOT="${WORKSPACE}/.worktrees/${TASK_ID}"
INTEGRATION_WORKTREE="${WORKTREE_ROOT}/integration"
BRANCH="pluto/v2/t1-spec-prompt-view-runtdir-c8ef58"

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

setup_repo() {
  if [ ! -d "${WORKSPACE}/.git" ]; then
    git clone https://github.com/atomlink-ye/pluto-agent-platform.git "${WORKSPACE}"
  fi
  cd "${WORKSPACE}"
  git fetch --all --prune
  git checkout main
  git pull --ff-only origin main
}

setup_worktrees() {
  cd "${WORKSPACE}"
  mkdir -p "${WORKTREE_ROOT}"
  if ! git worktree list | grep -q "${INTEGRATION_WORKTREE}"; then
    git worktree add -b "${BRANCH}" "${INTEGRATION_WORKTREE}" main
  fi
}

bootstrap() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-bootstrap.txt" pnpm install
}

gate_typecheck() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-core.txt" \
    pnpm --filter @pluto/v2-core typecheck
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-runtime.txt" \
    pnpm --filter @pluto/v2-runtime typecheck
  timed_run "${BUNDLE_DIR}/artifacts/gate-typecheck-root.txt" \
    pnpm exec tsc -p tsconfig.json --noEmit
}

gate_test() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-core.txt" \
    pnpm --filter @pluto/v2-core test
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-runtime.txt" \
    pnpm --filter @pluto/v2-runtime test
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-root.txt" pnpm test
}

gate_build() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-build-core.txt" \
    pnpm --filter @pluto/v2-core build
  timed_run "${BUNDLE_DIR}/artifacts/gate-build-runtime.txt" \
    pnpm --filter @pluto/v2-runtime build
}

gate_no_kernel_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-kernel-mutation.txt"
  set +e
  git diff --name-only main..HEAD -- \
    packages/pluto-v2-core/src/protocol-request.ts \
    packages/pluto-v2-core/src/run-event.ts \
    packages/pluto-v2-core/src/core/authority.ts \
    packages/pluto-v2-core/src/core/run-kernel.ts \
    packages/pluto-v2-core/src/projections/ > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: kernel surface mutated"; cat "${out}"; return 1
  fi
  echo "OK: no kernel mutation"
  : > "${out}"
}

gate_no_paseo_adapter_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-paseo-adapter-mutation.txt"
  set +e
  git diff --name-only main..HEAD -- \
    packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts \
    packages/pluto-v2-runtime/src/adapters/paseo/paseo-directive.ts > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: paseo-adapter or paseo-directive mutated (T2 territory)"; cat "${out}"; return 1
  fi
  echo "OK: no paseo-adapter/directive mutation"
  : > "${out}"
}

gate_no_smoke_live_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-smoke-live-mutation.txt"
  set +e
  git diff --name-only main..HEAD -- \
    packages/pluto-v2-runtime/scripts/smoke-live.ts > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: smoke-live mutated (T3 territory)"; cat "${out}"; return 1
  fi
  echo "OK: no smoke-live mutation"
  : > "${out}"
}

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

commit_and_push() {
  cd "${INTEGRATION_WORKTREE}"
  local message="${1:-feat(v2): T1 spec + prompt-view + CLI run-dir + usage-status (gates green at $(date -Iseconds))}"
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

artifact_pack() {
  cd "${INTEGRATION_WORKTREE}"
  git fetch origin "${BRANCH}"
  git format-patch --stdout main..origin/"${BRANCH}" > "${BUNDLE_DIR}/artifacts/diff.patch"
  git diff --stat main..origin/"${BRANCH}" > "${BUNDLE_DIR}/artifacts/diff-stat.txt"
  git rev-parse origin/"${BRANCH}" > "${BUNDLE_DIR}/artifacts/branch-head.txt"
}

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
  gate_typecheck) gate_typecheck ;;
  gate_test) gate_test ;;
  gate_build) gate_build ;;
  gate_no_kernel_mutation) gate_no_kernel_mutation ;;
  gate_no_paseo_adapter_mutation) gate_no_paseo_adapter_mutation ;;
  gate_no_smoke_live_mutation) gate_no_smoke_live_mutation ;;
  gate_no_parity_fixture_mutation) gate_no_parity_fixture_mutation ;;
  commit_and_push) shift; commit_and_push "${@}" ;;
  artifact_pack) artifact_pack ;;
  verify_pushed_state) verify_pushed_state ;;
  "") echo "usage: $0 <step>"; echo "steps: setup_repo, setup_worktrees, bootstrap, gate_typecheck, gate_test, gate_build, gate_no_kernel_mutation, gate_no_paseo_adapter_mutation, gate_no_smoke_live_mutation, gate_no_parity_fixture_mutation, commit_and_push, artifact_pack, verify_pushed_state"; exit 0 ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
