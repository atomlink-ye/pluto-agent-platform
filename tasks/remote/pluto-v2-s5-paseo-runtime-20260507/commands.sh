#!/bin/bash
# Command catalog for pluto-v2-s5-paseo-runtime-20260507.
# BINDING (S5 addition): commit_and_push runs ONLY after smoke:live exits 0
# AND fixture artifacts exist on disk.

set -euo pipefail

# === Constants ===
TASK_ID="pluto-v2-s5-paseo-runtime-20260507"
SANDBOX_ID="c8ef5890-f1d2-4f53-a76d-b6ec6ae38549"
WORKSPACE="/workspace"
BUNDLE_DIR="${WORKSPACE}/tasks/remote/${TASK_ID}"
WORKTREE_ROOT="${WORKSPACE}/.worktrees/${TASK_ID}"
INTEGRATION_WORKTREE="${WORKTREE_ROOT}/integration"
BRANCH="pluto/v2/s5-paseo-runtime-c8ef58"

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

# === Gate 1: typecheck ===
gate_package_typecheck() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-package-typecheck-core.txt" \
    pnpm --filter @pluto/v2-core typecheck
  timed_run "${BUNDLE_DIR}/artifacts/gate-package-typecheck-runtime.txt" \
    pnpm --filter @pluto/v2-runtime typecheck
}

# === Gate 2: vitest ===
gate_package_vitest() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-package-vitest-core.txt" \
    pnpm --filter @pluto/v2-core test
  timed_run "${BUNDLE_DIR}/artifacts/gate-package-vitest-runtime.txt" \
    pnpm --filter @pluto/v2-runtime test
}

# === Gate 3: build ===
gate_package_build() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-package-build-core.txt" \
    pnpm --filter @pluto/v2-core build
  timed_run "${BUNDLE_DIR}/artifacts/gate-package-build-runtime.txt" \
    pnpm --filter @pluto/v2-runtime build
}

# === Gate 4: root regression ===
gate_test_suite() {
  cd "${INTEGRATION_WORKTREE}"
  timed_run "${BUNDLE_DIR}/artifacts/gate-test-suite.txt" pnpm test
}

# === Gate 6: no-runtime-leak (paseo/opencode/claude outside paseo dir) ===
gate_no_runtime_leak() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-runtime-leak.txt"
  set +e
  # `index.ts` is the package's public re-export surface; legitimate
  # `paseo` mentions there point to the allowed adapters/paseo/ subtree.
  rg -n 'paseo|opencode|claude' packages/pluto-v2-runtime/src \
    --glob '!packages/pluto-v2-runtime/src/adapters/paseo/**' \
    --glob '!packages/pluto-v2-runtime/src/index.ts' \
    > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: no-runtime-leak grep matched"; cat "${out}"; return 1
  fi
  echo "OK: no-runtime-leak (0 matches)"
  : > "${out}"
}

# === Gate 7: no-HTTP (production source only) ===
gate_no_http() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-http.txt"
  set +e
  rg -n "from 'node:http'|from 'node:https'|fetch\(|require\('node:http'\)|require\('node:https'\)" \
    packages/pluto-v2-runtime/src \
    > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: no-HTTP grep matched"; cat "${out}"; return 1
  fi
  echo "OK: no-HTTP (0 matches in src/**)"
  : > "${out}"
}

# === Gate 8: no child_process outside paseo-cli-client.ts ===
gate_no_process_spawn_outside_cli() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-process-spawn.txt"
  set +e
  rg -n "from 'node:child_process'|require\('node:child_process'\)" \
    packages/pluto-v2-runtime/src \
    --glob '!packages/pluto-v2-runtime/src/adapters/paseo/paseo-cli-client.ts' \
    > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: child_process imported outside paseo-cli-client.ts"; cat "${out}"; return 1
  fi
  echo "OK: no-process-spawn-outside-cli-client (0 matches)"
  : > "${out}"
}

# === Gate 9: no ambient randomness/time ===
gate_no_ambient_randomness() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-ambient-randomness.txt"
  set +e
  rg -n 'crypto\.randomUUID|Math\.random|Date\.now|new Date\(|performance\.now' \
    packages/pluto-v2-runtime/src \
    > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: ambient randomness/time matched"; cat "${out}"; return 1
  fi
  echo "OK: no-ambient-randomness (0 matches)"
  : > "${out}"
}

# === Gate 10: no S2/S3/S4 mutation ===
gate_no_s2_s3_s4_mutation() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-no-s234-mutation.txt"
  git fetch origin main >/dev/null 2>&1 || true
  set +e
  git diff --name-only main..HEAD -- \
    packages/pluto-v2-core/ \
    packages/pluto-v2-runtime/src/runtime/ \
    packages/pluto-v2-runtime/src/loader/ \
    packages/pluto-v2-runtime/src/evidence/ \
    packages/pluto-v2-runtime/src/legacy/ \
    packages/pluto-v2-runtime/src/adapters/fake/ \
    > "${out}" 2>&1
  set -e
  if [ -s "${out}" ]; then
    echo "FAIL: S2/S3/S4 surface mutated"; cat "${out}"; return 1
  fi
  echo "OK: no S2/S3/S4 mutation"
  : > "${out}"
}

# === Gate 5: live smoke (R8 — runs ONCE) ===
gate_smoke_live() {
  cd "${INTEGRATION_WORKTREE}"
  local out="${BUNDLE_DIR}/artifacts/gate-smoke-live.txt"
  timed_run "${out}" pnpm smoke:live
  local rc=$?
  if [ ${rc} -ne 0 ]; then
    echo "FAIL: smoke:live exit ${rc}"
    return 1
  fi
  # Verify fixture exists
  local last_run_dir
  last_run_dir="$(ls -1dt tests/fixtures/live-smoke/*/ 2>/dev/null | head -1)"
  if [ -z "${last_run_dir}" ] || [ ! -f "${last_run_dir}/events.jsonl" ] || \
     [ ! -f "${last_run_dir}/evidence-packet.json" ] || \
     [ ! -f "${last_run_dir}/usage-summary.json" ]; then
    echo "FAIL: smoke:live did not produce a complete fixture"
    ls -la tests/fixtures/live-smoke/ 2>&1 | head
    return 1
  fi
  echo "OK: smoke:live captured fixture at ${last_run_dir}"
  echo "${last_run_dir}" > "${BUNDLE_DIR}/artifacts/live-smoke-fixture-path.txt"
}

# === Step: commit_and_push (S5 BINDING — only after smoke:live succeeds) ===
commit_and_push() {
  cd "${INTEGRATION_WORKTREE}"
  # Verify smoke:live artifact exists before committing.
  if [ ! -f "${BUNDLE_DIR}/artifacts/live-smoke-fixture-path.txt" ]; then
    echo "FAIL: commit_and_push refused; live-smoke fixture path missing"
    return 1
  fi
  local message="${1:-feat(v2): S5 Paseo runtime adapter + bounded live smoke (gates green at $(date -Iseconds))}"
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
  python3 - <<PY > "${BUNDLE_DIR}/artifacts/manifest.json"
import hashlib, json, os, subprocess
root = "${INTEGRATION_WORKTREE}"
diff = subprocess.check_output(["git", "-C", root, "diff", "--name-only", "main..origin/${BRANCH}"]).decode().splitlines()
files = []
for rel in diff:
    full = os.path.join(root, rel)
    if not os.path.exists(full):
        files.append({"path": rel, "deleted": True})
        continue
    with open(full, "rb") as fh:
        data = fh.read()
    files.append({"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
head = subprocess.check_output(["git", "-C", root, "rev-parse", "origin/${BRANCH}"]).decode().strip()
print(json.dumps({"branchHead": head, "branch": "${BRANCH}", "files": files}, indent=2))
PY
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
  gate_package_typecheck) gate_package_typecheck ;;
  gate_package_vitest) gate_package_vitest ;;
  gate_package_build) gate_package_build ;;
  gate_test_suite) gate_test_suite ;;
  gate_no_runtime_leak) gate_no_runtime_leak ;;
  gate_no_http) gate_no_http ;;
  gate_no_process_spawn_outside_cli) gate_no_process_spawn_outside_cli ;;
  gate_no_ambient_randomness) gate_no_ambient_randomness ;;
  gate_no_s2_s3_s4_mutation) gate_no_s2_s3_s4_mutation ;;
  gate_smoke_live) gate_smoke_live ;;
  commit_and_push) shift; commit_and_push "${@}" ;;
  artifact_pack) artifact_pack ;;
  verify_pushed_state) verify_pushed_state ;;
  "") echo "usage: $0 <step>"; echo "steps: setup_repo, setup_worktrees, bootstrap, gate_package_typecheck, gate_package_vitest, gate_package_build, gate_test_suite, gate_no_runtime_leak, gate_no_http, gate_no_process_spawn_outside_cli, gate_no_ambient_randomness, gate_no_s2_s3_s4_mutation, gate_smoke_live, commit_and_push, artifact_pack, verify_pushed_state"; exit 0 ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
