"""Exercise real PDFs, durable FTS, source identity, failure recovery and semester backup."""
import base64
from contextlib import contextmanager
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from semesters import Semesters


def pdf(contents):
    """A small valid PDF with explicit pages and searchable Helvetica text."""
    objects = [b'', b'', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for index, lines in enumerate(contents):
        stream = b'BT /F1 10 Tf 50 740 Td 12 TL\n'
        for line in lines:
            escaped = line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            stream += ('(' + escaped + ') Tj T*\n').encode('ascii')
        stream += b'ET'
        objects.append(('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>' % (5 + 2 * index)).encode())
        objects.append(b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
    objects[0] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[1] = ('<< /Type /Pages /Count %d /Kids [%s] >>' % (len(contents), ' '.join('%d 0 R' % (4 + 2 * index) for index in range(len(contents))))).encode()
    output, offsets = b'%PDF-1.4\n', [0]
    for number, content in enumerate(objects, 1):
        offsets.append(len(output))
        output += str(number).encode() + b' 0 obj\n' + content + b'\nendobj\n'
    start = len(output)
    output += ('xref\n0 %d\n0000000000 65535 f \n' % len(offsets)).encode()
    output += b''.join(('%010d 00000 n \n' % offset).encode() for offset in offsets[1:])
    return output + ('trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(offsets), start)).encode()


class TextbookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='教材检索-')
        self.root = Path(self.temp.name)
        self.store = Workspace(self.root)
        self.file = self.upload(pdf([['Reference book'], ['Arc length derivation', 'Exercise 8.1'], []]))

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def upload(self, content, filename='教材.pdf'):
        return self.store.perform('create', {'name': filename, 'mime': 'application/pdf',
                                           'data': base64.b64encode(content).decode()})

    def call(self, action, **args):
        return self.store.perform('textbook', dict(action=action, file=self.file['id'], **args))

    def index(self, **args):
        return self.call('index', expected=self.file['sha256'], **args)

    def test_real_pages_mappings_paging_and_process_restart(self):
        self.assertFalse(self.call('status')['ready'])
        state = self.index(title='Example Calculus', edition='Test edition',
                           chapters=[dict(number='8.1', title='Arc Length', pdf_start=2, pdf_end=3)],
                           page_map=[dict(pdf_start=1, label='iv'), dict(pdf_start=2, pdf_end=3, book_start=563)])
        self.assertEqual((state['pages'], state['searchable_pages']), (3, 2))
        self.assertEqual(state['empty_text_pages'], [3])
        hit = self.call('search', query='arc length', chapter='8.1')['results'][0]
        self.assertEqual((hit['pdf_page'], hit['book_page']), (2, '563'))
        self.assertIn('#page=2', hit['citation']['url'])
        first = self.call('read', pdf_page=2, limit=5)
        remaining = self.call('read', pdf_page=2, offset=first['next_offset'])
        self.assertIn('Arc length', first['text'] + remaining['text'])
        self.assertEqual(self.call('search', book_page='iv')['results'][0]['pdf_page'], 1)
        result = self.call('search', pdf_start=1, pdf_end=3, limit=1)
        self.assertEqual(result['next_offset'], 1)
        self.assertEqual(self.call('search', pdf_start=1, pdf_end=3, limit=1, offset=1)['results'][0]['pdf_page'], 2)
        self.store.close()
        self.store = Workspace(self.root)
        self.assertEqual(self.call('search', book_page='563')['results'][0]['pdf_page'], 2)
        response = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'workspace.py'), str(self.root)],
                                  input=json.dumps(dict(action='textbook', args=dict(action='search', file=self.file['id'], query='arc length'))),
                                  text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(response.stdout)['result']['results'][0]['book_page'], '563')

    def test_late_page_after_whole_book_text_limit_on_both_backends(self):
        pages = [['Reference material for definitions and reasoning on this page.'] * 4 for _ in range(600)]
        pages[597] = ['Arc length derivation is on this original page.']
        self.file = self.upload(pdf(pages), '长教材.pdf')
        for backend in ('0', '1'):
            if backend == '0' and (os.environ.get('STUDY_NATIVE') == '1' or
                                   not all(shutil.which(command) for command in ('pdftotext', 'pdftoppm'))):
                continue
            if backend == '1' and not importlib.util.find_spec('pypdfium2'):
                continue
            if backend == '1':
                self.file = self.upload(pdf(pages).replace(b'%PDF-1.4', b'%PDF-1.5'), '原生长教材.pdf')
            with patch.dict(os.environ, {'STUDY_NATIVE': backend}):
                state = self.index(chapters=[dict(number='8.1', title='Arc Length', pdf_start=598, pdf_end=599)],
                                   page_map=[dict(pdf_start=36, pdf_end=600, book_start=1)])
                self.assertEqual(state['pages'], 600)
                first_text = self.store.perform('read', {'file': self.file['id']})['text']
                self.assertEqual(len(first_text), 100000)
                self.assertNotIn('Arc length derivation', first_text)
                result = self.call('search', query='arc length', chapter='8.1')['results'][0]
                self.assertEqual((result['pdf_page'], result['book_page']), (598, '563'))
                self.assertIn('original page', self.call('read', pdf_page=598)['text'])
                self.assertTrue(self.store.perform('page', {'file': self.file['id'], 'page': 598, 'expected': self.file['sha256']})['images'])

    def test_reuse_text_but_keep_books_and_courses_separate(self):
        self.store.perform('course', dict(code='DEMO_A', name='第一门课'))
        self.store.perform('course', dict(code='DEMO_B', name='第二门课'))
        for code in ('DEMO_A', 'DEMO_B'):
            folder = self.root / code
            folder.mkdir(exist_ok=True)
            (folder / 'COURSE.md').write_text('本课程使用测试教材进行索引定位；尚无作答。', encoding='utf-8')
        self.store.perform('publish', dict(file=self.file['id'], course='DEMO_A', path='materials/book.pdf', reason='测试教材归属第一门课'))
        self.index(title='First book')
        with patch('textbooks.pdf_tools.page_texts', side_effect=AssertionError('Must reuse index')):
            self.assertTrue(self.index(page_map=[dict(pdf_start=2, book_start=10)])['reused_page_text'])
            second = self.store.perform('create', dict(name='另一门课的教材.pdf', mime='application/pdf',
                course='DEMO_B', category='materials', data=base64.b64encode(self.store.content(self.store.file(self.file['id']))).decode()))
            result = self.store.perform('textbook', dict(action='index', file=second['id'], expected=second['sha256'], title='Second book'))
            self.assertTrue(result['reused_page_text'])
            self.assertEqual(result['page_map'], [])
            self.assertEqual(result['source']['course'], 'DEMO_B')
        self.assertEqual(self.call('search', query='arc length')['results'][0]['book_page'], '10')
        self.assertEqual(self.call('status')['source']['title'], 'First book')
        self.assertEqual(self.call('status')['source']['course'], 'DEMO_A')

    def test_no_extractable_text_is_reported_without_fabricating_content(self):
        self.file = self.upload(pdf([[], []]), '扫描教材示例.pdf')
        state = self.index()
        self.assertEqual(state['searchable_pages'], 0)
        self.assertEqual(state['empty_text_page_count'], 2)
        self.assertTrue(state['warning'])
        result = self.call('search', query='arc length')
        self.assertEqual(result['results'], [])
        self.assertTrue(result['warning'])
        self.assertEqual(self.call('read', pdf_page=1)['text'], '')

    def test_moving_and_renaming_preserve_current_index(self):
        self.index(title='Example Calculus')
        folder = self.store.perform('folder', dict(name='教材'))
        self.store.perform('metadata', dict(expected=self.store.version(), files=[dict(id=self.file['id'], name='教材新版名称.pdf', folder=folder['id'])]))
        result = self.call('search', query='arc length')
        self.assertEqual(result['source']['name'], '教材新版名称.pdf')
        self.assertEqual(result['source']['title'], 'Example Calculus')
        self.assertEqual(result['results'][0]['pdf_page'], 2)

    def test_failed_extraction_rolls_back_all_pages_and_can_retry(self):
        def broken(source):
            yield 1, 'partial page'
            raise ValueError('interrupted extraction')
        with patch('textbooks.pdf_tools.page_texts', broken), self.assertRaises(ValueError):
            self.index()
        self.assertFalse(self.call('status')['ready'])
        self.assertEqual(self.store.conn.execute('SELECT count(*) FROM textbook_pages').fetchone()[0], 0)
        self.assertTrue(self.index()['ready'])
        self.assertEqual(len(self.call('search', query='arc length')['results']), 1)

    def test_map_validation_and_keyword_escaping(self):
        self.index(page_map=[dict(pdf_start=2, book_start=563)])
        for args in [dict(page_map=[dict(pdf_start=1, pdf_end=4, book_start=1)]),
                     dict(page_map=[dict(pdf_start=1, pdf_end=2, book_start=1), dict(pdf_start=2, book_start=99)]),
                     dict(chapters=[dict(number='1', title='Invalid', pdf_start=2, pdf_end=1)]),
                     dict(expected='stale')]:
            with self.assertRaises(ValueError):
                self.call('index', **{'expected': self.file['sha256'], **args})
        self.assertEqual(self.call('search', book_page='563')['results'][0]['pdf_page'], 2)
        for args in [dict(book_page='999'), dict(chapter='unmapped'), dict(query='!!!'), dict(query='arc', limit=31), dict(query='arc', pdf_end=4)]:
            with self.assertRaises(ValueError): self.call('search', **args)
        self.assertEqual(self.call('search', query='arc" OR nonexistent')['results'], [])
        self.assertTrue(self.call('search', query='arc')['results'])
        self.assertTrue(self.call('read', pdf_page=3)['warning'])

    def test_changed_source_and_removed_file_cannot_return_old_locations(self):
        self.index(page_map=[dict(pdf_start=2, book_start=563)])
        old_hash = self.file['sha256']
        current = self.store.file(self.file['id'])
        current['sha256'] = self.store.blob(pdf([['A replacement book has different pages.']]))
        self.store.save_file(current)
        self.file = current
        self.assertEqual(self.call('status')['reason'], 'source_changed')
        with self.assertRaises(ValueError): self.call('search', query='arc length')
        with self.assertRaises(ValueError): self.call('index', expected=old_hash)
        self.assertEqual(self.index()['page_map'], [])
        with self.assertRaises(ValueError): self.store.perform('page', dict(file=current['id'], page=1, expected=old_hash))
        self.store.perform('remove_file', dict(file=current['id'], expected=current['sha256']))
        with self.assertRaises(ValueError): self.call('search', query='replacement')
        self.store.perform('restore_file', dict(file=current['id'], expected=current['sha256']))
        self.assertTrue(self.call('search', query='replacement')['results'])

    def test_backup_restore_and_archived_reading(self):
        self.index(page_map=[dict(pdf_start=2, book_start=563)])
        library = Semesters(self.root)
        with library.export('initial') as backup:
            restored = library.import_backup(backup, library.load()['version'])
        identifier = restored['id']
        restored_store = Workspace(library.directory(identifier))
        try:
            result = restored_store.perform('textbook', dict(action='search', file=self.file['id'], query='arc length'))
            self.assertEqual(result['results'][0]['book_page'], '563')
            self.assertTrue(result['source']['path'].startswith(str(restored_store.root)))
        finally:
            restored_store.close()
        library.change('archive', dict(semester='initial', expected=library.load()['version'], reason='用户结束学期'))
        self.assertTrue(self.call('search', query='arc length')['results'])
        self.assertTrue(self.store.perform('page', dict(file=self.file['id'], page=2))['images'])
        with self.assertRaises(ValueError): self.index()


if __name__ == '__main__':
    unittest.main()
