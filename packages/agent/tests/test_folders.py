"""Course hierarchy, actual saved outputs, compatible migration and file boundaries."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace

class FolderTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.store=Workspace(self.root)
        self.course=self.store.perform('course',{'code':'CALC','name':'微积分'})
    def tearDown(self):self.store.close();self.temp.cleanup()
    def test_outputs_and_pdf_are_saved_under_course_category(self):
        output=self.store.perform('create',{'name':'概念笔记.tex','course':'CALC','category':'notes','text':r'\documentclass{article}\begin{document}Test\end{document}'})
        exercise=self.store.perform('create',{'name':'练习.md','course':'CALC','kind':'practice','text':'说明概念'})
        self.assertEqual(output['folder'],self.course['folders']['notes'])
        self.assertEqual(exercise['folder'],self.course['folders']['practice'])
        self.assertEqual((self.root/'CALC/notes/概念笔记.tex').read_text(),output['text'])
        result=self.store.compile({'file':output['id'],'expected':output['sha256']},'actual-pdf')
        self.assertTrue(result['ok'],result['log'])
        pdf=self.store.file(self.store.file(output['id'])['pdf']['file'])
        self.assertEqual(pdf['folder'],output['folder'])
        self.assertTrue((self.root/'CALC/notes/概念笔记.pdf').is_file())
        self.assertFalse(any(file['folder'] is None for file in self.store.snapshot()['files']))
        self.assertFalse(any(file['name']=='COURSE.md' for file in self.store.snapshot()['files']))
    def test_user_category_and_deeper_subfolder_are_used(self):
        notes=self.course['folders']['notes']
        custom=self.store.perform('folder',{'name':'第二章','parent':notes})
        self.assertEqual(custom['course'],'CALC')
        file=self.store.perform('create',{'name':'概念.md','kind':'note','folder':custom['id'],'text':'内容'})
        self.assertEqual(file['folder'],custom['id'])
        self.assertEqual(file['course'],'CALC')
        self.store.perform('metadata',{'expected':self.store.version(),'folders':[dict(custom,name='第二章修订')],'files':[]})
        self.assertEqual(self.store.folder_course(custom['id']),'CALC')
        with self.assertRaises(ValueError):self.store.perform('folder',{'id':notes,'name':'笔记','parent':custom['id']})
    def test_no_course_no_output_and_upload_stays_distinct(self):
        with self.assertRaises(ValueError):self.store.perform('create',{'name':'无归属练习.md','kind':'practice','text':'题目'})
        loose=self.store.perform('create',{'name':'尚未归属.txt','text':'原件'})
        self.assertIsNone(loose['folder'])
        material=self.store.perform('create',{'name':'课件.md','folder':self.course['folder'],'text':'课堂材料'})
        self.assertEqual(material['folder'],self.course['folders']['materials'])
        self.assertEqual(material['course'],'CALC')
    def test_old_flat_metadata_migrates_without_guessing_or_changing_content(self):
        exercise=self.store.perform('create',{'name':'旧练习.md','kind':'practice','course':'CALC','text':'原题'})
        self.store.close()
        conn=sqlite3.connect(str(self.root/'.study-system/data/task_memory.sqlite3'))
        value=json.loads(conn.execute('SELECT value FROM desktop_files WHERE id=?',(exercise['id'],)).fetchone()[0]);value['folder']=None;value.pop('category',None)
        conn.execute('UPDATE desktop_files SET value=? WHERE id=?',(json.dumps(value),exercise['id']))
        conn.execute('CREATE TABLE legacy_folders (id TEXT PRIMARY KEY,name TEXT NOT NULL)');conn.execute('INSERT INTO legacy_folders SELECT id,name FROM desktop_folders WHERE parent IS NULL');conn.execute('DROP TABLE desktop_folders');conn.execute('ALTER TABLE legacy_folders RENAME TO desktop_folders');conn.commit();conn.close()
        self.store=Workspace(self.root)
        restored=self.store.perform('read',{'file':exercise['id']})
        self.assertEqual(restored['text'],'原题')
        self.assertEqual(self.store.folder_course(restored['folder']),'CALC')
        self.assertIsNotNone(self.store.conn.execute('SELECT parent FROM desktop_folders WHERE id=?',(restored['folder'],)).fetchone()[0])
