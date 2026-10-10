"""Real storage, ledger, compilation and failure recovery on isolated example data."""
import sys
from pathlib import Path
import tempfile
import unittest
import json
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace

TEX = r'''\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{amsmath}
\begin{document}
\section{导数与变化率}
函数 $f(x)=x^2$ 的导数是 $f'(x)=2x$。
\end{document}
'''

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.store=Workspace(self.root)
    def tearDown(self):
        self.store.close()
        self.temp.cleanup()
    def create(self,text=TEX,filename='笔记.tex'):
        return self.store.perform('create',{'name':filename,'text':text})
    def test_real_tasks_answers_and_restart(self):
        file=self.create('证明题','题目.md')
        task=self.store.perform('task',{'title':'完成题目','file':file['id']})
        self.assertEqual(self.store.tasks.get_task(task['id']).status,'open')
        self.store.perform('answer',{'file':file['id'],'text':'第一次推导'})
        self.store.perform('answer',{'file':file['id'],'text':'第二次推导'})
        self.store.perform('check_task',{'task':task['id'],'done':True})
        self.store.perform('draft',{'channel':file['id'],'value':{'prompt':'问题','contexts':[file['id']]}})
        self.store.close();self.store=Workspace(self.root)
        state=self.store.snapshot()
        self.assertTrue(state['tasks'][0]['done'])
        self.assertEqual(state['drafts'][file['id']]['prompt'],'问题')
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM desktop_answers').fetchone()[0],2)
        self.assertEqual(self.store.conn.execute('SELECT COUNT(*) FROM task_evidence').fetchone()[0],1)
        self.store.perform('check_task',{'task':task['id'],'done':False})
        self.assertFalse(self.store.snapshot()['tasks'][0]['done'])
    def test_conflict_idempotency_and_history(self):
        args={'name':'source.md','text':'first'}
        first=self.store.perform('create',args,'same')
        self.assertEqual(first,self.store.perform('create',args,'same'))
        with self.assertRaises(ValueError):self.store.perform('create',{'name':'different','text':'different'},'same')
        revised=self.store.perform('write',{'file':first['id'],'expected':first['sha256'],'text':'second'})
        with self.assertRaises(ValueError):self.store.perform('write',{'file':first['id'],'expected':first['sha256'],'text':'lost'})
        self.store.perform('restore',{'file':first['id'],'expected':revised['sha256'],'version':first['sha256']})
        self.assertEqual(self.store.perform('read',{'file':first['id']})['text'],'first')
        with self.assertRaises(ValueError):self.store.perform('metadata',{'expected':-1,'files':[]})
    def test_real_pdf_compile_review_failure_preserves_previous(self):
        file=self.create()
        result=self.store.perform('compile',{'file':file['id'],'expected':file['sha256']},'compile-1')
        self.assertTrue(result['ok'],result['log'])
        self.assertEqual(result,self.store.perform('compile',{'file':file['id'],'expected':file['sha256']},'compile-1'))
        source=self.store.file(file['id'])
        pdf=self.store.file(source['pdf']['file'])
        review={'file':pdf['id'],'sha256':pdf['sha256'],'pages':[{'page':1,'status':'passed','summary':'示例中中文、导数公式与标题清楚'}],'checks':{'source_scope':'仅覆盖示例的平方函数导数','layout':'逐页检查示例，未见裁切'}}
        with self.assertRaises(ValueError):self.store.perform('review',review)
        page=self.store.perform('page',{'file':pdf['id'],'page':1})
        self.assertTrue(page['images'][0]['data'])
        self.assertTrue(self.store.perform('review',review)['accepted'])
        bad=self.store.perform('write',{'file':file['id'],'expected':file['sha256'],'text':r'\badcommand'})
        failed=self.store.perform('compile',{'file':file['id'],'expected':bad['sha256']})
        self.assertFalse(failed['ok'])
        self.assertEqual(self.store.file(pdf['id'])['sha256'],pdf['sha256'])
        with self.assertRaises(ValueError):self.store.perform('review',review)
        self.store.close();self.store=Workspace(self.root)
        self.assertEqual(self.store.file(file['id'])['compile_result']['id'],failed['id'])
        self.assertIn('平方函数',review['checks']['source_scope'])
        self.assertIn('导数',self.store.perform('read',{'file':pdf['id']})['text'])
    def test_formal_notes_reuse_original_preparation_and_acceptance(self):
        self.store.tasks.add_course('DEMO','示例课程')
        course=self.root/'DEMO';course.mkdir()
        (course/'COURSE.md').write_text('仅学习平方函数导数；无学生掌握记录。')
        (self.root/'brief.md').write_text('真实示例输入为 f(x)=x²，写清导数与变化率；不附自测题。')
        prepared=self.store.perform('prepare',{'course':'DEMO','kind':'note','brief':'brief.md'})
        file=self.store.perform('create',{'name':'正式示例.tex','text':TEX,'preparation':prepared['id']})
        result=self.store.perform('compile',{'file':file['id'],'expected':file['sha256']})
        self.assertTrue(result['ok'],result['log'])
        pdf=self.store.file(self.store.file(file['id'])['pdf']['file'])
        self.store.perform('page',{'file':pdf['id'],'page':1})
        checks={key:'示例中实际核对 '+key for key in ('source_scope','layout','task_handoff','author_model','brief_standards')}
        args={'file':pdf['id'],'sha256':pdf['sha256'],'pages':[{'page':1,'status':'passed','summary':'独立示例测试'}],'checks':checks,'course':'DEMO','kind':'note','brief':'brief.md'}
        accepted=self.store.perform('review',args)
        import json
        receipt=json.loads((self.root/accepted['receipt']).read_text())
        self.assertTrue(receipt['delivery_review']['accepted'])
        (course/'COURSE.md').write_text('范围已变化，必须重新准备')
        with self.assertRaises(ValueError):self.store.perform('review',args)
    def test_course_publication_and_external_edit_conflict(self):
        self.store.tasks.add_course('DEMO','示例课程')
        (self.root/'DEMO').mkdir()
        (self.root/'DEMO/COURSE.md').write_text('独立示例课程')
        file=self.create('实际材料','材料.md')
        args={'file':file['id'],'course':'DEMO','path':'materials/source.md','reason':'用户确认属于示例课程；实际读到正文'}
        self.store.perform('publish',args)
        target=self.root/'DEMO/materials/source.md'
        self.assertEqual(target.read_text(),'实际材料')
        from study_agent.learning import LearningService
        learning=LearningService(self.store.conn)
        learning.scan_materials(self.root)
        self.assertTrue(learning.pending_events('DEMO'))
        target.write_text('在课程目录外部修订的正文')
        updated=self.store.perform('write',{'file':file['id'],'expected':file['sha256'],'text':'桌面中的新版本'})
        self.assertTrue(updated['warnings'])
        self.assertEqual(target.read_text(),'在课程目录外部修订的正文')
        self.assertEqual(self.store.perform('read',{'file':file['id']})['text'],'桌面中的新版本')

    def test_agent_tasks_cannot_be_completed_by_student_checkbox(self):
        task=self.store.tasks.create_task('交付笔记',actor='agent',status='open')
        with self.assertRaises(ValueError):self.store.perform('check_task',{'task':task.id,'done':True})

    def test_compact_snapshot_skips_blob_reads_and_versioned_text_is_still_available(self):
        files=[self.store.perform('create',{'name':str(n)+'.md','text':'x'*1024*1024}) for n in range(5)]
        self.store.perform('remove_file',{'file':files[-1]['id'],'expected':files[-1]['sha256']})
        with patch.object(self.store,'content',side_effect=AssertionError('Polling must not read file blobs')):
            state=self.store.snapshot(include_text=False)
        self.assertLess(len(json.dumps(state)),20000)
        for file in state['files']+state['trash']:
            self.assertNotIn('text',file)
            self.assertTrue(file['textual'])
        self.assertEqual(self.store.perform('read',{'file':files[0]['id'],'expected':files[0]['sha256']})['text'],files[0]['text'])
        self.store.perform('write',{'file':files[0]['id'],'expected':files[0]['sha256'],'text':'New version'})
        with self.assertRaises(ValueError):
            self.store.perform('read',{'file':files[0]['id'],'expected':files[0]['sha256']})
        self.assertEqual(next(file for file in self.store.snapshot()['files'] if file['id']==files[0]['id'])['text'],'New version')

if __name__=='__main__':unittest.main()
