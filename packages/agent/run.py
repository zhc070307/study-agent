"""Launch Study Agent through its adopted, self-contained runtime."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

PROJECT = Path(__file__).resolve().parents[2]
RUNTIME = PROJECT / 'packages/runtime'

def runtime_command(*args):
    return ['node','--import','tsx/esm',str(RUNTIME/'launcher/main.ts'),*args]


def patch(data):
    # This project's composition already contains only the retained producers.
    return [
        {'id': 'system-prompt', 'config': {'includeHarnessIdentity': False,
          'includeRuntimeContext': False, 'personaPrefix': '你是学习助手。'}},
        {'id': 'sandbox-policy', 'config': {'mode': 'danger-full-access', 'workspaceRoot': str(data)}},
        {'insert': [{'id': 'attachment-local', 'name': '@deepseek-ai/dsh-attachment-local'}, {'id': 'study', 'name': str(PROJECT / 'packages/agent/study.ts'), 'config': {'data': str(data)}}]},
    ]


def main():
    parser = argparse.ArgumentParser(prog='study-agent', description='学习助手的统一运行入口')
    parser.add_argument('--data', type=Path, default=PROJECT / '.data')
    parser.add_argument('--dump-config', action='store_true')
    args = parser.parse_args()
    data = args.data.resolve()
    data.mkdir(parents=True, exist_ok=True)
    runtime_env = dict(os.environ, DSH_HOME=str(data / '.harness'))
    with tempfile.TemporaryDirectory(prefix='study-profile-') as directory:
        overlay = Path(directory) / 'study.patch.json'
        overlay.write_text(json.dumps(patch(data)), encoding='utf-8')
        command = runtime_command('--patch', str(overlay))
        if args.dump_config:
            command.append('--dump-config')
        return subprocess.call(command, cwd=PROJECT, env=runtime_env)


if __name__ == '__main__':
    raise SystemExit(main())
