"""Launch the trimmed Study profile through the upstream dsh entry point."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

PROJECT = Path(__file__).resolve().parents[1]
UPSTREAM = PROJECT / 'vendor/deepseek-harness'
REVISION = '5badb15009ae1756c3afe0ae0cef1faafc290ccc'


def patch(data):
    # Keep the supported minimal SDK kernel; remove unused feature producers.
    return [
        {'id': identifier, 'disabled': True}
        for identifier in ('session-title', 'mcp-resources', 'jobs',
                           'plugin-package-inventory-deepseek', 'terminal-pwsh', 'persistent-pwsh')
    ] + [
        {'id': 'system-prompt', 'config': {'includeHarnessIdentity': False,
          'includeRuntimeContext': False, 'personaPrefix': '你是学习助手。'}},
        {'id': 'sandbox-policy', 'config': {'mode': 'danger-full-access', 'workspaceRoot': str(data)}},
        {'insert': [{'id': 'attachment-local', 'name': '@deepseek-ai/dsh-attachment-local'}, {'id': 'study', 'name': str(PROJECT / 'harness/study.ts'), 'config': {'data': str(data)}}]},
    ]


def main():
    parser = argparse.ArgumentParser(prog='study-agent', description='学习助手的统一运行入口')
    parser.add_argument('--data', type=Path, default=PROJECT / '.data')
    parser.add_argument('--dump-config', action='store_true')
    args = parser.parse_args()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=UPSTREAM, text=True).strip()
    if revision != REVISION:
        raise SystemExit('Harness version differs from the verified revision')
    data = args.data.resolve()
    data.mkdir(parents=True, exist_ok=True)
    runtime_env = dict(os.environ, DSH_HOME=str(data / '.harness'))
    with tempfile.TemporaryDirectory(prefix='study-profile-') as directory:
        overlay = Path(directory) / 'study.patch.json'
        overlay.write_text(json.dumps(patch(data)), encoding='utf-8')
        command = ['pnpm', 'dsh', '--profile', 'sdk-minimal', '--patch', str(overlay)]
        if args.dump_config:
            command.append('--dump-config')
        return subprocess.call(command, cwd=UPSTREAM, env=runtime_env)


if __name__ == '__main__':
    raise SystemExit(main())
