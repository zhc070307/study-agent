"""Real SDK processes, temporary history, restart/model changes and fail-closed recovery."""
import json
import sys
import tempfile
import time
import uuid
from pathlib import Path

project = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(project / 'packages/agent'))
from web import Runtime


def make(root, model='first'):
    return Runtime(root, provider='study-restart-test', model=model,
                   extra_patch=[{'insert': [{'id': 'restart-test-model',
                       'name': str(project / 'packages/agent/tests/restart-model.ts')}]}])


def ask(runtime, request, channel='desktop'):
    identifier = uuid.uuid4().hex
    runtime.prompt(dict(id=identifier, channel=channel, text=json.dumps(request)))
    deadline = time.monotonic() + 25
    with runtime.updates:
        while runtime.status == 'running' and time.monotonic() < deadline:
            runtime.updates.wait(timeout=min(1, max(0, deadline-time.monotonic())))
    assert runtime.status == 'idle', 'Turn did not settle'
    assert not runtime.error, runtime.error
    messages = runtime.conversation()['messages'][channel]
    assert messages[-1]['role'] == 'assistant'
    return messages[-1]['text']


with tempfile.TemporaryDirectory(prefix='study-session-restart-') as directory:
    root = Path(directory)
    runtimes = []
    try:
        first = make(root)
        runtimes.append(first)
        assert '已记住' in ask(first, {'remember': 'restart-proof'})
        first.kill()
        second = make(root, 'second')
        runtimes.append(second)
        assert 'second' in ask(second, {'continue': 'restart-proof', 'expectModel': 'second'})
        assert '已恢复' in ask(second, {'continue': 'restart-proof', 'expectModel': 'second'})
        # A second writer must fail without replacing the original durable log.
        logs = list(root.rglob('*.jsonl'))
        original = {path: path.read_bytes() for path in logs}
        contender = make(root, 'third')
        runtimes.append(contender)
        try:
            contender.prompt(dict(id=uuid.uuid4().hex, text=json.dumps({'continue': 'restart-proof'})))
            raise AssertionError('Second writer unexpectedly acquired the session')
        except RuntimeError as error:
            assert '云端模型配置' not in str(error)
            assert 'owned' in str(error.__cause__), str(error.__cause__)
        contender.kill()
        assert all(path.read_bytes().startswith(content) for path, content in original.items()), [(path.name, len(content), path.stat().st_size) for path,content in original.items() if not path.read_bytes().startswith(content)]
        assert '已恢复' in ask(second, {'continue': 'restart-proof', 'expectModel': 'second'})
        # A stopped or crashed process releases ownership; current options still apply.
        second.stop()
        second.model = 'third'
        assert 'third' in ask(second, {'continue': 'restart-proof', 'expectModel': 'third'})
        second.process.kill()
        second.process.wait(timeout=5)
        second.kill()
        third = make(root, 'fourth')
        runtimes.append(third)
        assert 'fourth' in ask(third, {'continue': 'restart-proof', 'expectModel': 'fourth'})
        third.kill()
        # A damaged header is never reinterpreted as an absent session.
        log = next(path for path in root.rglob('*.jsonl') if b'desktop-desktop' in path.read_bytes().split(b'\n', 1)[0])
        content = log.read_bytes()
        corrupted = b'broken-header\n' + content.split(b'\n', 1)[1]
        log.write_bytes(corrupted)
        damaged = make(root)
        runtimes.append(damaged)
        try:
            damaged.prompt(dict(id=uuid.uuid4().hex, text=json.dumps({'continue': 'restart-proof'})))
            raise AssertionError('Damaged session unexpectedly resumed')
        except RuntimeError as error:
            assert '云端模型配置' not in str(error)
        assert log.read_bytes() == corrupted
        print('SDK restart passed: history/current model, same-process followup, stop, crashed writer, occupied and corrupt history preserved. Scripted model only.')
    finally:
        for runtime in runtimes:
            runtime.kill()
