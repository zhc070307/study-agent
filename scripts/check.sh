#!/usr/bin/env bash
# Uses only temporary learning data and scripted model responses.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$project_root/verification/runtime/check-source.py"
cd "$project_root/packages/learning"
PYTHONPATH=src python3 -m unittest discover -s tests -t . -q
cd "$project_root"
python3 -m unittest discover -s packages/agent/tests -q
python3 -m unittest discover -s verification/transcription -p test_device.py -q
python3 packages/agent/tests/profile_smoke.py
python3 packages/agent/tests/profile_loop.py
python3 packages/agent/tests/profile_restart.py
bridge_file=packages/runtime/modules/test-support/agent-loop-testkit/tests/study-agent-verification.spec.ts
integration_file=packages/runtime/modules/test-support/agent-loop-testkit/tests/study-integration.spec.ts
[[ ! -e "$bridge_file" && ! -e "$integration_file" ]] || {
  echo 'Verification target already exists.' >&2; exit 1;
}
trap 'rm -f "$bridge_file" "$integration_file"' EXIT
cp "$project_root/verification/runtime/study-bridge.spec.ts" "$bridge_file"
cp "$project_root/packages/agent/tests/integration.spec.ts" "$integration_file"
STUDY_PROJECT="$project_root" STUDY_SOURCE="$project_root/packages/learning/src" pnpm exec vitest run --maxWorkers 2
