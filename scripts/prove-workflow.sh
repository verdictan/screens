#!/usr/bin/env bash
# No GitHub API, Actions, credentials, published ports or existing volumes needed.
set -euo pipefail
cd "$(dirname "$0")/.."
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
hash_file() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d ' ' -f 1
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
source_files=(Dockerfile Dockerfile.proof .dockerignore compose.yaml compose.proof.yaml
  package.json package-lock.json vite.config.mjs jsconfig.json components.json
  playwright.config.mjs README.md src ui skills scripts test examples)

if [[ ${1:-} != --local ]]; then
  [[ $# -le 1 ]] || { echo 'Usage: bash scripts/prove-workflow.sh [USER@HOST]' >&2; exit 2; }
  destination=${1:-}
  [[ -z "$destination" || "$destination" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$ ]] || {
    echo 'Invalid SSH destination' >&2; exit 2;
  }
  mkdir -p test-results
  archive=$(mktemp "${TMPDIR:-/tmp}/screens-proof.XXXXXX")
  trap 'rm -f "$archive"' EXIT
  COPYFILE_DISABLE=1 tar -czf "$archive" "${source_files[@]}"
  source_hash=$(hash_file "$archive")
  if [[ -z "$destination" ]]; then
    bash scripts/prove-workflow.sh --local "$run_id" "$source_hash"
    exit $?
  fi
  release="screens/proofs/$run_id"
  ssh "$destination" "docker version >/dev/null && docker compose version && mkdir -p '$release'"
  scp "$archive" "$destination:$release/source.tar.gz"
  result=0
  ssh "$destination" bash -s -- "$release" "$run_id" "$source_hash" <<'REMOTE' || result=$?
set -euo pipefail
cd "$1"
actual=$(sha256sum source.tar.gz | cut -d ' ' -f 1)
[[ "$actual" == "$3" ]] || { echo 'Source archive checksum mismatch' >&2; exit 1; }
tar -xzf source.tar.gz
bash scripts/prove-workflow.sh --local "$2" "$3"
REMOTE
  # Copy diagnostics back on failure as well as success. A failed copy is a failure.
  scp -r "$destination:$release/test-results/docker-proof-$run_id" test-results/ || result=1
  printf 'Proof artifacts: %s/test-results/docker-proof-%s\n' "$PWD" "$run_id"
  exit "$result"
fi

[[ $# == 3 && "$2" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ && "$3" =~ ^[a-f0-9]{64}$ ]] || {
  echo 'Invalid internal proof invocation' >&2; exit 2;
}
run_id=$2
source_hash=$3
project="screens-proof-$(printf '%s' "$run_id" | tr '[:upper:]' '[:lower:]')"
output="$PWD/test-results/docker-proof-$run_id"
[[ ! -e "$output" ]] || { echo 'Proof output already exists' >&2; exit 1; }
mkdir -p "$output"
printf '%s\n' "$source_hash" > "$output/source-archive.sha256"
runner="$project-runner"
compose=(docker compose --project-name "$project" --file compose.proof.yaml)
collect() {
  result=$?
  trap - EXIT
  set +e
  "${compose[@]}" logs --no-color > "$output/containers.log" 2>&1
  if docker container inspect "$runner" >/dev/null 2>&1; then
    docker cp "$runner:/app/test-results/." "$output/" || result=1
  fi
  docker rm -f "$runner" >/dev/null 2>&1
  # Only this unique proof project's disposable volume is removed.
  "${compose[@]}" down --volumes --remove-orphans >> "$output/containers.log" 2>&1 || result=1
  if (( result != 0 )); then
    printf '{"status":"failed","exitCode":%s,"detail":"Read runner.log and browser reports; no end-to-end pass was established."}\n' "$result" > "$output/summary.json"
  fi
  printf 'Proof artifacts: %s\n' "$output"
  exit "$result"
}
trap collect EXIT
run_proof() {
docker version
docker compose version
"${compose[@]}" config --quiet
"${compose[@]}" build
"${compose[@]}" up -d --wait registry
registry=$("${compose[@]}" ps -q registry)
docker inspect --format '{{json .Image}}' "$registry" > "$output/production-image.json"
"${compose[@]}" run -d --no-deps --name "$runner" proof
docker inspect --format '{{json .Image}}' "$runner" > "$output/proof-image.json"
docker exec "$runner" node scripts/proof-phase.mjs workflow
docker exec "$runner" node scripts/proof-phase.mjs deployment
"${compose[@]}" exec -T registry node scripts/smoke-deployment.mjs write
"${compose[@]}" restart registry
"${compose[@]}" up -d --wait registry
"${compose[@]}" exec -T registry node scripts/smoke-deployment.mjs read
docker exec "$runner" node scripts/proof-phase.mjs restart
docker exec -e "SCREENS_PROOF_SOURCE_HASH=$source_hash" "$runner" node scripts/proof-phase.mjs summarize
}
run_proof 2>&1 | tee "$output/runner.log"
