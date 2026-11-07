#!/usr/bin/env bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  brew install node
  export PATH="$(brew --prefix node)/bin:$PATH"
fi
exec node "$(cd "$(dirname "$0")" && pwd)/scripts/setup.mjs" "$@"
