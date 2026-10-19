#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Cloud image adapter. Normal workstations can use their own Node 22 + pnpm.
pprc_node_dir=/workspace/.tools/node-v22.23.3-linux-x64
if [ ! -x "$pprc_node_dir/bin/node" ]; then
  if [ -e "$pprc_node_dir" ]; then echo "Refusing to overwrite an existing Node directory" >&2; exit 1; fi
  pprc_download_dir=$(mktemp -d)
  trap 'rm -rf "$pprc_download_dir"' EXIT
  curl -fsSL --max-time 120 https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz -o "$pprc_download_dir/node.tar.xz"
  printf '%s  %s\n' df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de "$pprc_download_dir/node.tar.xz" | sha256sum --check -
  mkdir -p /workspace/.tools
  tar -xJf "$pprc_download_dir/node.tar.xz" -C /workspace/.tools
fi
pprc_pnpm_cli=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs
if [ ! -e "$pprc_node_dir/bin/pnpm" ]; then
  test -f "$pprc_pnpm_cli"
  ln -s "$pprc_pnpm_cli" "$pprc_node_dir/bin/pnpm"
fi
export PATH="$pprc_node_dir/bin:$PATH"
export npm_config_devdir=/workspace/.cache/node-gyp
pnpm install --frozen-lockfile --store-dir /workspace/.cache/pnpm
pnpm events:typecheck
pnpm events:lint
pnpm events:test
pnpm events:build
