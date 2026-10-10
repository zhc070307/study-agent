"""独立临时数据中的 Windows 文件与中文读取回归检查。"""
import base64
import io
import zipfile
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'packages/agent'))
from workspace import Workspace
from semesters import Semesters
from agreements import save, read_all
from worker import Store
from transcription import Transcription

class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='中文 空格-')
        self.root = Path(self.temp.name)
        self.store = Workspace(self.root)
        self.course = self.store.perform('course', {'code': 'DEMO', 'name': '微积分'})

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def upload(self, content, name='中文笔记.md'):
        return self.store.perform('create', {'name': name, 'data': base64.b64encode(content).decode(),
                                           'folder': self.course['folders']['notes']})

    def test_bom_text_reads_without_loss_and_keeps_original_bytes(self):
        text = '# 中文笔记\r\n函数与极限：𝛼。'
        for encoding in ('utf-8-sig', 'utf-16', 'utf-32'):
            with self.subTest(encoding=encoding):
                content = text.encode(encoding)
                file = self.upload(content, encoding + '.md')
                self.assertEqual(file['text'], text)
                self.assertEqual(self.store.content(file), content)
                self.assertEqual(self.store.perform('read', {'file': file['id']})['text'], text)

    def test_unknown_encoding_never_silently_replaces_characters(self):
        content = '中文笔记'.encode('gb18030')
        file = self.upload(content)
        self.assertNotIn('text', file)
        self.assertIn('UTF-8', file['text_error'])
        self.assertEqual(self.store.content(file), content)
        with self.assertRaisesRegex(ValueError, 'UTF-8'):
            self.store.perform('read', {'file': file['id']})

    def test_case_colliding_file_is_rejected_before_publication(self):
        self.upload(b'original', 'Notes.md')
        with self.assertRaisesRegex(ValueError, '同名'):
            self.upload(b'replacement', 'notes.md')
        self.assertEqual((self.root / 'DEMO/notes/Notes.md').read_bytes(), b'original')
        self.assertEqual(len(self.store.snapshot()['files']), 1)

    def test_sibling_folder_names_cannot_alias(self):
        self.store.perform('folder', {'name': 'Week One', 'parent': self.course['folders']['notes']})
        with self.assertRaisesRegex(ValueError, '同名文件夹'):
            self.store.perform('folder', {'name': 'week one', 'parent': self.course['folders']['notes']})

    def test_backup_rejects_aliases_before_creating_any_restored_state(self):
        library=Semesters(self.root)
        for paths in [('DEMO/notes/Note.md','DEMO/notes/note.md'), ('资料/笔记.md','资料/笔记.MD'),
                      ('DEMO/notes/一.md','demo/notes/二.md')]:
            with self.subTest(paths=paths):
                output=io.BytesIO()
                with zipfile.ZipFile(output,'w') as archive:
                    archive.writestr('semester.json',json.dumps({'name':'恢复','format':1}))
                    for name in paths:archive.writestr(name,b'original')
                output.seek(0)
                with self.assertRaisesRegex(ValueError,'同名路径'):library.import_backup(output,0)
                self.assertEqual(len(library.load()['items']),1)
                self.assertEqual(list((self.root/'.semesters').glob('*/.workspace')),[])

    def test_case_only_rename_preserves_outside_changes(self):
        file=self.upload(b'original','Notes.md')
        target=self.root/'DEMO/notes/Notes.md'
        target.write_bytes(b'outside edit')
        result=self.store.perform('metadata',{'expected':self.store.version(),
                                             'files':[{'id':file['id'],'name':'notes.md'}]})
        self.assertTrue(result['warnings'])
        self.assertEqual(target.read_bytes(),b'outside edit')

    def test_case_only_rename_keeps_a_single_publication(self):
        file = self.upload(b'original', 'Notes.md')
        self.store.perform('metadata', {'expected': self.store.version(),
                                       'files': [{'id': file['id'], 'name': 'notes.md'}]})
        self.assertEqual((self.root / 'DEMO/notes/notes.md').read_bytes(), b'original')
        self.assertEqual(self.store.conn.execute('SELECT count(*) FROM desktop_retirements').fetchone()[0], 0)

    def test_utf8_state_is_independent_of_windows_default_codepage(self):
        # 模拟系统默认 cp1252；明确指定 UTF-8 的调用不受影响。
        original_read = Path.read_text
        def windows_read(path, encoding=None, errors=None, **kwargs):
            return original_read(path, encoding=encoding or 'cp1252', errors=errors, **kwargs)
        with patch.object(Path, 'read_text', windows_read):
            library = Semesters(self.root)
            self.assertEqual(library.load()['items'][0]['name'], '当前学期')
            save(self.root, {'scope': 'learning', 'key': '沟通', 'text': '简洁中文',
                             'reason': '临时验证', 'expected': 0}, 'compat-memory')
            self.assertEqual(read_all(self.root)['references'][0]['text'], '简洁中文')
            worker = Store(self.root)
            try:
                (self.root / 'DEMO/COURSE.md').write_text('实际授课：函数与极限。', encoding='utf-8')
                self.assertEqual(worker.read({'course': 'DEMO'})['course_context'], '实际授课：函数与极限。')
            finally:
                worker.conn.close()

    def test_first_host_status_fetches_even_during_first_two_seconds(self):
        tool = Transcription(self.root)
        expected = {'installed': False, 'resources': {'eligible': False}}
        with patch('transcription.time.monotonic', return_value=1), patch.object(tool, 'host_request', return_value=expected):
            self.assertEqual(tool.host_status(), expected)

    def test_chinese_keywords_split_across_pdf_lines_and_adjacent_english_query(self):
        file = self.store.perform('create', {'name': '教材.pdf', 'mime': 'application/pdf', 'data': base64.b64encode(b'fixture').decode()})
        content = '本章介绍函数的连\r\n续性 continuity 与极限。'
        with patch('textbooks.pdf_tools.page_texts', return_value=iter([(1, content)])):
            self.store.perform('textbook', {'action': 'index', 'file': file['id'], 'expected': file['sha256']})
        for query in ('连续性', '连续性continuity'):
            result = self.store.perform('textbook', {'action': 'search', 'file': file['id'], 'query': query})
            self.assertEqual([item['pdf_page'] for item in result['results']], [1])
        result = self.store.perform('textbook', {'action': 'read', 'file': file['id'], 'pdf_page': 1})
        self.assertEqual(result['text'], content)

if __name__ == '__main__':
    unittest.main()
