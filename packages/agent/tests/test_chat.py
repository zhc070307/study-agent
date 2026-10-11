import json
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from web import Runtime, create_server


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = Runtime(self.root)
        self.runtime.active = 'desktop'
        self.runtime.status = 'running'
        self.runtime.active_turn = 'test-turn'

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

    def test_submission_timeout_stops_the_process_before_accepting_another_turn(self):
        self.runtime.active = None
        self.runtime.active_turn = None
        self.runtime.status = 'idle'
        process = Mock()
        process.poll.return_value = None
        process.stdin = io.StringIO()
        self.runtime.process = process
        self.runtime.REQUEST_TIMEOUT = .01
        def stop_process():
            self.runtime.process = None
        with patch.object(self.runtime, 'start'), patch.object(self.runtime, 'kill', side_effect=stop_process) as stop:
            with self.assertRaisesRegex(RuntimeError, '超时'):
                self.runtime.prompt({'id': 'timeout', 'text': '保持原问题'})
            stop.assert_called_once()
        self.assertEqual(self.runtime.status, 'idle')
        self.assertIsNone(self.runtime.active)
        self.assertEqual(self.runtime.pending, {})
        self.stream({'type': 'start', 'attemptId': 'late-after-timeout'})
        self.stream({'type': 'chunk', 'attemptId': 'late-after-timeout', 'chunk': {'type': 'text-delta', 'text': '迟到回复'}})
        self.assertIsNone(self.runtime.conversation()['runtime']['live'])
        with self.runtime.store() as store:
            self.assertEqual(store.conn.execute("SELECT status FROM desktop_turns WHERE id='timeout'").fetchone()[0], 'error')
        self.assertNotIn('云端模型配置', self.runtime.error)

    def test_second_submission_is_refused_while_the_same_chat_is_running(self):
        with patch.object(self.runtime, 'start') as start:
            with self.assertRaisesRegex(ValueError, '正在处理'):
                self.runtime.prompt({'id': 'second', 'channel': 'desktop', 'text': '同一聊天里的另一个问题'})
            start.assert_not_called()
        self.assertEqual(self.runtime.active_turn, 'test-turn')

    def test_stop_during_startup_cannot_submit_the_stopped_question(self):
        self.runtime.active = None
        self.runtime.status = 'idle'
        with patch.object(self.runtime, 'start', side_effect=self.runtime.stop), patch.object(self.runtime, 'request') as request:
            with self.assertRaises(RuntimeError):
                self.runtime.prompt({'id': 'stopped-at-start', 'text': '已经按停止的问题'})
            request.assert_not_called()
        with self.runtime.store() as store:
            self.assertIsNone(store.conn.execute("SELECT 1 FROM desktop_turns WHERE id='stopped-at-start'").fetchone())
        self.assertEqual(self.runtime.status, 'idle')

    def test_saved_question_keeps_original_reference_and_submission_identity(self):
        self.runtime.active = None
        self.runtime.status = 'idle'
        with self.runtime.store() as store:
            file = store.perform('create', {'name': '材料.md', 'text': '原始材料'})
        request = {'id': 'reference-request', 'channel': 'desktop', 'text': '这个定义是什么意思？',
                   'files': [file['id']], 'quote': {'file': file['id'], 'text': '原始材料', 'sha256': file['sha256'], 'source': '文字选区'}}
        with patch.object(self.runtime, 'start'), patch.object(self.runtime, 'request', return_value={}):
            self.runtime.prompt(request)
            self.runtime.prompt(request)  # an acknowledgement retry is idempotent
        messages = self.runtime.conversation()['messages']['desktop']
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]['id'], 'reference-request')
        self.assertEqual(messages[0]['files'], [file['id']])
        self.assertEqual(messages[0]['quote']['sha256'], file['sha256'])
        self.assertGreater(messages[0]['time'], 0)

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
