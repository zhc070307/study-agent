"""Check the exact staged native runtime on its target platform, without remote inference."""
import argparse
import base64
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
bundled_node=PROJECT/('node.exe' if os.name=='nt' else 'node')
os.environ.update(STUDY_NATIVE='1',STUDY_NODE=str(bundled_node) if bundled_node.exists() else os.environ.get('STUDY_NODE','node'))
sys.path.insert(0,str(PROJECT/'packages/agent'))
from workspace import Workspace
from web import Runtime
from settings import Settings
from semesters import Semesters
from agreements import save,read_all

with tempfile.TemporaryDirectory(prefix='学习桌面-native-') as temporary:
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
 toolCallResponse('service','study_work',{action:'service',input:JSON.stringify({arguments:['task','--help']})}),
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
            raise AssertionError((runtime.error,getattr(runtime,'last_turn_reason',None),runtime.diagnostics.read(),[path.read_text(encoding='utf-8')[-5000:] for path in (root/'.harness').rglob('*.jsonl')]))
        store=Workspace(root)
        try:
            state=store.snapshot()
            assert state['courses'][0]['code']=='DEMO'
            assert any('原生运行检查完成' in message['text'] for message in state['messages']['desktop'])
        finally:store.close()
        # Reuse the same saved conversation in a fresh bundled SDK process.
        runtime.kill()
        model.write_text("""import {MockAdapter,textResponse} from './adapter.ts';
export const name='native-check';export const inject=['llm'];
export function apply(ctx){ctx.llm.registerAdapter(['native-check'],new MockAdapter([
 options=>{const history=JSON.stringify(options.messages.slice(0,-1));
 if(!history.includes('检查原生学习工具')||!history.includes('原生运行检查完成'))throw new Error('Saved conversation was not restored');
 if(options.model!=='restart-check')throw new Error('Current model was not selected');
 return textResponse('原生会话恢复检查完成');}
]));}
""",encoding='utf-8')
        runtime.model='restart-check'
        runtime.prompt({'id':uuid.uuid4().hex,'channel':'desktop','text':'继续原来的对话','files':[]})
        deadline=time.monotonic()+60
        while runtime.status=='running' and time.monotonic()<deadline:time.sleep(.1)
        if runtime.status!='idle' or runtime.error:
            runtime.diagnostics.seek(0)
            raise AssertionError((runtime.status,runtime.error,getattr(runtime,'last_turn_reason',None),runtime.diagnostics.read()))
        with runtime.store() as store:
            assert any('原生会话恢复检查完成' in message['text'] for message in store.snapshot()['messages']['desktop'])
        # Check deletion with the actual bundled Node and native kernel lease.
        runtime.manage_chat({'action':'archive','channel':'desktop'})
        assert next(chat for chat in runtime.conversation()['chats'] if chat['channel']=='desktop')['status']=='archived'
        runtime.manage_chat({'action':'restore','channel':'desktop'})
        runtime.manage_chat({'action':'delete','channel':'desktop'})
        assert 'desktop' not in runtime.conversation()['messages']
        assert not any('检查原生学习工具' in path.read_text(encoding='utf-8') for path in (root/'.harness').rglob('*.jsonl'))
    finally:runtime.stop()
    from pdf_tools import text
    tex=r'''\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{amsmath,amssymb,graphicx,geometry,booktabs,enumitem,xcolor,hyperref,tikz,siunitx,mathtools,tcolorbox,pgfplots}
\begin{document}中文安装检查：函数 $f(x)=x^2$。textbooklookup.\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}\end{document}'''
    store=Workspace(root)
    try:
        source=store.perform('create',{'name':'中文笔记.tex','data':base64.b64encode(tex.encode('utf-16')).decode(),'mime':'text/x-tex','course':'DEMO','category':'notes'})
        result=store.compile({'file':source['id'],'expected':source['sha256']},'native-pdf')
        assert result['ok'],result['log']
        pdf=store.file(store.file(source['id'])['pdf']['file'])
        assert '中文安装检查' in text(store.blobs/pdf['sha256'])
        assert store.page({'file':pdf['id'],'page':1})['images'][0]['data']
        indexed=store.perform('textbook',{'action':'index','file':pdf['id'],'expected':pdf['sha256'],'title':'原生排版示例','page_map':[{'pdf_start':1,'book_start':1}]})
        assert indexed['ready'] and indexed['searchable_pages']>0
        matches=store.perform('textbook',{'action':'search','file':pdf['id'],'query':'textbooklookup'})
        assert matches['results'][0]['book_page']=='1'
        original=store.perform('textbook',{'action':'read','file':pdf['id'],'pdf_page':1,'expected':pdf['sha256']})
        assert '中文安装检查' in original['text']
        practice=store.perform('create',{'name':'练习.md','text':'求函数的导数。','kind':'practice','course':'DEMO','sources':[pdf['id']]})
        store.perform('answer',{'file':practice['id'],'text':'独立作答：2x。'})
        task=store.perform('task',{'title':'完成独立练习','file':practice['id'],'date':''})
        store.perform('check_task',{'task':task['id'],'done':True})
        store.perform('metadata',{'expected':store.version(),'files':[{'id':practice['id'],'name':'中文练习修订.md'}]})
        store.perform('remove_file',{'file':practice['id'],'expected':practice['sha256']})
        store.perform('restore_file',{'file':practice['id'],'expected':practice['sha256']})
        assert '.settings' not in json.dumps(store.snapshot(),ensure_ascii=False)
        before=store.snapshot()
    finally:store.close()
    library=Semesters(root)
    with library.export('initial') as data:
        import zipfile
        with zipfile.ZipFile(data) as archive:assert not any(name.startswith(('.settings/','.transcription/')) for name in archive.namelist())
        data.seek(0)
        imported=library.import_backup(data,library.load()['version'])
    restored=Workspace(library.directory(imported['id']))
    try:
        state=restored.snapshot()
        assert state['answers']==before['answers'] and state['tasks']==before['tasks']
        assert [(f['id'],f['sha256']) for f in state['files']]==[(f['id'],f['sha256']) for f in before['files']]
        assert restored.perform('textbook',{'action':'search','file':pdf['id'],'query':'中文安装检查'})['results']
        assert library.load()['active']=='initial'
        assert restored.conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not restored.conn.execute('PRAGMA foreign_key_check').fetchall()
    finally:restored.close()
print('Native SDK restart/history/current model, archive/restore/delete, source resolution, course files, UTF-8, memory locks, real Chinese PDF and persistent textbook index passed; no remote inference.')
