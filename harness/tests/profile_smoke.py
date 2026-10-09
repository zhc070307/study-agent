"""Start the actual trimmed profile with isolated data; no inference or API key."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import tempfile

project = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='study-profile-') as root:
    with tempfile.TemporaryFile(mode='w+') as diagnostics:
        process = subprocess.Popen(['python3', str(project / 'harness/run.py'), '--data', root],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostics, text=True, start_new_session=True)
        try:
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                'params': {'cwd': root, 'provider': 'deepseek-official', 'model': 'deepseek-v4-flash'}})+'\n')
            process.stdin.flush()
            if not select.select([process.stdout], [], [], 20)[0]:
                diagnostics.seek(0)
                raise TimeoutError(diagnostics.read())
            reply = json.loads(process.stdout.readline())
            if 'error' in reply:
                diagnostics.seek(0)
                raise AssertionError((reply, diagnostics.read()))
            assert reply['result']['serverInfo']['name'] == 'deepseek-harness-sdk-runtime'
            process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'shutdown'})+'\n')
            process.stdin.flush()
            remaining, _ = process.communicate(timeout=15)
            assert json.loads(remaining.strip()) == {'jsonrpc': '2.0', 'id': 2, 'result': {}}
            assert process.returncode == 0
            print('Trimmed Study profile initialize/shutdown passed; no inference requested')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
