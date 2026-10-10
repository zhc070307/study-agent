"""Clean container startup, actual PDF dependencies and named-volume restart; no inference."""
import json
import os
import subprocess
import time
import uuid

image=os.environ.get('STUDY_CHECK_IMAGE','study-agent:release-check')
name='study-release-'+uuid.uuid4().hex[:10];volume=name+'-data'
base=['docker']
if os.environ.get('STUDY_DOCKER_HOST'):base+=['--host='+os.environ['STUDY_DOCKER_HOST']]

def docker(*args,check=True):
    return subprocess.run([*base,*args],check=check,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

def request(route,value=None):
    code='''import json,sys,urllib.request
value=json.loads(sys.argv[2]);headers={'Content-Type':'application/json'}
request=urllib.request.Request('http://127.0.0.1:8765'+sys.argv[1],data=json.dumps(value).encode() if value is not None else None,headers=headers)
with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=30) as response:print(response.read().decode())
'''
    return json.loads(docker('exec',name,'python3','-c',code,route,json.dumps(value)).stdout)

def operation(action,args):return request('/api/workspace',{'action':action,'args':args,'id':uuid.uuid4().hex})

def launch():
    docker('run','-d','--name',name,'-e','DEEPSEEK_API_KEY=scripted-deployment-key-never-used','--mount','type=volume,source='+volume+',target=/data',image)
    for unused in range(40):
        try:return request('/api/state')
        except (subprocess.CalledProcessError,ValueError):time.sleep(.5)
    raise RuntimeError('Container did not start: '+docker('logs',name).stdout)

try:
    failure=docker('run','--rm',image,check=False)
    assert failure.returncode!=0 and 'DEEPSEEK_API_KEY' in failure.stdout+failure.stderr
    docker('volume','create',volume)
    first=launch();assert not first['files'] and not first['tasks']
    assert first['transcription']['resources']['backend'] is None
    folder=operation('folder',{'name':'中文课程'})
    source=operation('create',{'name':'中文笔记.tex','text':r'\documentclass[fontset=fandol]{ctexart}\usepackage{amsmath,siunitx,tikz}\begin{document}导数表示变化率。\[ f(x)=x^2,\quad f\prime(x)=2x \]\end{document}','folder':folder['id']})
    compiled=operation('compile',{'file':source['id'],'expected':source['sha256']})
    assert compiled['ok'],compiled.get('log')
    task=operation('task',{'title':'阅读中文笔记','file':source['id']})
    before=request('/api/state')
    docker('stop',name);docker('rm',name)
    after=launch()
    assert any(file['id']==source['id'] and file.get('pdf') for file in after['files'])
    assert any(item['id']==task['id'] for item in after['tasks'])
    assert after['version']==before['version']
    print('Clean nonroot container startup, missing-key refusal, actual Chinese PDF and named-volume restart passed; no model calls.')
finally:
    docker('rm','-f',name,check=False)
    docker('volume','rm',volume,check=False)
