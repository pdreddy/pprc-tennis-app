#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# The cloud image keeps Node here. Workstations use their installed Node 22.
if [ -x /workspace/.tools/node-v22.23.3-linux-x64/bin/node ]; then
  export PATH="/workspace/.tools/node-v22.23.3-linux-x64/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node 22 is required. Install Node 22, reopen Terminal, and run ./pprc.sh setup." >&2
  exit 1
fi
exec node scripts/events/local.mjs "$@"
