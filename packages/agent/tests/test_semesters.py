"""Three outside perspectives, exercising real scoped storage and HTTP boundaries."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from semesters import Semesters
from workspace import Workspace
from worker import Store
from web import create_server
from agreements import read_all

class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.library=Semesters(self.root)
    def tearDown(self):self.temp.cleanup()
    def change(self,action,**args):
        return self.library.change(action,dict(args,expected=self.library.load()['version']))
    def test_first_user_course_entry_has_no_invented_plan(self):
        with self.workspace() as w:
            course=w.perform('course',{'code':'demo','name':'示例课程'},'register')
            repeated=w.perform('course',{'code':'demo','name':'示例课程'},'register')
            self.assertEqual(course,repeated)
            self.assertEqual(w.snapshot()['courses'],[{'code':'DEMO','name':'示例课程'}])
            self.assertEqual(w.snapshot()['tasks'],[])
            self.assertEqual(len(w.snapshot()['folders']),1)
            self.assertIn('尚无授课',Path(course['course_md']).read_text())
            with self.assertRaises(ValueError):w.perform('course',{'code':'../wrong','name':'示例'})
            with self.assertRaises(ValueError):w.perform('course',{'code':'DEMO','name':'另一门课'})
    def workspace(self,root=None):
        class Managed(Workspace):
            def __enter__(self):return self
            def __exit__(self,*_):self.close()
        return Managed(root or self.library.directory())
    def test_busy_student_memories_are_references_and_course_facts_stay_local(self):
        with self.workspace() as w:
            w.perform('course',{'code':'DEMO','name':'课程'})
            general={'scope':'learning','key':'讲解','text':'先用直观的语言解释','reason':'用户说不喜欢技术术语','expected':0}
            saved=w.perform('agreement',general,'preference')
            self.assertEqual(saved,w.perform('agreement',general,'preference'))
            w.perform('agreement',{'scope':'course','course':'DEMO','key':'讲解','text':'这门课这周先看严格证明','reason':'只限本课程','expected':0})
            refs=read_all(self.root,'DEMO')['references']
            self.assertEqual(len(refs),2) # No automatic choice or user action from memory.
            self.assertEqual(w.snapshot()['tasks'],[])
            with self.assertRaises(ValueError):w.perform('agreement',dict(general,text='过期修改'))
            w.perform('agreement',dict(general,expected=1,text='可暂不使用此偏好',remove=True),'remove-preference')
            self.assertEqual(read_all(self.root)['references'],[])
            self.assertEqual(len(read_all(self.root)['learning']['history']),2)
    def test_new_semester_preserves_overall_memory_and_not_old_student_state(self):
        with self.workspace() as old:
            old.perform('course',{'code':'DEMO','name':'课程'})
            old.perform('agreement',{'scope':'learning','key':'语气','text':'简洁自然','reason':'用户明确偏好','expected':0})
            old.perform('agreement',{'scope':'course','course':'DEMO','key':'进度','text':'目前到第二章','reason':'用户提供','expected':0})
            old.perform('create',{'name':'原件.md','text':'真实原文'})
            old.perform('task',{'title':'未完成事项'})
        self.change('archive',semester='initial')
        with self.workspace() as old:
            with self.assertRaises(ValueError):old.perform('task',{'title':'不应添加'})
            self.assertEqual(old.snapshot()['tasks'][0]['status'],'open')
        self.change('create',name='下一学期')
        with self.workspace() as new:
            self.assertEqual(new.snapshot()['files'],[])
            self.assertEqual(new.snapshot()['courses'],[])
            self.assertEqual(new.snapshot()['tasks'],[])
            self.assertEqual(read_all(new.root)['references'][0]['text'],'简洁自然')
            self.assertEqual(read_all(new.root)['semester']['items'],{})
        self.change('remove',semester='initial',confirm='当前学期')
        self.assertEqual(self.library.item('initial')['status'],'removed')
        with self.assertRaises(ValueError):self.change('remove',semester='initial',confirm='当前学期')
        with self.assertRaises(ValueError):self.change('archive',semester='initial')
        self.assertTrue((self.root/'.workspace/blobs').exists())
        with self.workspace() as new:self.assertEqual(read_all(new.root)['references'][0]['text'],'简洁自然')
        self.change('restore',semester='initial')
        self.assertEqual(self.library.item('initial')['status'],'archived')
        with self.library.export('initial') as archive,zipfile.ZipFile(archive) as zip:
            self.assertIn('.study-system/data/task_memory.sqlite3',zip.namelist())
            self.assertTrue(any(n.startswith('.workspace/blobs/') for n in zip.namelist()))
            self.assertFalse(any(n.startswith('.semesters/') for n in zip.namelist()))
    def test_reusable_flow_applies_in_new_term_but_local_exception_survives(self):
        store=Store(self.root)
        try:
            definition={'title':'通用沟通','scope':'workspace','steps':[{'id':'reply','kind':'memory','instructions':'回应当前请求，不自动安排练习'}]}
            preview=store.execute({'action':'change','args':{'scope':'learning','flow':'memory','action':'preview','reason':'用户要求所有学期沿用','definition':definition},'id':'preview'})
            store.execute({'action':'change','args':{'scope':'learning','flow':'memory','action':'apply','version':preview['version'],'expected':preview['current']},'id':'apply'})
        finally:store.conn.close()
        self.change('create',name='下一学期')
        store=Store(self.library.directory())
        try:
            self.assertEqual(store.active('memory','*')['definition'],definition)
            self.assertEqual(store.read({})['courses'],[])
            local=dict(definition,title='仅本学期例外')
            preview=store.execute({'action':'change','args':{'flow':'memory','action':'preview','reason':'本学期限定','definition':local},'id':'local-preview'})
            store.execute({'action':'change','args':{'flow':'memory','action':'apply','version':preview['version'],'expected':preview['current']},'id':'local-apply'})
        finally:store.conn.close()
        store=Store(self.library.directory())
        try:self.assertEqual(store.active('memory','*')['definition'],local)
        finally:store.conn.close()
    def test_removed_file_keeps_answer_and_identity(self):
        with self.workspace() as w:
            file=w.perform('create',{'name':'原件.md','text':'题目'})
            w.perform('answer',{'file':file['id'],'text':'原始作答'})
            w.perform('task',{'title':'作答','file':file['id']})
            w.perform('remove_file',{'file':file['id'],'expected':file['sha256']})
            self.assertEqual(w.snapshot()['files'],[])
            self.assertEqual(w.snapshot()['trash'][0]['id'],file['id'])
            self.assertEqual(w.snapshot()['answers'][file['id']],'原始作答')
            self.assertFalse(w.snapshot()['tasks'][0]['done'])
            w.perform('restore_file',{'file':file['id'],'expected':file['sha256']})
            self.assertEqual(w.snapshot()['files'][0]['id'],file['id'])
    def test_agent_prepares_next_semester_and_chooses_materials_with_provenance(self):
        with self.workspace() as old:
            file=old.perform('create',{'name':'可复用概念.md','text':'实际读取的概念'})
            prepare_args={'action':'create','name':'模型准备的新学期','expected':0,'reason':'用户委托准备下学期并保留有用资料'}
            prepared=old.perform('semester',prepare_args,'prepare-semester')
            repeated=old.perform('semester',prepare_args,'prepare-semester')
            self.assertEqual(prepared['created'],repeated['created'])
            self.assertEqual(self.library.load()['version'],1)
            target=prepared['created']
            self.assertEqual(self.library.load()['active'],'initial')
            course=old.perform('course',{'semester':target,'code':'NEXT','name':'新课程'},'new-course')
            copied=old.perform('carry',{'file':file['id'],'target':target,'folder':course['folder'],'reason':'此概念适用于用户的新课程目标'},'carry')
            self.assertEqual(copied['origin']['file'],file['id'])
            self.assertEqual(copied['origin']['sha256'],file['sha256'])
            self.assertEqual(old.perform('read',{'file':file['id']})['text'],'实际读取的概念')
            with self.workspace(self.library.directory(target)) as new:
                self.assertEqual(new.perform('read',{'file':copied['id']})['text'],'实际读取的概念')
                self.assertEqual(new.snapshot()['tasks'],[])
            queued=old.perform('semester',{'action':'select','semester':target,'expected':1,'reason':'准备完成，请打开新学期'})
            self.assertEqual(queued['active'],'initial')
            self.assertEqual(queued['pending']['semester'],target)

    def test_agent_requested_switch_waits_for_turn_end_and_routes_to_new_data(self):
        server=create_server(self.root)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with self.workspace() as old:
                prepared=old.perform('semester',{'action':'create','name':'下一学期','expected':0,'reason':'用户委托'})
                old.perform('semester',{'action':'select','semester':prepared['created'],'expected':1,'reason':'准备完成'})
            server.runtime.status='running'
            with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/state') as response:state=json.load(response)
            self.assertEqual(state['semesters']['active'],'initial')
            server.runtime.status='idle'
            with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/state') as response:state=json.load(response)
            self.assertEqual(state['semesters']['active'],prepared['created'])
            self.assertNotIn('pending',state['semesters'])
            self.assertEqual(server.runtime.root,self.library.directory(prepared['created']))
        finally:
            server.shutdown();server.runtime.stop();server.server_close();thread.join()

    def test_switch_rejects_busy_or_stale_requests_and_archived_mutations(self):
        server=create_server(self.root)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        def post(path,args,semester=None):
            headers={'Content-Type':'application/json'}
            if semester:headers['X-Study-Semester']=semester
            request=urllib.request.Request(origin+path,json.dumps(args).encode(),headers)
            try:
                with urllib.request.urlopen(request) as response:return response.status,json.load(response)
            except urllib.error.HTTPError as error:return error.code,json.load(error)
        try:
            server.runtime.status='running'
            self.assertEqual(post('/api/semesters',{'action':'create','args':{'name':'new','expected':0}})[0],400)
            server.runtime.status='idle'
            code,data=post('/api/semesters',{'action':'create','args':{'name':'new','expected':0}})
            self.assertEqual(code,200);active=data['active']
            self.assertEqual(post('/api/workspace',{'action':'create','args':{'name':'wrong','text':'old request'}},'initial')[0],400)
            self.assertEqual(post('/api/workspace',{'action':'create','args':{'name':'good.md','text':'actual'}},active)[0],200)
            self.assertEqual(post('/api/semesters',{'action':'archive','args':{'semester':active,'expected':1}})[0],200)
            self.assertEqual(post('/api/chat',{'id':'wrong','text':'change'},active)[0],400)
            self.assertEqual(post('/api/workspace',{'action':'draft','args':{'channel':'desktop','value':{}}},active)[0],400)
        finally:
            server.shutdown();server.runtime.stop();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
