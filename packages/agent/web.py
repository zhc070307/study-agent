"""Single-user cloud web entry. Reuses the upstream SDK, not a second model loop."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote

from workspace import Workspace, encoded, PROJECT, MAX_FILE
from run import patch, runtime_command
from semesters import Semesters
from urllib.parse import parse_qs
from functools import wraps

def serialized(method):
    @wraps(method)
    def request(self):
        # A compile must not block status/stop. Selection changes instead refuse in-flight HTTP work.
        if urlsplit(self.path).path in ('/api/semesters','/api/semester-export'):
            with self.server.lifecycle_lock:
                if self.server.pending_operations:
                    return self.reply({'error':'文件操作尚未完成，请稍后再管理学期'},409)
                return method(self)
        with self.server.lifecycle_lock:self.server.pending_operations+=1
        try:return method(self)
        finally:
            with self.server.lifecycle_lock:self.server.pending_operations-=1
    return request

class Runtime:
    def __init__(self, root, *, provider='deepseek-official', model='deepseek-flash', extra_patch=None):
        self.root, self.provider, self.model = root, provider, model
        self.extra_patch = extra_patch or []
        self.lock = threading.RLock()
        self.start_lock = threading.Lock()
        self.prompt_lock = threading.Lock()
        self.process = None
        self.pending = {}
        self.serial = 0
        self.active = None
        self.status = 'idle'
        self.error = None
        self.turn_error = None
        self.interrupted = False
        self.temp = None
        with self.store() as store:
            store.conn.execute('CREATE TABLE IF NOT EXISTS desktop_turns (id TEXT PRIMARY KEY, channel TEXT NOT NULL, status TEXT NOT NULL)')
            for row in store.conn.execute("SELECT id,channel FROM desktop_turns WHERE status='running'").fetchall():
                self.interrupted=True
                store.message('interrupted-'+row[0],row[1],{'role':'assistant','text':'上次处理被中断，已保存的文件和记录仍保留。可继续提出要求。','error':True})
            store.conn.execute("UPDATE desktop_turns SET status='interrupted' WHERE status='running'")

    def store(self):
        class Managed(Workspace):
            def __enter__(self): return self
            def __exit__(self,*args): self.close()
        return Managed(self.root)

    def request(self, method, params=None):
        with self.lock:
            if not self.process or self.process.poll() is not None: raise RuntimeError('助理进程未启动')
            self.serial += 1
            identifier = self.serial
            reply = queue.Queue()
            self.pending[identifier] = reply
            self.process.stdin.write(encoded(dict(jsonrpc='2.0',id=identifier,method=method,params=params or {}))+'\n')
            self.process.stdin.flush()
        try:
            result = reply.get(timeout=30)
            if 'error' in result: raise RuntimeError(result['error'].get('message','助理请求失败'))
            return result['result']
        finally:
            with self.lock: self.pending.pop(identifier,None)

    def start(self):
        with self.start_lock:self._start()

    def _start(self):
        if self.process and self.process.poll() is None: return
        self.temp = tempfile.TemporaryDirectory(prefix='study-web-')
        overlay = Path(self.temp.name)/'patch.json'
        overlay.write_text(encoded(patch(self.root)+self.extra_patch))
        self.diagnostics = tempfile.TemporaryFile(mode='w+')
        self.process = subprocess.Popen(runtime_command('--patch',str(overlay)),cwd=PROJECT,env=dict(os.environ,DSH_HOME=str(self.root/'.harness')),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.diagnostics,text=True,bufsize=1,start_new_session=True)
        threading.Thread(target=self.read,args=(self.process,),daemon=True).start()
        try:
            self.request('initialize',{'cwd':str(self.root),'provider':self.provider,'model':self.model})
        except Exception:
            self.kill()
            raise

    def read(self, process):
        try:
            for line in process.stdout:
                frame = json.loads(line)
                if 'id' in frame:
                    with self.lock:
                        target = self.pending.get(frame['id'])
                    if target: target.put(frame)
                else:
                    if self.process is process: self.notification(frame)
        except Exception:
            self.error = '助理连接中断'
        finally:
            with self.lock:
                if self.process is process:
                    for target in self.pending.values(): target.put({'error':{'message':'助理进程退出，请检查模型配置或重试'}})
                if self.process is process and self.active:
                    self.finish('助理进程退出，已保存的结果仍保留。')

    def notification(self, frame):
        params = frame.get('params',{})
        session = params.get('sessionId','')
        if not session.startswith('desktop-'): return
        channel = session[8:]
        with self.store() as store:
            event = params.get('event',{})
            if event.get('type')=='assistant/message':
                message = event.get('data',{}).get('message',{})
                text = '\n'.join(block['text'] for block in message.get('content',[]) if block.get('type')=='text')
                if text: store.message(message['id'],channel,{'role':'assistant','text':text})
            elif event.get('type')=='turn/end':
                reason = event.get('data',{}).get('reason',{})
                if reason.get('kind') not in ('completed',None):
                    self.turn_error = '本次处理未完成，已保存的结果仍保留。'
        if frame.get('method')=='session.status' and params.get('status')=='idle':
            with self.lock:
                if self.active==channel: self.finish(self.turn_error)

    def finish(self,error=None):
        channel = self.active
        if channel:
            with self.store() as store:
                store.conn.execute("UPDATE desktop_turns SET status=? WHERE channel=? AND status='running'",('error' if error else 'completed',channel))
                if error: store.message(uuid.uuid4().hex,channel,{'role':'assistant','text':error,'error':True})
        self.active=None
        self.status='idle'
        self.error=error
        self.turn_error=None

    def prompt(self,args):
        with self.prompt_lock:return self._prompt(args)

    def _prompt(self,args):
        channel = args.get('channel','desktop')
        with self.store() as store:
            if channel!='desktop': store.file(channel)
            text = args.get('text','').strip()
            if not text or len(text)>20000: raise ValueError('请输入问题（不超过两万字）')
            context=[]
            for identifier in args.get('files',[]):
                file=store.file(identifier)
                context.append({'id':identifier,'name':file['name'],'sha256':file['sha256']})
            quote=args.get('quote')
            if quote:
                file=store.file(quote['file'])
                if quote.get('sha256') and quote['sha256']!=file['sha256']: raise ValueError('选区对应文件已变化，请重新选择')
                quote=dict(file=file['id'],text=str(quote.get('text',''))[:20000],source=str(quote.get('source',''))[:100],sha256=file['sha256'])
            refs=' · '.join(item['name'] for item in context)
            if quote: refs+=' · '+quote['source']+'：'+quote['text'][:80]
            identifier=args['id']
            if store.conn.execute('SELECT 1 FROM desktop_turns WHERE id=?',(identifier,)).fetchone(): return {'accepted':True}
        with self.lock:
            if self.active and self.active!=channel: raise ValueError('助理正在处理另一份文件，请先停止或稍后发送')
            self.active=channel
            self.status='running'
            self.error=None
        try:
            self.start()
            with self.store() as store:
                store.message(identifier,channel,dict(role='user',text=text,refs=refs))
                store.conn.execute('INSERT INTO desktop_turns VALUES (?,?,?)',(identifier,channel,'running'))
            content = encoded({'用户要求':text,'关联文件':context,'选区或作答':quote})
            self.request('session/prompt',{'sessionId':'desktop-'+channel,'contentBlocks':[{'type':'text','text':content}]})
            return {'accepted':True}
        except Exception as error:
            with self.lock:
                if self.active==channel:self.finish('助理无法完成请求，请检查云端模型配置后重试。')
            raise RuntimeError('助理请求失败，请检查云端模型配置') from error

    def kill(self):
        with self.lock:
            process=self.process
            self.process=None
            for target in self.pending.values():target.put({'error':{'message':'请求已停止'}})
        if process and process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL)
                process.wait(timeout=5)
        if self.temp: self.temp.cleanup(); self.temp=None
        if hasattr(self,'diagnostics'): self.diagnostics.close()

    def stop(self):
        with self.lock: self.finish('已停止，已保存的文件和作答仍保留。')
        self.kill()
        return {'stopped':True}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass

    def reply(self,value,status=200):
        data=encoded(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(data)

    def trusted(self):
        expected=f'127.0.0.1:{self.server.server_port}'
        # This entry stays private to an authenticated cloud proxy; no public unauthenticated bind.
        host=self.headers.get('Host','')
        if host not in (expected,f'localhost:{self.server.server_port}'): raise ValueError('请求地址不匹配')
        origin=self.headers.get('Origin')
        if origin and origin not in ('http://'+host,'https://'+host): raise ValueError('请求来源不匹配')
        if self.headers.get('Sec-Fetch-Site')=='cross-site': raise ValueError('不接受跨站请求')

    @serialized
    def do_GET(self):
        store=None
        try:
            self.trusted()
            path=unquote(urlsplit(self.path).path)
            if path=='/api/semester-export':
                if self.server.runtime.status=='running':raise ValueError('请先停止助理，再下载学期备份')
                identifier=parse_qs(urlsplit(self.path).query).get('semester',[None])[0]
                if not identifier:raise ValueError('请选择要下载的学期')
                with self.server.semesters.export(identifier) as data:
                    self.send_response(200)
                    self.send_header('Content-Type','application/zip')
                    self.send_header('Content-Disposition','attachment; filename=study-semester.zip')
                    self.send_header('Cache-Control','no-store')
                    self.end_headers()
                    import shutil
                    shutil.copyfileobj(data,self.wfile)
                return
            if path=='/api/state':
                with self.server.lifecycle_lock:
                    data=self.server.semesters.load()
                    if data.get('pending') and self.server.runtime.error:
                        self.server.semesters.change('cancel',{'expected':data['version']})
                        data=self.server.semesters.load()
                    if data.get('pending') and self.server.runtime.status=='idle' and self.server.pending_operations==1:
                        self.server.semesters.change('switch',{'semester':data['pending']['semester'],'expected':data['version']})
                        root=self.server.semesters.directory()
                        if root!=self.server.root:
                            self.server.runtime.stop()
                            self.server.root=root
                            self.server.runtime=Runtime(root,**self.server.runtime_options)
                store=Workspace(self.server.root)
                state=store.snapshot()
                state['semesters']=self.server.semesters.load()
                state['runtime']={'active':self.server.runtime.active,'status':self.server.runtime.status,'error':self.server.runtime.error}
                return self.reply(state)
            if path.startswith('/api/file/'):
                self.current_semester()
                store=Workspace(self.server.root)
                file=store.file(path.rsplit('/',1)[1])
                data=store.content(file)
                mime=file['mime']
                # HTML/SVG uploads never execute in the application's origin.
                if mime not in ('application/pdf','image/png','image/jpeg','image/gif','image/webp','audio/mpeg','audio/wav','audio/ogg'):
                    mime='text/plain; charset=utf-8' if file['mime'].startswith('text/') else 'application/octet-stream'
            else:
                target=(PROJECT/'ui'/path.lstrip('/')).resolve() if path!='/' else PROJECT/'ui/index.html'
                if not target.is_relative_to(PROJECT/'ui') or not target.is_file(): return self.reply({'error':'未找到文件'},404)
                data=target.read_bytes()
                import mimetypes
                mime=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                if target.suffix=='.mjs': mime='text/javascript'
            self.send_response(200)
            self.send_header('Content-Type',mime)
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as error: self.reply({'error':str(error)},400)
        finally:
            if store: store.close()

    def current_semester(self, supplied=None):
        data=self.server.semesters.load()
        supplied=supplied or self.headers.get('X-Study-Semester') or parse_qs(urlsplit(self.path).query).get('semester',[None])[0]
        if supplied!=data['active'] and (supplied or data['version']>0):raise ValueError('学期已切换，请刷新后继续')

    @serialized
    def do_POST(self):
        store=None
        try:
            self.trusted()
            if self.headers.get('Content-Type','').split(';')[0]!='application/json': raise ValueError('请发送 JSON')
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>MAX_FILE*2: raise ValueError('请求大小无效')
            args=json.loads(self.rfile.read(size))
            path=urlsplit(self.path).path
            if path=='/api/semesters':
                if self.server.runtime.status=='running':raise ValueError('请先停止助理或等待处理完成，再管理学期')
                value=self.server.semesters.change(args['action'],args.get('args',{}))
                root=self.server.semesters.directory()
                if root!=self.server.root:
                    self.server.runtime.stop()
                    self.server.root=root
                    self.server.runtime=Runtime(root,**self.server.runtime_options)
                return self.reply(value)
            self.current_semester(args.get('semester'))
            if self.server.semesters.item()['status']!='open' and path!='/api/stop' and not (path=='/api/workspace' and args.get('action') in ('read','history')):
                raise ValueError('这个学期已归档，文件可查看和下载；重新开始后可以修改或提问')
            if path=='/api/chat': return self.reply(self.server.runtime.prompt(args))
            if path=='/api/stop':
                data=self.server.semesters.load()
                if data.get('pending'):self.server.semesters.change('cancel',{'expected':data['version']})
                return self.reply(self.server.runtime.stop())
            if path!='/api/workspace': return self.reply({'error':'未找到操作'},404)
            if args['action'] not in ('remove_file','restore_file','create','metadata','write','restore','history','folder','task','check_task','answer','draft','compile','read','page'):
                raise ValueError('此操作请交由助理核验')
            store=Workspace(self.server.root)
            return self.reply(store.perform(args['action'],args.get('args',{}),args.get('id','')))
        except Exception as error: self.reply({'error':str(error)},400)
        finally:
            if store: store.close()

def create_server(root,port=0,**runtime_options):
    root=Path(root).resolve()
    root.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.lifecycle_lock=threading.RLock()
    server.pending_operations=0
    server.semesters=Semesters(root)
    server.root=server.semesters.directory()
    server.runtime_options=runtime_options
    server.runtime=Runtime(server.root,**runtime_options)
    data=server.semesters.load()
    if data.get('pending') and server.runtime.interrupted:server.semesters.change('cancel',{'expected':data['version']})
    return server

def main():
    parser=argparse.ArgumentParser(description='学习桌云端服务（仅监听回环地址）')
    parser.add_argument('--data',type=Path,default=PROJECT/'.data')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--model',default=os.environ.get('STUDY_MODEL','deepseek-flash'))
    args=parser.parse_args()
    server=create_server(args.data,args.port,model=args.model)
    print(f'Study Agent: http://127.0.0.1:{server.server_port}',flush=True)
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.runtime.stop(); server.server_close()

if __name__=='__main__': main()
