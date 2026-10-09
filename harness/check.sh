#!/usr/bin/env bash
# Uses only temporary learning data and scripted model responses.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root/study-system/app/task-memory"
PYTHONPATH=src python3 -m unittest discover -s tests -t . -q
cd "$project_root"
python3 -m unittest discover -s harness/tests -q
python3 harness/tests/profile_smoke.py
python3 harness/tests/profile_loop.py
cd "$project_root/vendor/deepseek-harness"
bridge_file=packages/test-support/agent-loop-testkit/tests/study-agent-verification.spec.ts
integration_file=packages/test-support/agent-loop-testkit/tests/study-integration.spec.ts
[[ ! -e "$bridge_file" && ! -e "$integration_file" ]] || {
  echo 'Verification target already exists.' >&2; exit 1;
}
trap 'rm -f "$bridge_file" "$integration_file"' EXIT
cp "$project_root/verification/deepseek-harness/study-bridge.spec.ts" "$bridge_file"
cp "$project_root/harness/tests/integration.spec.ts" "$integration_file"
STUDY_PROJECT="$project_root" STUDY_SOURCE="$project_root/study-system/app/task-memory/src" pnpm exec vitest run \
  packages/core/tools/tests/tools.spec.ts \
  packages/core/tools/tests/execution-mode.spec.ts \
  packages/core/agent-loop/tests/resume.spec.ts \
  packages/extensions/cordis-host-runner/tests/versioning.spec.ts \
  packages/boot/plugin-manager/tests/package-reload.spec.ts \
  "$bridge_file" "$integration_file" --maxWorkers 2
