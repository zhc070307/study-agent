"""Native device gates and real authenticated host transport, with scripted recognition."""
import base64
import hashlib
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'transcription'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import device
from host import Service,Handler
from transcription import Transcription
from transcription_fixture import install_fixture
from workspace import Workspace

class HostTransportTests(unittest.TestCase):
    def test_authenticated_background_transfer_result_and_stop_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);tool=Transcription(root/'workspace');install_fixture(tool)
            service=Service(tool.shared);service.python=tool.python
            (service.root/'installed.json').write_text(json.dumps({'runtime':service.version()}))
            service.resources=lambda:{'eligible':True,'backend':'mps','gpu_required':True,'name':'Scripted GPU','message':'fixture','required_disk_gib':10,'required_memory_gib':8}
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.service=service;server.token='test-token';server.daemon_threads=True
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            config=root/'config.json';config.write_text(json.dumps({'url':f'http://127.0.0.1:{server.server_port}','token':server.token}))
            store=Workspace(tool.root)
            try:
                with self.assertRaises(urllib.error.HTTPError) as rejected:urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/status')
                self.assertEqual(rejected.exception.code,401)
                with patch.dict(os.environ,{'STUDY_TRANSCRIBE_CONFIG':str(config),'STUDY_TRANSCRIBE_CPU':'0'}):
                    self.assertEqual(tool.resources()['backend'],'mps')
                    audio=store.perform('create',{'name':'录音.wav','mime':'audio/wav','data':base64.b64encode(b'fixture').decode()})
                    args={'file':audio['id'],'expected':audio['sha256']}
                    job=tool.start(args)
                    time.sleep(0.15);tool.stop({'job':job['id']})
                    for unused in range(100):
                        if tool.records()[0]['status']!='running' and service.active is None:break
                        time.sleep(.05)
                    job=tool.start(args)
                    for unused in range(100):
                        record=tool.records()[0]
                        if record['status']!='running':break
                        time.sleep(.05)
                    self.assertEqual(record['status'],'completed',record)
                    self.assertIn('脚本化',store.perform('read',{'file':record['transcript']})['text'])
                    # Malformed transfer is rejected, never used as a source.
                    with self.assertRaises(RuntimeError):tool.host_request('/jobs/'+'a'*32,data=b'bad',headers={'X-Attempt':'b'*32,'X-Source-SHA256':hashlib.sha256(b'other').hexdigest(),'X-File-Name':'audio.wav'.encode().hex()})
            finally:store.close();service.stop(service.active);server.shutdown();server.server_close();thread.join()
