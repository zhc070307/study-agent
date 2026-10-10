// Real temporary web storage and browser; no model calls or PDF compiler required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');

(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'study-state-check-'));
  const server=spawn(process.env.STUDY_TEST_PYTHON||'python3',['-u','-c',`
import sys,signal
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'packages/agent'))
from web import create_server
server=create_server(sys.argv[2],provider='study-web-test')
print(server.server_port,flush=True)
signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.runtime.stop();server.server_close()
`,root,data],{cwd:root,stdio:['ignore','pipe','pipe']});
  let diagnostics='',browser,releaseOld;
  server.stderr.on('data',chunk=>diagnostics+=chunk);
  try {
    const port=await new Promise((resolve,reject)=>{
      server.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim())));
      server.once('error',reject);
      server.once('exit',code=>reject(new Error('Server exited '+code+': '+diagnostics)));
    });
    const origin=`http://127.0.0.1:${port}`;
    async function api(endpoint,value){
      const response=await fetch(origin+endpoint,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
      const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
    }
    const op=(action,args)=>api('/api/workspace',{action,args,id:crypto.randomUUID()});
    for(let n=0;n<5;n++)await op('create',{name:`large-${n}.txt`,text:'x'.repeat(1024*1024)});
    const note=await op('create',{name:'笔记.md',text:'# 第一版'});
    const race=await op('create',{name:'慢速笔记.md',text:'# 过期正文'});
    const state=await api('/api/state');
    assert.ok(JSON.stringify(state).length<20000,'Polling must not transfer five megabytes of file text');
    assert.ok(state.files.every(file=>file.text===undefined&&file.textual===true));
    browser=await chromium.launch({headless:true,...(process.env.STUDY_UI_BROWSER_CHANNEL?{channel:process.env.STUDY_UI_BROWSER_CHANNEL}:{})});
    const page=await browser.newPage();
    const reads=[];
    page.on('request',request=>{
      if(request.url().endsWith('/api/workspace')&&request.method()==='POST'){
        const value=request.postDataJSON();if(value.action==='read')reads.push(value.args.file);
      }
    });
    await page.goto(origin);
    await page.locator(`[data-id="${note.id}"]`).dblclick();
    await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='第一版');
    assert.deepEqual(reads,[note.id],'Only the opened file is read');
    await op('write',{file:note.id,expected:note.sha256,text:'# 修订后的正文'});
    await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='修订后的正文');
    assert.equal(reads.filter(id=>id===note.id).length,2);
    await page.locator('#back').click();
    await page.locator(`[data-id="${note.id}"]`).dblclick();
    await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='修订后的正文');
    assert.equal(reads.filter(id=>id===note.id).length,2,'Unchanged text stays cached');

    // A response for the previous hash must not replace a newer version after polling.
    let delayed=false,notifyCaptured;
    const captured=new Promise(resolve=>notifyCaptured=resolve);
    const release=new Promise(resolve=>releaseOld=resolve);
    await page.route('**/api/workspace',async route=>{
      const value=route.request().postDataJSON();
      if(value.action==='read'&&value.args.file===race.id&&!delayed){
        delayed=true;const response=await route.fetch();notifyCaptured();await release;await route.fulfill({response});
      }else await route.continue();
    });
    await page.locator('#back').click();
    await page.locator(`[data-id="${race.id}"]`).dblclick();
    await captured;
    await op('write',{file:race.id,expected:race.sha256,text:'# 最新正文'});
    await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='最新正文');
    const oldResponse=page.waitForResponse(async response=>response.url().endsWith('/api/workspace')&&response.request().postDataJSON()?.args?.expected===race.sha256);
    releaseOld();await oldResponse;
    await page.waitForFunction(()=>!getFile(state.active).loading);
    assert.equal(await page.locator('.markdown-body h1').textContent(),'最新正文');
    assert.ok(reads.every(id=>id===note.id||id===race.id),'Unopened files are never loaded');
    console.log('Compact polling, lazy reads, cache invalidation and stale response checks passed.');
  } finally {
    releaseOld?.();await browser?.close();
    if(server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;}
    fs.rmSync(data,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exit(1);});
