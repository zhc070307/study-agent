"""Exercise study tools through the supported SDK entry and exact Study patch."""
import json
import os
from pathlib import Path
import selectors
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time

project = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project / 'packages/agent'))
from run import patch, runtime_command

with tempfile.TemporaryDirectory(prefix='study-profile-loop-') as directory:
    root = Path(directory)
    overlay = root / 'test.patch.json'
    overlay.write_text(json.dumps(patch(root) + [{'insert': [{'id': 'study-test-model',
        'name': str(project / 'packages/agent/tests/mock-model.ts')}]}]))
    with tempfile.TemporaryFile(mode='w+') as diagnostics:
        process = subprocess.Popen(runtime_command('--patch',str(overlay)),
            cwd=project, env=dict(os.environ, DSH_HOME=str(root / '.harness')),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostics, start_new_session=True)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        buffered = b''
        frames = []

        def send(identifier, method, params=None):
            process.stdin.write((json.dumps(dict(jsonrpc='2.0', id=identifier, method=method, params=params or {}))+'\n').encode())
            process.stdin.flush()

        def until(predicate):
            global buffered
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                while b'\n' in buffered:
                    line, buffered = buffered.split(b'\n', 1)
                    frame = json.loads(line)
                    frames.append(frame)
                    if predicate(frame):
                        return frame
                if selector.select(min(1, max(0, deadline-time.monotonic()))):
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    buffered += chunk
            diagnostics.seek(0)
            raise AssertionError((frames, diagnostics.read()))

        try:
            send(1, 'initialize', {'cwd': str(root), 'provider': 'study-test', 'model': 'mock'})
            assert 'result' in until(lambda frame: frame.get('id') == 1)
            send(2, 'session/prompt', {'sessionId': 'profile-demo', 'contentBlocks': [{'type':'text','text':'开始学习'}]})
            assert 'result' in until(lambda frame: frame.get('id') == 2)
            until(lambda frame: frame.get('method') == 'session.status' and frame['params']['status'] == 'idle'
                  and any(item.get('method') == 'session.status' and item['params']['status'] == 'running' for item in frames))
            if not (root / '.study-system/data/task_memory.sqlite3').exists():
                diagnostics.seek(0)
                raise AssertionError(diagnostics.read())
            conn = sqlite3.connect(root / '.study-system/data/task_memory.sqlite3')
            row = conn.execute('SELECT session,status,history FROM flow_runs').fetchone()
            assert row == ('profile-demo', 'open', '[]'), row
            conn.close()
            assert '学习流程已经开始' in json.dumps(frames, ensure_ascii=False)
            send(3, 'shutdown')
            reply=until(lambda frame: frame.get('id') == 3)
            diagnostics.seek(0)
            assert reply.get('result') == {},(reply,diagnostics.read())
            process.wait(timeout=15)
            assert process.returncode == 0
            print('Actual trimmed SDK profile executed Study tools and persisted progress with scripted model')
        finally:
            selector.close()
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
