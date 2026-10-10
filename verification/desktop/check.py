"""Check the exact staged native runtime on its target platform, without remote inference."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

SOURCE=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--runtime',type=Path,default=SOURCE);args=parser.parse_args()
PROJECT=args.runtime.resolve()
os.environ.update(STUDY_NATIVE='1',STUDY_NODE=str(PROJECT/('node.exe' if os.name=='nt' else 'node')) if (PROJECT/('node.exe' if os.name=='nt' else 'node')).exists() else 'node')
sys.path.insert(0,str(PROJECT/'packages/agent'))
from workspace import Workspace
from web import Runtime
from settings import Settings
from semesters import Semesters
from agreements import save,read_all

with tempfile.TemporaryDirectory(prefix='study-native-') as temporary:
    root=Path(temporary)
    tex_root=PROJECT.parent/'desktop-tex'
    if not tex_root.exists():tex_root=PROJECT.parent/'tex'
    if tex_root.exists():
        tex_bin=tex_root/'bin'/('windows' if os.name=='nt' else 'universal-darwin')
        os.environ['PATH']=str(tex_bin)+os.pathsep+os.environ['PATH']
        os.environ['TEXMFVAR']=str(root/'tex-cache');os.environ['TEXMFCONFIG']=str(root/'tex-config')
    settings=Settings(root)
    assert not settings.status()['configured'] or os.environ.get('DEEPSEEK_API_KEY')
    settings.save({'api_key':'local-check-only','model':'deepseek-flash','timezone':'Asia/Hong_Kong'})
    assert 'api_key' not in settings.status()
    save(root,{'scope':'learning','key':'沟通','text':'简洁自然','reason':'用户明确要求','expected':0},'memory-check')
    assert read_all(root)['references'][0]['text']=='简洁自然'
    with (root/'adapter.ts').open('w',encoding='utf-8') as out:
        out.write((SOURCE/'packages/runtime/modules/core/agent-loop/tests/mock-adapter.ts').read_text(encoding='utf-8'))
    model=root/'model.ts'
    model.write_text("""import {MockAdapter,textResponse,toolCallResponse} from './adapter.ts';
export const name='native-check';export const inject=['llm'];
export function apply(ctx){ctx.llm.registerAdapter(['native-check'],new MockAdapter([
 toolCallResponse('standard','study_read',{standard:'note'}),
 toolCallResponse('course','study_desktop',{action:'course',input:JSON.stringify({code:'DEMO',name:'原生课程'})}),
 textResponse('原生运行检查完成')
]));}
""",encoding='utf-8')
    runtime=Runtime(root,provider='native-check',model='mock',extra_patch=[{'insert':[{'id':'native-check','name':str(model)}]}])
    try:
        try:runtime.prompt({'id':uuid.uuid4().hex,'channel':'desktop','text':'检查原生学习工具','files':[]})
        except Exception:
            print(getattr(runtime,'start_diagnostics','Startup failed before diagnostics were captured'),file=sys.stderr);raise
        deadline=time.monotonic()+60
        while runtime.status=='running' and time.monotonic()<deadline:time.sleep(.1)
        if runtime.status!='idle' or runtime.error:
            runtime.diagnostics.seek(0)
            raise AssertionError((runtime.error,runtime.diagnostics.read(),[path.read_text(encoding='utf-8')[-5000:] for path in (root/'.harness').rglob('*.jsonl')]))
        store=Workspace(root)
        try:
            state=store.snapshot()
            assert state['courses'][0]['code']=='DEMO'
            assert any('原生运行检查完成' in message['text'] for message in state['messages']['desktop'])
        finally:store.close()
    finally:runtime.stop()
    from pdf_tools import text
    tex=r'''\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{amsmath,amssymb,graphicx,geometry,booktabs,enumitem,xcolor,hyperref,tikz,siunitx,mathtools,tcolorbox,pgfplots}
\begin{document}中文安装检查：函数 $f(x)=x^2$。\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}\end{document}'''
    store=Workspace(root)
    try:
        source=store.perform('create',{'name':'中文笔记.tex','text':tex,'mime':'text/x-tex','course':'DEMO','category':'notes'})
        result=store.compile({'file':source['id'],'expected':source['sha256']},'native-pdf')
        assert result['ok'],result['log']
        pdf=store.file(store.file(source['id'])['pdf']['file'])
        assert '中文安装检查' in text(store.blobs/pdf['sha256'])
        assert store.page({'file':pdf['id'],'page':1})['images'][0]['data']
        assert '.settings' not in json.dumps(store.snapshot(),ensure_ascii=False)
    finally:store.close()
    with Semesters(root).export('initial') as data:
        import zipfile
        with zipfile.ZipFile(data) as archive:assert not any(name.startswith(('.settings/','.transcription/')) for name in archive.namelist())
print('Native SDK, source resolution, course files, UTF-8, memory locks and real Chinese PDF passed; no remote inference.')
