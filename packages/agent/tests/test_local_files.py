import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from web import create_server

class LocalFileTests(unittest.TestCase):
    def test_real_course_path_unfiled_copy_and_external_edit_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Workspace(directory)
            try:
                course=store.perform('course',{'code':'TEST','name':'课程'})
                file=store.perform('create',{'name':'中文笔记.md','text':'课程原文','folder':course['folders']['notes']})
                target=Path(store.local_file(file['id']))
                self.assertEqual(target,Path(directory)/'TEST/notes/中文笔记.md')
                self.assertEqual(target.read_text(encoding='utf-8'),'课程原文')
                target.write_text('外部修改',encoding='utf-8')
                self.assertEqual(Path(store.local_file(file['id'])).read_text(encoding='utf-8'),'外部修改')
                incoming=store.perform('create',{'name':'未整理.txt','text':'待整理材料'})
                preview=Path(store.local_file(incoming['id']))
                self.assertEqual(preview.name,'未整理.txt');self.assertEqual(preview.read_text(encoding='utf-8'),'待整理材料')
                with self.assertRaises(ValueError):store.local_file('../settings')
            finally:store.close()

    def test_only_native_bridge_can_resolve_a_path_and_old_semester_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            server=create_server(directory,provider='study-web-test');server.close_token='native-test-token'
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                store=Workspace(server.root)
                try:file=store.perform('create',{'name':'材料.txt','text':'内容'})
                finally:store.close()
                def request(token,semester='initial'):
                    req=Request(f'http://127.0.0.1:{server.server_port}/api/local-file',data=json.dumps({'file':file['id'],'token':token,'semester':semester}).encode(),headers={'Content-Type':'application/json'})
                    with urlopen(req) as response:return json.load(response)
                with self.assertRaises(HTTPError):request('browser-cannot-guess-token')
                self.assertEqual(Path(request('native-test-token')['path']).read_text(encoding='utf-8'),'内容')
                with self.assertRaises(HTTPError):request('native-test-token','previous-semester')
            finally:server.runtime.stop();server.shutdown();server.server_close();thread.join()
