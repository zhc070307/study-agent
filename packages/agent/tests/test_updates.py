"""Updates must not terminate work, and shutdown must lock out new work."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from web import create_server


class UpdateReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = create_server(Path(self.temp.name))
        self.server.close_token = 'private-close-token'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = 'http://127.0.0.1:' + str(self.server.server_address[1])

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(2)
        self.server.server_close()
        self.temp.cleanup()

    def call(self, route, value=None):
        data = json.dumps(value).encode() if value is not None else None
        request = Request(self.origin + route, data=data, headers={'Content-Type':'application/json'})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_model_file_operations_and_transcription_block_update(self):
        self.assertEqual(self.call('/api/update-ready'), (200, {'ready':True}))
        self.server.runtime.status = 'running'
        self.assertFalse(self.call('/api/update-ready')[1]['ready'])
        self.assertEqual(self.call('/api/app-close', {'token':'private-close-token','require_idle':True})[0],409)
        self.server.runtime.status = 'idle'
        with self.server.lifecycle_lock:
            self.server.pending_operations += 1
        try:
            self.assertFalse(self.call('/api/update-ready')[1]['ready'])
            self.assertEqual(self.call('/api/app-close', {'token':'private-close-token','require_idle':True})[0],409)
        finally:
            with self.server.lifecycle_lock:
                self.server.pending_operations -= 1
        with patch('web.Transcription.records',return_value=[{'status':'running'}]):
            self.assertFalse(self.call('/api/update-ready')[1]['ready'])
            self.assertEqual(self.call('/api/app-close', {'token':'private-close-token','require_idle':True})[0],409)
        self.assertFalse(getattr(self.server,'closing',False))
        self.assertTrue(self.call('/api/update-ready')[1]['ready'])

    def test_shutdown_requires_token_and_stops_accepting_work(self):
        self.assertNotEqual(self.call('/api/app-close', {'token':'wrong','require_idle':True})[0],200)
        status,reply=self.call('/api/app-close', {'token':'private-close-token','require_idle':True})
        self.assertEqual(status,200)
        self.assertTrue(reply['closing'])
        self.assertTrue(self.server.closing)


if __name__ == '__main__':
    unittest.main()
