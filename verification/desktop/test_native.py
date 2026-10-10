"""First use, optional GPU tool and semester restore on Mac/Windows/POSIX."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
import zipfile

PROJECT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(PROJECT/'packages/agent'))
sys.path.insert(0,str(PROJECT/'packages/transcription'))
from workspace import Workspace
from semesters import Semesters
from settings import Settings
from worker import Store
from agreements import save,read_all
from transcription import NativeTranscription
from host import Service,Handler,ThreadingHTTPServer,write
import file_lock

class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name)
    def tearDown(self):self.temporary.cleanup()
    def test_configuration_is_private_and_does_not_erase_key_on_model_change(self):
        with patch.dict(os.environ,{},clear=True):
            settings=Settings(self.root)
            self.assertFalse(settings.status()['configured'])
            settings.save({'api_key':'private-test-key','model':'deepseek-flash','timezone':'Europe/London'})
            settings.save({'api_key':'','model':'deepseek-pro','timezone':'Europe/London'})
            self.assertEqual(settings.load()['api_key'],'private-test-key')
            self.assertNotIn('private-test-key',json.dumps(settings.status()))
            with self.assertRaises(ValueError):settings.save({'timezone':'invalid/timezone'})
    def test_locks_refuse_concurrent_changes(self):
        path=self.root/'lock'
        with path.open('a+') as first,path.open('a+') as second:
            file_lock.flock(first,file_lock.LOCK_EX)
            with self.assertRaises(BlockingIOError):file_lock.flock(second,file_lock.LOCK_EX|file_lock.LOCK_NB)
    def test_nested_folder_rename_and_cross_course_move_keep_real_files_and_open_tasks_aligned(self):
        store=Workspace(self.root)
        try:
            course=store.perform('course',{'code':'DEMO','name':'课程一'})
            other=store.perform('course',{'code':'OTHER','name':'课程二'})
            nested=store.perform('folder',{'name':'第一周','parent':course['folders']['notes']})
            note=store.perform('create',{'name':'笔记.md','kind':'note','text':'原始内容','folder':nested['id']})
            task=store.perform('task',{'title':'继续阅读','file':note['id'],'date':''})
            self.assertTrue((self.root/'DEMO/notes/第一周/笔记.md').is_file())
            store.perform('metadata',{'expected':store.version(),'folders':[{**nested,'name':'第二周'}]})
            self.assertFalse((self.root/'DEMO/notes/第一周/笔记.md').exists())
            self.assertEqual((self.root/'DEMO/notes/第二周/笔记.md').read_text(encoding='utf-8'),'原始内容')
            store.perform('metadata',{'expected':store.version(),'files':[{'id':note['id'],'folder':other['folders']['notes'],'name':'新笔记.md'}]})
            self.assertFalse((self.root/'DEMO/notes/第二周/笔记.md').exists())
            self.assertEqual((self.root/'OTHER/notes/新笔记.md').read_text(encoding='utf-8'),'原始内容')
            self.assertEqual(store.tasks.get_task(task['id']).course_id,store.tasks._resolve_course_row('OTHER')['id'])
            self.assertEqual(store.file(note['id'])['sha256'],note['sha256'])
        finally:store.close()
    def test_move_preserves_outside_edits_and_reports_them(self):
        store=Workspace(self.root)
        try:
            store.perform('course',{'code':'DEMO','name':'课程'})
            note=store.perform('create',{'name':'笔记.md','kind':'note','text':'原件','course':'DEMO'})
            (self.root/'DEMO/notes/笔记.md').write_text('系统外的修订',encoding='utf-8')
            store.perform('metadata',{'expected':store.version(),'files':[{'id':note['id'],'name':'新名字.md'}]})
            self.assertEqual((self.root/'DEMO/notes/笔记.md').read_text(encoding='utf-8'),'系统外的修订')
            self.assertEqual((self.root/'DEMO/notes/新名字.md').read_text(encoding='utf-8'),'原件')
            self.assertTrue(store.sync_publications())
        finally:store.close()
    def test_restore_creates_independent_course_data_and_keeps_current_memory(self):
        library=Semesters(self.root)
        store=Workspace(self.root)
        try:
            store.perform('course',{'code':'DEMO','name':'示例课程'})
            note=store.perform('create',{'name':'笔记.md','text':'保留内容','course':'DEMO','category':'notes'})
            store.perform('task',{'title':'继续练习','file':note['id']})
            save(self.root,{'scope':'learning','key':'沟通','text':'旧偏好','reason':'用户以前提出','expected':0},'old-memory')
            with library.export('initial') as output:backup=output.read()
            save(self.root,{'scope':'learning','key':'沟通','text':'当前偏好','reason':'用户刚才提出','expected':1},'new-memory')
            result=library.import_backup(io.BytesIO(backup),0)
            self.assertEqual(library.load()['active'],'initial')
            restored=Workspace(library.directory(result['id']))
            try:
                self.assertEqual(restored.content(restored.file(note['id'])),b'\xe4\xbf\x9d\xe7\x95\x99\xe5\x86\x85\xe5\xae\xb9')
                self.assertEqual(len(restored.snapshot()['tasks']),1)
                self.assertTrue((restored.root/'DEMO/notes/笔记.md').is_file())
                self.assertEqual(read_all(restored.root)['references'][0]['text'],'当前偏好')
                candidate=json.loads((restored.root/'.study-system/restored-references.json').read_text(encoding='utf-8'))
                self.assertEqual(next(iter(candidate.values()))['text'],'旧偏好')
            finally:restored.close()
            self.assertEqual(store.content(store.file(note['id'])),'保留内容'.encode())
        finally:store.close()
    def test_shared_agent_memory_survives_semester_change_without_course_progress(self):
        library=Semesters(self.root)
        old=Store(self.root)
        try:
            memory=old.agent_memory()
            old.execute({'action':'memory_save','args':{'content':'用简洁的中文沟通；只是参考，当前要求优先。','expected':memory['content_hash'],'summary':'用户明确提出的沟通偏好'},'id':'shared-memory'})
            result=library.change('create',{'name':'下学期','expected':0,'reason':'用户准备开始下学期'})
            new=Store(library.directory(result['created']))
            try:
                self.assertEqual(new.agent_memory()['content'],old.agent_memory()['content'])
                self.assertEqual(new.read({})['courses'],[])
                self.assertFalse((new.root/'.study-system/AGENT_MEMORY.md').exists())
                with library.export('initial') as backup:
                    with zipfile.ZipFile(backup) as archive:self.assertIn('当前要求优先',json.loads(archive.read('semester.json'))['agent_memory'])
            finally:new.conn.close()
        finally:old.conn.close()
    def test_invalid_backup_cannot_escape_or_leave_partial_semester(self):
        library=Semesters(self.root)
        for name in ('../escape','C:/escape','.settings/config.json'):
            output=io.BytesIO()
            with zipfile.ZipFile(output,'w') as archive:
                archive.writestr('semester.json',json.dumps({'name':'恢复'}));archive.writestr(name,'bad')
            output.seek(0)
            with self.assertRaises(ValueError):library.import_backup(output,0)
            self.assertEqual(len(library.load()['items']),1)
    def test_native_tool_blocks_download_and_saves_scripted_gpu_result(self):
        service=Service(self.root/'speech')
        allowed={'eligible':False,'backend':'cuda','message':'显存不足'}
        service.resources=lambda:allowed
        service.ready=lambda:False
        def run(service,directory,job):
            job.update(status='completed',message='完成',text='课堂原稿：函数与导数。')
            write(directory/'job.json',job);service.active=None;service.lock.release()
        service.run=types.MethodType(run,service)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.service=service;server.token='test-secret';server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        config=self.root/'host.json';write(config,{'url':f'http://127.0.0.1:{server.server_port}','token':server.token})
        store=Workspace(self.root)
        try:
            course=store.perform('course',{'code':'DEMO','name':'课程'})
            audio=store.perform('create',{'name':'课堂.wav','data':'YXVkaW8=','mime':'audio/wav','folder':course['folders']['materials']})
            with patch.dict(os.environ,{'STUDY_TRANSCRIBE_CONFIG':str(config)}):
                tool=NativeTranscription(self.root)
                request={'file':audio['id'],'expected':audio['sha256'],'allow_install':True}
                self.assertTrue(tool.start(request)['blocked']);self.assertFalse(service.root.exists())
                allowed.update(eligible=True,message='GPU 检查通过')
                tool=NativeTranscription(self.root)
                self.assertTrue(tool.start({**request,'allow_install':False})['needs_install'])
                job=tool.start(request)
                records=tool.records()
                self.assertEqual(records[0]['status'],'completed')
                transcript=store.file(records[0]['transcript'])
                self.assertEqual(transcript['folder'],audio['folder']);self.assertEqual(transcript['sources'],[audio['id']])
                self.assertEqual(tool.start(request)['id'],job['id'])
        finally:store.close();server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
