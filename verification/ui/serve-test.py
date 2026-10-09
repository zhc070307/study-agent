"""Start only a temporary web workspace with a scripted SDK adapter for browser tests."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/agent'))
from web import create_server, PROJECT
server=create_server(sys.argv[1],port=int(sys.argv[2]) if len(sys.argv)>2 else 0,provider='study-web-test',model='mock',extra_patch=[{'insert':[{'id':'web-test-model','name':str(PROJECT/'packages/agent/tests/web-model.ts')}]}])
print(server.server_port,flush=True)
import signal
signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.runtime.stop();server.server_close()
