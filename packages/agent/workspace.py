"""Persistent desktop over the existing ledger; immutable file versions and real PDFs."""
from __future__ import annotations
import base64
import hashlib
import json
import mimetypes
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'packages/learning/src'))
from study_agent import db, delivery
from study_agent.service import TaskService
from study_agent.models import dataclass_dict
from study_agent.learning import LearningService
from agreements import read_all, read_only, library_root, save as save_agreement
from semesters import Semesters

MAX_FILE = 20 * 1024 * 1024
MAX_AUDIO = 200 * 1024 * 1024

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def uid():
    return uuid.uuid4().hex

def name(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 180:
        raise ValueError('名称不能为空且不能超过 180 字')
    return value.strip()

class Workspace:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = self.root / '.workspace/blobs'
        self.blobs.mkdir(parents=True, exist_ok=True)
        self.conn = db.initialize(self.root / '.study-system/data/task_memory.sqlite3')
        self.tasks = TaskService(self.conn)
        self.conn.executescript('''
          CREATE TABLE IF NOT EXISTS desktop_publications (path TEXT PRIMARY KEY, file TEXT NOT NULL, desired TEXT NOT NULL, published TEXT);
          CREATE TABLE IF NOT EXISTS desktop_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
          INSERT OR IGNORE INTO desktop_meta VALUES (1,0);
          CREATE TABLE IF NOT EXISTS desktop_files (id TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_history (id TEXT PRIMARY KEY, file TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_operations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_task_files (task TEXT PRIMARY KEY REFERENCES tasks(id), file TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_messages (id TEXT PRIMARY KEY, channel TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_drafts (channel TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_answers (id TEXT PRIMARY KEY, file TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_compiles (id TEXT PRIMARY KEY, file TEXT NOT NULL, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_preparations (id TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS desktop_views (compile TEXT NOT NULL, page INTEGER NOT NULL, PRIMARY KEY(compile,page));
        ''')
        self.publication_warnings=[] if read_only(self.root) else self.sync_publications()

    def sync_publications(self):
        with db.atomic(self.conn,bump_revision=False):
            return self._sync_publications()

    def _sync_publications(self):
        warnings=[]
        for row in self.conn.execute('SELECT * FROM desktop_publications').fetchall():
            target=(self.root/row['path']).resolve()
            if not target.is_relative_to(self.root) or target.is_relative_to(self.root/'.workspace'):
                warnings.append('课程文件路径变化，保留恢复记录');continue
            actual=hashlib.sha256(target.read_bytes()).hexdigest() if target.is_file() else None
            if actual==row['desired']:
                self.conn.execute('UPDATE desktop_publications SET published=desired WHERE path=?',(row['path'],));continue
            if actual!=row['published']:
                warnings.append('课程文件在桌面之外被修改：'+row['path']);continue
            try:
                target.parent.mkdir(parents=True,exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=target.parent,delete=False) as tmp:
                    tmp.write((self.blobs/row['desired']).read_bytes());temp=Path(tmp.name)
                temp.replace(target)
                self.conn.execute('UPDATE desktop_publications SET published=desired WHERE path=?',(row['path'],))
            except OSError as error:warnings.append(str(error))
        return warnings

    def close(self):
        self.conn.close()

    def version(self):
        return self.conn.execute('SELECT version FROM desktop_meta WHERE id=1').fetchone()[0]

    def bump(self):
        self.conn.execute('UPDATE desktop_meta SET version=version+1 WHERE id=1')

    def file(self, identifier):
        row = self.conn.execute('SELECT value FROM desktop_files WHERE id=?', (identifier,)).fetchone()
        if not row:
            raise ValueError('文件不存在')
        return json.loads(row[0])

    def content(self, file):
        return (self.blobs / file['sha256']).read_bytes()

    def blob(self, content, limit=MAX_FILE):
        if len(content) > limit:
            raise ValueError('文件超过 '+str(limit//1024//1024)+' MB')
        digest = hashlib.sha256(content).hexdigest()
        path = self.blobs / digest
        if not path.exists():
            # Write before the DB reference. An interrupted orphan is harmless; committed bytes are immutable.
            with tempfile.NamedTemporaryFile(dir=self.blobs, delete=False) as tmp:
                tmp.write(content)
                tmp.flush()
                import os
                os.fsync(tmp.fileno())
                temp = Path(tmp.name)
            temp.replace(path)
        return digest

    def public(self, file):
        result = dict(file, source='/api/file/' + file['id'], url='/api/file/' + file['id'] + '?v=' + file['sha256'])
        if file['mime'].startswith('text/') or Path(file['name']).suffix.lower() in ('.md', '.markdown', '.tex', '.txt'):
            result['text'] = self.content(file).decode('utf-8', errors='replace')
        return result

    def save_file(self, file):
        self.conn.execute('INSERT OR REPLACE INTO desktop_files VALUES (?,?)', (file['id'], encoded(file)))
        self.conn.execute('INSERT INTO desktop_history VALUES (?,?,?)', (uid(), file['id'], encoded(file)))

    def snapshot(self):
        files = [self.public(json.loads(row[0])) for row in self.conn.execute('SELECT value FROM desktop_files ORDER BY rowid')]
        trash=[f for f in files if f.get('removed')]
        files=[f for f in files if not f.get('removed')]
        files.sort(key=lambda file: file.get('order', 0))
        links = dict(self.conn.execute('SELECT task,file FROM desktop_task_files'))
        paths={key:f['id'] for f in files for key in ([f.get('course_path'),str(self.root/f['course_path'])] if f.get('course_path') else [])}
        paths.update({'desktop:'+f['id']:f['id'] for f in files})
        tasks = [dict(id=t.id, title=t.title, file=links.get(t.id) or paths.get(t.source), done=t.status=='completed', status=t.status, actor=t.actor, course=t.course_id) for t in self.tasks.list_tasks() if t.status in ('open','proposed','completed')]
        messages = {}
        for row in self.conn.execute('SELECT channel,value FROM desktop_messages ORDER BY rowid'):
            messages.setdefault(row[0], []).append(json.loads(row[1]))
        answers = {}
        for row in self.conn.execute('SELECT file,value FROM desktop_answers ORDER BY rowid'):
            answers[row[0]] = json.loads(row[1])['text']
        return dict(trash=trash,agreements=read_all(self.root),courses=[dict(r) for r in self.conn.execute('SELECT code,name FROM courses ORDER BY code')],warnings=self.publication_warnings,version=self.version(), files=files, folders=[dict(row) for row in self.conn.execute('SELECT * FROM desktop_folders ORDER BY rowid')], tasks=tasks, messages=messages, drafts={r[0]:json.loads(r[1]) for r in self.conn.execute('SELECT * FROM desktop_drafts')}, answers=answers)

    def perform(self, action, args, operation=''):
        if action=='semester':
            library=Semesters(library_root(self.root))
            operation_name=args.get('action','list')
            if operation_name=='list':return library.load()
            if not str(args.get('reason','')).strip():raise ValueError('请保留用户要求与整理依据')
            if operation_name=='switch':raise ValueError('用 select 在本次处理结束后切换')
            return library.change(operation_name,dict(args,activate=False),operation)
        if args.get('semester'):
            target=Semesters(library_root(self.root)).directory(args['semester'])
            if target!=self.root:
                store=Workspace(target)
                try:return store.perform(action,{k:v for k,v in args.items() if k!='semester'},operation)
                finally:store.close()
        if action=='carry':
            file=self.file(args['file'])
            target=Semesters(library_root(self.root)).directory(args['target'])
            if target==self.root or not str(args.get('reason','')).strip():raise ValueError('请选择不同学期并保存沿用依据')
            store=Workspace(target)
            try:
                return store.perform('create',{'name':args.get('name') or file['name'],'mime':file['mime'],'data':base64.b64encode(self.content(file)).decode(),'folder':args.get('folder'),'kind':file['kind'],'origin':{'semester':self.root.name if self.root.parent.name=='.semesters' else 'initial','file':file['id'],'sha256':file['sha256'],'reason':args['reason']}},operation)
            finally:store.close()
        if read_only(self.root) and action not in ('list','read','history'):
            raise ValueError('这个学期已归档，请重新开始后再修改')
        if action == 'list':
            return self.snapshot()
        if action == 'read':
            file = self.file(args['file'])
            result = self.public(file)
            result['stored_path']=str(self.blobs/file['sha256'])
            if file['mime'] == 'application/pdf':
                with tempfile.TemporaryDirectory() as directory:
                    output = Path(directory) / 'text.txt'
                    subprocess.run(['pdftotext', str(self.blobs/file['sha256']), str(output)], check=True, timeout=30, capture_output=True)
                    result['text'] = output.read_text()[:100000]
            if file['mime'] in ('image/png','image/jpeg','image/webp','image/gif'):
                result['images']=[{'data':base64.b64encode(self.content(file)).decode(),'mimeType':file['mime']}]
            return result
        if action == 'page':
            return self.page(args)
        if action == 'compile':
            return self.compile(args, operation)
        if action == 'history':
            return {'versions':[json.loads(row[0]) for row in self.conn.execute('SELECT value FROM desktop_history WHERE file=? ORDER BY rowid', (args['file'],))]}
        if action=='agreement':
            if args.get('scope')=='course':self.tasks._resolve_course_row(args['course'])
            return save_agreement(self.root,args,operation)
        fingerprint = hashlib.sha256(encoded([action,args]).encode()).hexdigest()
        with db.atomic(self.conn, bump_revision=action in ('task','check_task')):
            if operation:
                existing = self.conn.execute('SELECT fingerprint,result FROM desktop_operations WHERE id=?', (operation,)).fetchone()
                if existing:
                    if existing[0] != fingerprint:
                        raise ValueError('重复操作内容不同')
                    return json.loads(existing[1])
            result = self.mutate(action, args)
            if action not in ('draft','answer'):self.bump()
            if operation:
                self.conn.execute('INSERT INTO desktop_operations VALUES (?,?,?)', (operation, fingerprint, encoded(result)))
        warnings=self.sync_publications()
        if warnings:result['warnings']=warnings
        return result

    def mutate(self, action, args):
        if action=='course':
            import re
            code=str(args.get('code','')).upper()
            if not re.fullmatch(r'[A-Z0-9][A-Z0-9_-]{0,39}',code):raise ValueError('课程内部标识无效')
            title=name(args['name'])
            existing=self.conn.execute('SELECT * FROM courses WHERE code=?',(code,)).fetchone()
            if existing and existing['name']!=title:raise ValueError('这个课程标识已被其他课程使用')
            if not existing:self.tasks.add_course(code,title)
            result=LearningService(self.conn).setup_course_context(self.root,code)
            identifier='course-'+code
            self.conn.execute('INSERT OR IGNORE INTO desktop_folders VALUES (?,?)',(identifier,title))
            return dict(result,folder=identifier)
        if action in ('remove_file','restore_file'):
            file=self.file(args['file'])
            if args.get('expected')!=file['sha256']:raise ValueError('文件已变化，请重新读取')
            file['removed']=action=='remove_file'
            self.save_file(file)
            return self.public(file)
        if action == 'publish':
            file=self.file(args['file'])
            course=self.tasks._resolve_course_row(args['course'])
            if not (self.root/course['code']/'COURSE.md').is_file():raise ValueError('先建立并核对课程入口，再关联材料')
            relative=Path(args['path'])
            if relative.is_absolute() or '..' in relative.parts or not args.get('reason','').strip():raise ValueError('须给出课程内位置和实际整理依据')
            target=(self.root/course['code']/relative).resolve()
            if not target.is_relative_to(self.root/course['code']) or target==self.root/course['code']/'COURSE.md':raise ValueError('课程文件位置无效')
            path=str(target.relative_to(self.root))
            saved=self.conn.execute('SELECT * FROM desktop_publications WHERE path=?',(path,)).fetchone()
            if saved and saved['file']!=file['id']:raise ValueError('此位置已有其他文件')
            if not saved and target.exists():raise ValueError('此位置已有课程文件，请先读取并保留原件')
            file.update(course=course['code'],course_path=path,organization_reason=args['reason'])
            self.save_file(file)
            self.conn.execute('INSERT INTO desktop_publications VALUES (?,?,?,NULL) ON CONFLICT(path) DO UPDATE SET desired=excluded.desired',(path,file['id'],file['sha256']))
            return self.public(file)
        if action == 'prepare':
            identifier=uid()
            work=self.root/'.study-system/runtime'/('pdf-work-'+identifier)
            brief=(self.root/args['brief']).resolve()
            preparation=delivery.prepare(self.root,work,args['course'],args['kind'],brief)
            record=dict(id=identifier,work=str(work),course=args['course'],kind=args['kind'],brief=str(brief.relative_to(self.root)))
            self.conn.execute('INSERT INTO desktop_preparations VALUES (?,?)',(identifier,encoded(record)))
            return dict(record,preparation=preparation)
        if action == 'create':
            filename = name(args['name'])
            content = args['text'].encode() if 'text' in args else base64.b64decode(args['data'], validate=True)
            mime = args.get('mime') or mimetypes.guess_type(filename)[0] or 'application/octet-stream'
            if Path(filename).suffix.lower() == '.tex': mime = 'text/x-tex'
            kind = args.get('kind', 'upload')
            if kind not in ('text','upload','practice','pdf'): raise ValueError('未知阅览方式')
            file = dict(id=uid(), name=filename, mime=mime, kind=kind, course=args.get('course') or None, folder=args.get('folder') or None, sha256=self.blob(content,MAX_AUDIO if mime.startswith('audio/') else MAX_FILE))
            self.check_folder(file['folder'])
            for source in args.get('sources',[]): self.file(source)
            file['sources'] = args.get('sources',[])
            file['session'] = args.get('session')
            if args.get('origin'):file['origin']=args['origin']
            if args.get('transcription'):file['transcription']=args['transcription']
            if args.get('preparation'):
                if not self.conn.execute('SELECT 1 FROM desktop_preparations WHERE id=?',(args['preparation'],)).fetchone():raise ValueError('制作依据不存在')
                file['preparation']=args['preparation']
            self.save_file(file)
            return self.public(file)
        if action in ('write', 'restore'):
            file = self.file(args['file'])
            if args.get('expected') != file['sha256']: raise ValueError('文件已变化，请重新读取后修改')
            if action == 'restore':
                versions = self.perform('history', {'file':file['id']})['versions']
                old = next((v for v in versions if v['sha256']==args['version']), None)
                if old is None: raise ValueError('找不到历史版本')
                file['sha256'] = old['sha256']
            else:
                file['sha256'] = self.blob(args['text'].encode())
            if file.get('pdf'): file['pdf']['stale'] = file['sha256']!=file['pdf']['source_sha256']
            self.save_file(file)
            self.conn.execute('UPDATE desktop_publications SET desired=? WHERE file=?',(file['sha256'],file['id']))
            return self.public(file)
        if action == 'folder':
            identifier = args.get('id') or uid()
            if not isinstance(identifier,str) or identifier=='unfiled' or len(identifier)>100:raise ValueError('文件夹身份无效')
            self.conn.execute('INSERT OR REPLACE INTO desktop_folders VALUES (?,?)', (identifier, name(args['name'])))
            return {'id':identifier, 'name':name(args['name'])}
        if action == 'metadata':
            if args.get('expected') != self.version(): raise ValueError('桌面已更新，请刷新后重试')
            for folder in args.get('folders',[]):
                if not isinstance(folder['id'],str) or folder['id']=='unfiled' or len(folder['id'])>100:raise ValueError('文件夹身份无效')
                self.conn.execute('INSERT OR REPLACE INTO desktop_folders VALUES (?,?)', (folder['id'], name(folder['name'])))
            for patch in args.get('files',[]):
                file = self.file(patch['id'])
                file.update({key:patch[key] for key in ('name','folder','order') if key in patch})
                file['name'] = name(file['name'])
                self.check_folder(file.get('folder'))
                self.save_file(file)
            return {'saved':True}
        if action == 'task':
            file = self.file(args['file']) if args.get('file') else None
            task = self.tasks.create_task(name(args['title']), course=args.get('course'), actor='student', status='open', source='desktop:'+file['id'] if file else None)
            self.tasks.set_placement(task.id, kind='scheduled', scheduled_date=self.tasks.clock.today().isoformat(), priority='if_time')
            if file: self.conn.execute('INSERT INTO desktop_task_files VALUES (?,?)',(task.id,file['id']))
            return dataclass_dict(task)
        if action == 'check_task':
            task = self.tasks.get_task(args['task'])
            if task.actor != 'student': raise ValueError('助理任务需要实际交付核验，不能由勾选代替')
            if args['done'] and task.status!='completed':
                self.tasks.add_evidence(task.id,'student_confirmation','用户在桌面确认已完成此任务',operator='student')
                task = self.tasks.complete(task.id,operator='student')
            elif not args['done'] and task.status=='completed':
                task = self.tasks.reopen(task.id,'用户取消完成勾选',placement={'kind':'scheduled','scheduled_date':self.tasks.clock.today().isoformat(),'priority':'if_time'},operator='student')
            return dataclass_dict(task)
        if action == 'answer':
            self.file(args['file'])
            answer = dict(id=uid(), text=args['text'], sources=args.get('sources',[]))
            self.conn.execute('INSERT INTO desktop_answers VALUES (?,?,?)',(answer['id'],args['file'],encoded(answer)))
            return answer
        if action == 'draft':
            self.conn.execute('INSERT OR REPLACE INTO desktop_drafts VALUES (?,?)',(args['channel'],encoded(args['value'])))
            return {'saved':True}
        if action == 'review':
            return self.review(args)
        raise ValueError('未知桌面操作：'+action)

    def check_folder(self, identifier):
        if identifier and not self.conn.execute('SELECT 1 FROM desktop_folders WHERE id=?',(identifier,)).fetchone():
            raise ValueError('文件夹不存在')

    def message(self, identifier, channel, value):
        with db.atomic(self.conn, bump_revision=False):
            self.conn.execute('INSERT OR IGNORE INTO desktop_messages VALUES (?,?,?)',(identifier,channel,encoded(value)))

    def compile(self, args, operation):
        file = self.file(args['file'])
        if args.get('expected') != file['sha256']: raise ValueError('源码已变化，请重新读取')
        if Path(file['name']).suffix.lower() != '.tex': raise ValueError('请选择 LaTeX 源文件')
        fingerprint = hashlib.sha256(encoded(['compile',args]).encode()).hexdigest()
        if operation:
            saved = self.conn.execute('SELECT fingerprint,result FROM desktop_operations WHERE id=?',(operation,)).fetchone()
            if saved:
                if saved[0]!=fingerprint: raise ValueError('重复编译内容不同')
                return json.loads(saved[1])
        identifier = uid()
        prepared={}
        if file.get('preparation'):
            row=self.conn.execute('SELECT value FROM desktop_preparations WHERE id=?',(file['preparation'],)).fetchone()
            prepared=json.loads(row[0])
        if args.get('kind') in ('note','worksheet') and not prepared:raise ValueError('正式交付须先 prepare 保存制作依据，再写作')
        work = Path(prepared['work']) if prepared else self.root / '.study-system/runtime' / ('compile-'+identifier)
        work.mkdir(parents=True,exist_ok=True)
        (work/'main.tex').write_bytes(self.content(file))
        # Explicit companion files only. Never infer dependencies or read personal data.
        for item in args.get('assets',[]):
            asset = self.file(item['file'])
            destination = Path(item['path'])
            if destination.is_absolute() or '..' in destination.parts or str(destination) in ('main.tex','main.pdf'):
                raise ValueError('附件路径无效')
            target = work/destination
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(self.content(asset))
        env = dict(__import__('os').environ, openin_any='p', openout_any='p')
        try:
            result = subprocess.run(['latexmk','-norc','-xelatex','-interaction=nonstopmode','-halt-on-error','-no-shell-escape','main.tex'],cwd=work,env=env,capture_output=True,timeout=90)
            log = (result.stdout+result.stderr).decode(errors='replace')[-20000:]
            ok = result.returncode==0 and (work/'main.pdf').is_file()
        except (subprocess.TimeoutExpired,FileNotFoundError) as error:
            ok,log = False,str(error)
        record = dict(kind=prepared.get('kind'),course=prepared.get('course'),brief=prepared.get('brief'),id=identifier,file=file['id'],source_sha256=file['sha256'],ok=ok,log=log,work=str(work))
        if ok:
            try:
                info = subprocess.run(['pdfinfo',str(work/'main.pdf')],env=dict(env,LC_ALL='C'),capture_output=True,text=True,check=True,timeout=15).stdout
                count = next(int(line.split(':')[1]) for line in info.splitlines() if line.startswith('Pages:'))
                record.update(sha256=self.blob((work/'main.pdf').read_bytes()),pages=count,accepted=False)
            except (OSError,subprocess.SubprocessError,StopIteration,ValueError):
                record.update(ok=False,log='PDF 核验未完成，上一版仍保留；请检查 PDF 读取工具后重试。')
        with db.atomic(self.conn, bump_revision=False):
            current = self.file(file['id'])
            if current['sha256']!=file['sha256']:
                record.update(ok=False,log='编译期间源码变化，保留原 PDF；请重新编译')
            if record['ok']:
                pdf = dict(id=current.get('pdf',{}).get('file') or uid(),name=Path(current['name']).stem+'.pdf',mime='application/pdf',kind='pdf',course=current['course'],folder=current['folder'],sha256=record['sha256'],pages=record['pages'],sources=[file['id']],compile=identifier,accepted=False,session=file.get('session'))
                self.save_file(pdf)
                current['pdf'] = dict(file=pdf['id'],compile=identifier,source_sha256=file['sha256'],stale=False)
            current['compile_result'] = {k:v for k,v in record.items() if k!='work'}
            self.save_file(current)
            self.conn.execute('INSERT INTO desktop_compiles VALUES (?,?,?)',(identifier,file['id'],encoded(record)))
            self.bump()
            if operation: self.conn.execute('INSERT INTO desktop_operations VALUES (?,?,?)',(operation,fingerprint,encoded(record)))
        return record

    def page(self,args):
        file = self.file(args['file'])
        if file['mime']!='application/pdf': raise ValueError('请选择 PDF')
        page = args['page']
        if type(page)!=int or page<1: raise ValueError('页码无效')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'page'
            subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-scale-to','1400','-singlefile','-png',str(self.blobs/file['sha256']),str(target)],check=True,capture_output=True,timeout=30)
            image = target.with_suffix('.png').read_bytes()
        if file.get('compile'):
            with db.atomic(self.conn, bump_revision=False): self.conn.execute('INSERT OR IGNORE INTO desktop_views VALUES (?,?)',(file['compile'],page))
        return {'file':file['id'],'page':page,'sha256':file['sha256'],'images':[{'data':base64.b64encode(image).decode(),'mimeType':'image/png'}]}

    def review(self,args):
        file = self.file(args['file'])
        row = self.conn.execute('SELECT value FROM desktop_compiles WHERE id=?',(file.get('compile'),)).fetchone()
        if not row: raise ValueError('没有实际编译记录')
        record = json.loads(row[0])
        source = self.file(record['file'])
        if source['sha256']!=record['source_sha256'] or args.get('sha256')!=file['sha256']:
            raise ValueError('源码或 PDF 已变化，请重新核验')
        viewed = {r[0] for r in self.conn.execute('SELECT page FROM desktop_views WHERE compile=?',(record['id'],))}
        pages = args.get('pages',[])
        if [p.get('page') for p in pages]!=list(range(1,record['pages']+1)) or not set(range(1,record['pages']+1))<=viewed:
            raise ValueError('须实际渲染并核验每一页')
        if any(p.get('status')!='passed' or not p.get('summary','').strip() for p in pages): raise ValueError('有未通过的页面')
        for key in ('source_scope','layout'):
            if not args.get('checks',{}).get(key,'').strip(): raise ValueError('缺少内容与版式核验依据')
        receipt = self.root/'.study-system/evidence'/('pdf-'+record['id']+'.json')
        review = dict(args,artifact_sha256=file['sha256'],page_count=record['pages'])
        if args.get('kind') in ('note','worksheet'):
            # Formal course deliveries retain the original preparation and acceptance checks.
            if record.get('kind')!=args['kind'] or record.get('course')!=args['course'] or record.get('brief')!=args['brief']:
                raise ValueError('正式交付须在编译前保存课程和出卷/写作依据，请重新编译')
            delivery.accept(self.root,record['work'],self.blobs/file['sha256'],receipt,review)
        else:
            db.write_text_atomic(receipt,encoded(dict(source_sha256=source['sha256'],review=review)))
        file.update(accepted=True,receipt=str(receipt.relative_to(self.root)))
        self.save_file(file)
        return self.public(file)

if __name__ == '__main__':
    store = None
    try:
        store = Workspace(sys.argv[1])
        request = json.load(sys.stdin)
        print(encoded({'ok':True,'result':store.perform(request['action'],request.get('args',{}),request.get('id',''))}))
    except Exception as error:
        print(encoded({'ok':False,'error':str(error)}))
        sys.exit(1)
    finally:
        if store: store.close()
