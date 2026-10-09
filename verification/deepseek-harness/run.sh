#!/usr/bin/env bash
# Keyless feasibility checks; leaves product source and personal data untouched.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
revision=5badb15009ae1756c3afe0ae0cef1faafc290ccc
probe_work="$(mktemp -d)"
probe_target=
cleanup() {
  if [[ -n "$probe_target" ]]; then rm -f "$probe_target"; fi
  rm -rf "$probe_work"
}
trap cleanup EXIT
if [[ $# -gt 0 ]]; then
  harness_root="$(cd "$1" && pwd)"
else
  harness_root="$probe_work/upstream"
  git init -q "$harness_root"
  git -C "$harness_root" remote add origin https://github.com/deepseek-ai/deepseek-harness.git
  git -C "$harness_root" fetch -q --depth 1 origin "$revision"
  git -C "$harness_root" checkout -q --detach FETCH_HEAD
fi
[[ "$(git -C "$harness_root" rev-parse HEAD)" == "$revision" ]] || {
  echo 'Use the pinned Harness revision.' >&2; exit 1;
}
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'This verification script targets Linux x86_64 with glibc.' >&2; exit 1;
}
cd "$harness_root"
pnpm --filter @deepseek-ai/dsh-agent-loop-testkit... \
  --filter @deepseek-ai/dsh-session-persistence-jsonl... \
  --filter @deepseek-ai/dsh-plugin-manager... \
  --filter @deepseek-ai/dsh-cordis-host-runner... \
  install --frozen-lockfile --ignore-scripts
# Build the upstream flock source with the exact upstream flags. The cloud
# Node binary has no adjacent headers, so use its matching official headers.
node_version="$(node -p 'process.version')"
curl -fsSL "https://nodejs.org/download/release/$node_version/node-$node_version-headers.tar.gz" \
  -o "$probe_work/headers.tar.gz"
tar -xzf "$probe_work/headers.tar.gz" -C "$probe_work"
mkdir -p native/system/packages/linux-x64/bin/glibc
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -fvisibility=hidden -DNAPI_VERSION=8 \
  -I "$probe_work/node-$node_version/include/node" -shared \
  -o "$probe_work/system.node" native/system/packages/entry/src/flock.c
mv "$probe_work/system.node" native/system/packages/linux-x64/bin/glibc/system.node
probe_file=packages/test-support/agent-loop-testkit/tests/study-agent-verification.spec.ts
[[ ! -e "$probe_file" ]] || { echo 'Verification target already exists.' >&2; exit 1; }
probe_target="$harness_root/$probe_file"
cp "$project_root/verification/deepseek-harness/study-bridge.spec.ts" "$probe_target"
STUDY_SOURCE="$project_root/study-system/app/task-memory/src" pnpm exec vitest run \
  packages/core/tools/tests/tools.spec.ts \
  packages/core/tools/tests/execution-mode.spec.ts \
  packages/core/agent-loop/tests/resume.spec.ts \
  packages/extensions/cordis-host-runner/tests/versioning.spec.ts \
  packages/boot/plugin-manager/tests/package-reload.spec.ts \
  "$probe_file" --maxWorkers 2
