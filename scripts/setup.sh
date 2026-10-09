#!/usr/bin/env bash
# Cloud verification prerequisites, Linux x86_64/glibc. No personal data.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
git -C "$project_root" submodule update --init vendor/deepseek-harness
harness_root="$project_root/vendor/deepseek-harness"
[[ "$(git -C "$harness_root" rev-parse HEAD)" == 5badb15009ae1756c3afe0ae0cef1faafc290ccc ]]
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'This setup targets Linux x86_64/glibc.' >&2; exit 1;
}
cd "$harness_root"
# The source launcher imports a broad CLI graph; the unused document preview
# package requires a separately hosted SheetJS tarball unavailable here.
pnpm --filter '*' --filter '!@deepseek-ai/dsh-client-ui-sidebar-documentpreview' install --frozen-lockfile --ignore-scripts
headers_work="$(mktemp -d)"
trap 'rm -rf "$headers_work"' EXIT
node_version="$(node -p 'process.version')"
curl -fsSL "https://nodejs.org/download/release/$node_version/node-$node_version-headers.tar.gz" -o "$headers_work/headers.tar.gz"
tar -xzf "$headers_work/headers.tar.gz" -C "$headers_work"
mkdir -p native/system/packages/linux-x64/bin/glibc
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -fvisibility=hidden -DNAPI_VERSION=8 \
  -I "$headers_work/node-$node_version/include/node" -shared \
  -o "$headers_work/system.node" native/system/packages/entry/src/flock.c
mv "$headers_work/system.node" native/system/packages/linux-x64/bin/glibc/system.node
