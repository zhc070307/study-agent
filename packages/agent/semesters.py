"""Semester selection is a user action; each semester owns its entire learning state."""
from pathlib import Path
import json
import fcntl
import hashlib
import os
import sqlite3
import tempfile
import uuid
import zipfile

class Semesters:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / '.semesters/index.json'
        if not self.path.exists():
            self.save({'version':0,'active':'initial','items':[{'id':'initial','name':'当前学期','status':'open'}]})

    def load(self):
        return json.loads(self.path.read_text())

    def save(self, value):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=self.path.parent,delete=False) as out:
            json.dump(value,out,ensure_ascii=False)
            out.flush(); os.fsync(out.fileno()); temp=Path(out.name)
        temp.replace(self.path)

    def item(self, identifier=None):
        data=self.load()
        item=next((i for i in data['items'] if i['id']==(identifier or data['active'])),None)
        if not item: raise ValueError('学期不存在')
        return item

    def directory(self, identifier=None):
        item=self.item(identifier)
        return self.root if item['id']=='initial' else self.root/'.semesters'/item['id']

    def change(self, action, args, operation=""):
        with (self.path.parent/'index.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            return self._change(action,args,operation)

    def _change(self, action, args, operation):
        data=self.load()
        fingerprint=hashlib.sha256(json.dumps([action,args],sort_keys=True).encode()).hexdigest()
        if operation and operation in data.get('operations',{}):
            previous=data['operations'][operation]
            if previous['fingerprint']!=fingerprint:raise ValueError('重复学期操作的内容不同')
            return previous['result']
        if args.get('expected')!=data['version']: raise ValueError('学期列表已变化，请重新打开')
        if action=='cancel':
            data.pop('pending',None)
        elif action=='create':
            title=str(args.get('name','')).strip()
            if not title or len(title)>80: raise ValueError('请填写学期名称（不超过 80 字）')
            item={'id':uuid.uuid4().hex,'name':title,'status':'open'}
            self.directory_for_new(item).mkdir(parents=True)
            data['items'].append(item)
            if args.get('activate',True):
                data['active']=item['id']
                data.pop('pending',None)
            else:data['created']=item['id']
        else:
            item=next((i for i in data['items'] if i['id']==args.get('semester')),None)
            if not item: raise ValueError('学期不存在')
            if action=='select':
                if item['status']=='removed':raise ValueError('请先恢复已移除学期')
                data['pending']={'semester':item['id'],'requested':uuid.uuid4().hex}
            elif action=='switch':
                if item['status']=='removed': raise ValueError('请先从已移除学期中恢复')
                data['active']=item['id']
                data.pop('pending',None)
            elif action=='rename':
                title=str(args.get('name','')).strip()
                if not title or len(title)>80: raise ValueError('请填写学期名称（不超过 80 字）')
                item['name']=title
            elif action=='archive':
                if item['status']!='open':raise ValueError('只能归档正在使用的学期')
                item['status']='archived'
            elif action=='reopen':
                if item['status']!='archived': raise ValueError('只能重新开始已归档的学期')
                item['status']='open'
            elif action=='remove':
                if item['status']=='removed':raise ValueError('这个学期已经移除')
                if item['id']==data['active']: raise ValueError('请先切换到另一个学期，再移除这个学期')
                if args.get('confirm')!=item['name']: raise ValueError('请核对要移除的学期名称')
                item['previous_status']=item['status']; item['status']='removed'
                if data.get('pending',{}).get('semester')==item['id']:data.pop('pending',None)
            elif action=='restore':
                if item['status']!='removed': raise ValueError('这个学期没有被移除')
                item['status']=item.pop('previous_status','archived')
            else: raise ValueError('未知学期操作')
        data['version']+=1
        if operation:
            compact={key:data[key] for key in ('version','active','created','pending') if key in data}
            data.setdefault('operations',{})[operation]={'fingerprint':fingerprint,'result':compact}
        self.save(data)
        return data

    def directory_for_new(self,item):
        return self.root/'.semesters'/item['id']

    def export(self, identifier):
        """Quiescent server + SQLite backup; exclude credentials and transient compiler work."""
        root=self.directory(identifier)
        output=tempfile.SpooledTemporaryFile(max_size=8*1024*1024)
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('semester.json',json.dumps(self.item(identifier),ensure_ascii=False))
            for path in root.rglob('*'):
                rel=path.relative_to(root)
                if not path.is_file() or path.is_symlink(): continue
                if any(part in ('.semesters','.harness','runtime','__pycache__') for part in rel.parts): continue
                if path.name.startswith(('.env','credentials')) or path.suffix in ('.pem','.key'): continue
                if path.name.startswith('task_memory.sqlite3'): continue
                archive.write(path,str(rel))
            source=root/'.study-system/data/task_memory.sqlite3'
            if source.exists():
                with tempfile.TemporaryDirectory() as directory:
                    backup=Path(directory)/'ledger.sqlite3'
                    with sqlite3.connect(source) as conn, sqlite3.connect(backup) as dest: conn.backup(dest)
                    archive.write(backup,'.study-system/data/task_memory.sqlite3')
        output.seek(0)
        return output
