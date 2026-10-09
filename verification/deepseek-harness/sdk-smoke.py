"""Check the supported SDK profile handshake, without requesting inference."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile

REVISION = "5badb15009ae1756c3afe0ae0cef1faafc290ccc"
harness_root = Path(sys.argv[1]).resolve()
assert subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=harness_root, text=True
).strip() == REVISION, "Use the pinned Harness revision"

with tempfile.TemporaryDirectory(prefix="study-sdk-") as home:
    with tempfile.TemporaryFile(mode="w+") as diagnostics:
        process = subprocess.Popen(
            ["pnpm", "dsh", "--profile", "sdk-minimal"],
            cwd=harness_root,
            env=dict(os.environ, DSH_HOME=home),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=diagnostics,
            text=True,
            start_new_session=True,
        )
        try:
            request = {
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "cwd": home, "provider": "deepseek-official",
                    "model": "deepseek-v4-flash",
                },
            }
            process.stdin.write(json.dumps(request) + "\n")
            process.stdin.flush()
            if not select.select([process.stdout], [], [], 15)[0]:
                raise TimeoutError("No initialize response within 15 seconds")
            reply = json.loads(process.stdout.readline())
            assert reply["id"] == 1
            assert reply["result"]["serverInfo"]["name"] == "deepseek-harness-sdk-runtime"
            process.stdin.write(json.dumps({
                "jsonrpc": "2.0", "id": 2, "method": "shutdown",
            }) + "\n")
            process.stdin.flush()
            remaining, _ = process.communicate(timeout=15)
            shutdown = json.loads(remaining.strip())
            assert shutdown == {"jsonrpc": "2.0", "id": 2, "result": {}}
            assert process.returncode == 0
            print("SDK initialize/shutdown passed; no model inference requested")
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
