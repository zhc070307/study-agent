"""Optional installs, actual process orchestration, provenance and recovery."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from transcription import Transcription
from workspace import Workspace, MAX_FILE
from transcription_fixture import install_fixture


class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.env_patch=patch.dict(os.environ,{"STUDY_TRANSCRIBE_CPU":"1"});self.env_patch.start();self.addCleanup(self.env_patch.stop)
        self.resources_patch=patch('transcription.memory_available',return_value=16*1024**3);self.resources_patch.start()
        self.addCleanup(self.resources_patch.stop)
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.store=Workspace(self.root);self.tool=Transcription(self.root)
        self.folder=self.store.perform('folder',{'name':'课程材料'})
        self.audio=self.store.perform('create',{'name':'第一讲.wav','mime':'audio/wav','data':base64.b64encode(b'fixture audio').decode(),'folder':self.folder['id']})
        self.args={'file':self.audio['id'],'expected':self.audio['sha256']}
    def tearDown(self):self.store.close();self.temp.cleanup()
    def wait(self,job):
        for unused in range(100):
            record=next(item for item in self.tool.records() if item['id']==job['id'])
            if record['status']!='running':return record
            time.sleep(0.05)
        self.fail('scripted worker did not finish')
    def test_existing_text_needs_no_install_and_audio_requests_consent(self):
        text=self.store.perform('create',{'name':'教师讲稿.txt','text':'已有文字稿'})
        with self.assertRaises(ValueError):self.tool.start({'file':text['id'],'expected':text['sha256']})
        self.assertTrue(self.tool.start(self.args)['needs_install'])
        self.assertFalse(self.tool.shared.exists())
        self.assertFalse(self.tool.status()['installed'])
    def test_worker_saves_transcript_in_original_folder_with_source_and_retry(self):
        install_fixture(self.tool)
        first=self.tool.start(self.args)
        with self.assertRaises(ValueError):self.tool.start(self.args)
        record=self.wait(first)
        self.assertEqual(record['status'],'completed',record)
        saved=self.store.perform('read',{'file':record['transcript']})
        self.assertEqual(saved['folder'],self.folder['id'])
        self.assertEqual(saved['sources'],[self.audio['id']])
        self.assertEqual(saved['transcription']['source_sha256'],self.audio['sha256'])
        self.assertIn('脚本化',saved['text'])
        self.assertEqual(self.tool.start(self.args)['id'],first['id'])
        self.assertEqual(self.store.content(self.store.file(self.audio['id'])),b'fixture audio')
    def test_stop_resume_and_restart_detection(self):
        install_fixture(self.tool)
        job=self.tool.start(self.args)
        self.tool.stop({'job':job['id']})
        record=self.wait(job)
        self.assertIn(record['status'],('stopped','interrupted'))
        resumed=self.tool.start(self.args)
        self.assertEqual(resumed['id'],job['id'])
        self.assertEqual(self.wait(resumed)['status'],'completed')
        path=self.tool.jobs/job['id']/'job.json'
        stale=json.loads(path.read_text());stale['status']='running';path.write_text(json.dumps(stale))
        self.assertEqual(self.tool.records()[0]['status'],'interrupted')
    def test_insufficient_resources_prevent_download_even_with_consent(self):
        with patch('transcription.memory_available',return_value=4*1024**3):
            result=self.tool.start(dict(self.args,allow_install=True))
            self.assertTrue(result['blocked'])
            self.assertFalse(self.tool.shared.exists())
        with patch('transcription.shutil.disk_usage') as usage:
            usage.return_value.free=1024**3
            self.assertTrue(self.tool.start(dict(self.args,allow_install=True))['blocked'])
            self.assertFalse(self.tool.shared.exists())
    def test_default_never_selects_cpu(self):
        with patch.dict(os.environ,{"STUDY_TRANSCRIBE_CPU":"0"}):
            result=self.tool.start(dict(self.args,allow_install=True))
            self.assertTrue(result['blocked'])
            self.assertIsNone(result['resources']['backend'])
            self.assertFalse(self.tool.shared.exists())
    def test_audio_limit_is_separate_from_other_files(self):
        value=base64.b64encode(b'x'*(MAX_FILE+1)).decode()
        self.store.perform('create',{'name':'长录音.mp3','mime':'audio/mpeg','data':value})
        with self.assertRaises(ValueError):self.store.perform('create',{'name':'超大文件.txt','mime':'text/plain','data':value})
    def test_failed_pdf_inspection_keeps_previous_result_and_failure_record(self):
        source=self.store.perform('create',{'name':'笔记.tex','text':r'\documentclass{article}\begin{document}Test\end{document}'})
        first=self.store.compile({'file':source['id'],'expected':source['sha256']},'first-pdf')
        self.assertTrue(first['ok'],first['log'])
        prior=self.store.file(source['id'])['pdf']
        original=__import__('subprocess').run
        def missing(command,**kwargs):
            if command[0]=='pdfinfo': raise FileNotFoundError('pdfinfo')
            return original(command,**kwargs)
        with patch('workspace.subprocess.run',side_effect=missing):
            failed=self.store.compile({'file':source['id'],'expected':source['sha256']},'missing-pdfinfo')
        self.assertFalse(failed['ok'])
        self.assertEqual(self.store.file(source['id'])['pdf'],prior)
        self.assertEqual(self.store.file(source['id'])['compile_result']['ok'],False)
