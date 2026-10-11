import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from web import Runtime, create_server


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = Runtime(self.root)
        self.runtime.active = 'desktop'
        self.runtime.status = 'running'

    def tearDown(self):
        self.temp.cleanup()

    def stream(self, frame, channel='desktop'):
        self.runtime.notification({'method':'session.stream', 'params':{
            'sessionId':'desktop-'+channel, 'frame':frame}})

    def test_partial_reply_settles_once_and_excludes_private_chunks(self):
        self.stream({'type':'start', 'attemptId':'attempt-1'})
        self.stream({'type':'chunk', 'attemptId':'attempt-1', 'chunk':{'type':'text-delta','index':0,'text':'你好'}})
        self.stream({'type':'chunk', 'attemptId':'attempt-1', 'chunk':{'type':'reasoning-delta','index':1,'text':'private'}})
        self.stream({'type':'chunk', 'attemptId':'attempt-1', 'chunk':{'type':'tool-call-delta','index':2,'argumentsDelta':'secret'}})
        view = self.runtime.conversation()
        self.assertEqual(view['runtime']['live']['text'], '你好')
        self.assertEqual(view['messages'], {})
        self.assertNotIn('private', json.dumps(view))
        message = {'id':'reply-1','content':[{'type':'text','text':'你好，世界'}]}
        event = {'method':'session.event','params':{'sessionId':'desktop-desktop','event':{
            'type':'assistant/message','data':{'message':message}}}}
        self.runtime.notification(event)
        self.runtime.notification(event)
        self.stream({'type':'end','attemptId':'attempt-1'})
        settled = self.runtime.conversation()
        self.assertIsNone(settled['runtime']['live'])
        self.assertEqual(len(settled['messages']['desktop']), 1)
        self.assertEqual(settled['messages']['desktop'][0]['text'], '你好，世界')
        self.assertGreater(settled['runtime']['revision'], view['runtime']['revision'])

    def test_retries_channels_and_stop_do_not_leak_or_leave_a_live_reply(self):
        self.stream({'type':'start','attemptId':'attempt-1'})
        self.stream({'type':'chunk','attemptId':'attempt-1','chunk':{'type':'text-delta','text':'old'}})
        self.stream({'type':'start','attemptId':'other'}, channel='another-file')
        self.stream({'type':'end','attemptId':'attempt-1','outcome':{'kind':'abandoned'}})
        self.stream({'type':'start','attemptId':'attempt-2'})
        self.stream({'type':'chunk','attemptId':'attempt-1','chunk':{'type':'text-delta','text':'stale'}})
        self.stream({'type':'chunk','attemptId':'attempt-2','chunk':{'type':'text-delta','text':'new'}})
        self.assertEqual(self.runtime.conversation()['runtime']['live']['text'], 'new')
        self.runtime.stop()
        self.assertIsNone(self.runtime.conversation()['runtime']['live'])
        self.assertEqual(self.runtime.status, 'idle')
        self.stream({'type':'start','attemptId':'late'})
        self.assertIsNone(self.runtime.conversation()['runtime']['live'])

    def test_saved_settings_survive_restart_and_semester_change(self):
        with patch.dict(os.environ, {}, clear=True):
            server = create_server(self.root)
            try:
                self.assertFalse(server.settings.status()['configured'])
                server.settings.save({'api_key':'test-saved-key'})
                listing = server.semesters.load()
                server.semesters.change('create', {'name':'Next','expected':listing['version']})
            finally:
                server.server_close()
        with patch.dict(os.environ, {}, clear=True):
            restarted = create_server(self.root)
            try:
                self.assertTrue(restarted.settings.status()['configured'])
                self.assertNotIn('test-saved-key', json.dumps(restarted.settings.status()))
                self.assertEqual(os.environ['DEEPSEEK_API_KEY'], 'test-saved-key')
            finally:
                restarted.server_close()


if __name__ == '__main__':
    unittest.main()
