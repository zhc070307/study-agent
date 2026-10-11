"""Conversation lifecycle must preserve files and reject stale writes."""
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from web import Runtime

class ChatManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.runtime=Runtime(self.root)
    def tearDown(self):
        self.runtime.stop()
        self.temp.cleanup()
    def test_archive_restore_delete_and_restart_preserve_learning(self):
        with self.runtime.store() as store:
            file=store.perform('create',{'name':'原题.md','text':'教材原题'})
            task=store.perform('task',{'file':file['id'],'title':'独立练习'})
            store.perform('answer',{'file':file['id'],'text':'我的作答'})
            store.message('legacy-message',file['id'],{'role':'user','text':'保留的旧对话'})
            store.perform('draft',{'channel':file['id'],'value':{'prompt':'未写完的问题'}})
        self.runtime.manage_chat({'action':'rename','channel':file['id'],'title':'教材疑问'})
        self.runtime.manage_chat({'action':'archive','channel':file['id']})
        with self.runtime.store() as store:
            self.assertEqual(store.chat(file['id'])['status'],'archived')
            with self.assertRaisesRegex(ValueError,'归档'):store.perform('draft',{'channel':file['id'],'value':{'prompt':'迟到的保存'}})
        restarted=Runtime(self.root)
        self.assertEqual(restarted.conversation()['chats'][0]['title'],'教材疑问')
        restarted.manage_chat({'action':'restore','channel':file['id']})
        with restarted.store() as store:self.assertEqual(store.snapshot()['drafts'][file['id']]['prompt'],'未写完的问题')
        restarted.manage_chat({'action':'delete','channel':file['id']})
        with restarted.store() as store:
            self.assertEqual(store.content(store.file(file['id'])), '教材原题'.encode())
            self.assertEqual(store.snapshot()['answers'][file['id']],'我的作答')
            self.assertEqual(store.tasks.get_task(task['id']).status,'open')
            self.assertNotIn(file['id'],store.snapshot()['messages'])
            self.assertNotIn(file['id'],store.snapshot()['drafts'])
            with self.assertRaisesRegex(ValueError,'删除'):store.perform('draft',{'channel':file['id'],'value':{'prompt':'迟到的保存'}})
            with self.assertRaisesRegex(ValueError,'删除'):store.message('late-message',file['id'],{'role':'assistant','text':'迟到的回复'})
        self.assertNotIn(file['id'],[chat['channel'] for chat in Runtime(self.root).conversation()['chats']])
    def test_busy_refusal_and_delete_failure_keep_history(self):
        with self.runtime.store() as store:store.message('question','desktop',{'role':'user','text':'已有问题'})
        self.runtime.active='desktop'
        for action in ('archive','delete'):
            with self.assertRaisesRegex(ValueError,'先停止'):self.runtime.manage_chat({'action':action,'channel':'desktop'})
        self.runtime.active=None
        (self.root/'.harness/sessions').mkdir(parents=True)
        with patch('web.subprocess.run',side_effect=OSError('disk unavailable')):
            with self.assertRaisesRegex(RuntimeError,'仍保留'):self.runtime.manage_chat({'action':'delete','channel':'desktop'})
        self.assertEqual(self.runtime.conversation()['messages']['desktop'][0]['text'],'已有问题')
    def test_multiple_chats_share_a_file_but_not_identity(self):
        with self.runtime.store() as store:file=store.perform('create',{'name':'笔记.md','text':'内容'})
        a=self.runtime.manage_chat({'action':'create','file':file['id']})
        b=self.runtime.manage_chat({'action':'create','file':file['id']})
        self.assertNotEqual(a['channel'],b['channel'])
        self.assertEqual(a['file'],b['file'])
        self.runtime.manage_chat({'action':'delete','channel':a['channel']})
        with self.runtime.store() as store:self.assertEqual(store.chat(b['channel'])['status'],'open')
