#!/usr/bin/env bash
# Prepare this project's adopted runtime; no upstream checkout or submodule.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'This setup targets Linux x86_64/glibc.' >&2; exit 1;
}
cd "$project_root"
python3 scripts/doctor.py --before-setup
pnpm install --frozen-lockfile --ignore-scripts
node packages/runtime/modules/subprocess/subprocess-local/scripts/ensure-spawn-helper.mjs
headers_work="$(mktemp -d)"
trap 'rm -rf "$headers_work"' EXIT
node_version="$(node -p 'process.version')"
curl -fsSL "https://nodejs.org/download/release/$node_version/node-$node_version-headers.tar.gz" -o "$headers_work/headers.tar.gz"
tar -xzf "$headers_work/headers.tar.gz" -C "$headers_work"
binary_dir=packages/runtime/native/system/packages/linux-x64/bin/glibc
mkdir -p "$binary_dir"
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -fvisibility=hidden -DNAPI_VERSION=8 \
  -I "$headers_work/node-$node_version/include/node" -shared \
  -o "$headers_work/system.node" packages/runtime/native/system/packages/entry/src/flock.c
mv "$headers_work/system.node" "$binary_dir/system.node"
python3 scripts/doctor.py
