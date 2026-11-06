#!/usr/bin/env bash
set -euo pipefail
host=${1:?Usage: scripts/deploy-ssh.sh USER@HOST [PORT]}
port=${2:-4800}
[[ "$host" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid SSH destination' >&2; exit 1; }
[[ "$port" =~ ^[0-9]+$ ]] && ((port>=1024 && port<=65535)) || { echo 'Use a port from 1024 to 65535' >&2; exit 1; }
cd "$(dirname "$0")/.."
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit the reviewed source before deploying; deployment uses the exact HEAD commit.' >&2; exit 1; }
revision=$(git rev-parse HEAD)
release="screens/releases/$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}"
ssh "$host" "docker version >/dev/null && docker compose version && mkdir -p '$release'"
git archive HEAD | ssh "$host" "tar -xf - -C '$release'"
ssh "$host" bash -s -- "$release" "$port" "$revision" <<'REMOTE'
set -euo pipefail
cd "$1"
export SCREENS_PORT="$2"
compose=(docker compose --project-name screens --file compose.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait
"${compose[@]}" exec -T screens node scripts/smoke-deployment.mjs write
"${compose[@]}" restart
"${compose[@]}" up -d --wait
"${compose[@]}" exec -T screens node scripts/smoke-deployment.mjs read
"${compose[@]}" ps
printf 'Deployed revision: %s\nRelease directory: %s\n' "$3" "$PWD"
REMOTE
printf 'Open a tunnel on a free local port matching the service port:\nssh -N -L %s:127.0.0.1:%s %s\nThen open http://localhost:%s\n' "$port" "$port" "$host" "$port"
