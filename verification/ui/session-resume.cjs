// Actual HTTP/UI + persistent SDK processes. Uses temporary data and a scripted model.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'study-ui-resume-'));
  let child,browser,port,diagnostics='';
  async function start(){
    child=spawn(process.env.STUDY_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),['-u','-c',`
import sys,signal
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'packages/agent'))
from web import create_server
server=create_server(sys.argv[2],port=int(sys.argv[3]),provider='study-restart-test',extra_patch=[{'insert':[{'id':'restart-test-model','name':str(Path(sys.argv[1])/'packages/agent/tests/restart-model.ts')}]}])
print(server.server_port,flush=True)
signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.runtime.stop();server.server_close()
`,root,data,String(port||0)],{cwd:root,stdio:['ignore','pipe','pipe']});
    child.stderr.on('data',chunk=>diagnostics+=chunk);
    port=await new Promise((resolve,reject)=>{child.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim())));child.once('error',reject);child.once('exit',()=>reject(new Error(diagnostics)));});
  }
  async function close(){if(child?.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}}
  try{
    await start();const origin=`http://127.0.0.1:${port}`;
    const api=async(route,value)=>{const response=await fetch(origin+route,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
    const op=(action,args)=>api('/api/workspace',{action,args,id:crypto.randomUUID()});
    const file=await op('create',{name:'恢复聊天.md',text:'# 课程材料'});
    const initial=(await api('/api/state')).semesters.active;
    browser=await chromium.launch({headless:true,executablePath:process.env.STUDY_UI_BROWSER||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.waitForSelector(`[data-id="${file.id}"]`);
    async function ask(request,match){
      const before=await page.evaluate(()=>state.messages.get(channel())?.length||0);
      await page.locator('#prompt').fill(JSON.stringify(request));await page.locator('.send-button').click();
      await page.waitForFunction(({before,match})=>{const messages=state.messages.get(channel())||[];return !busy&&messages.length>before&&messages.at(-1)?.role==='assistant'&&messages.at(-1)?.text.includes(match);},{before,match},{timeout:45000});
      assert.equal((await api('/api/state')).runtime.error,null);
    }
    await ask({remember:'desktop-restart'},'已记住');
    await page.locator(`[data-id="${file.id}"] .file-open`).click();await page.waitForSelector('.markdown-body');
    await ask({remember:'file-restart'},'已记住');
    await page.waitForFunction(async id=>(await(await fetch('/api/state')).json()).drafts.__layout?.active===id,file.id);
    await close();await start();await page.reload();await page.waitForFunction(id=>state.active===id,file.id);
    await ask({continue:'file-restart',expectModel:'deepseek-flash'},'已恢复历史');
    await page.locator('#conversation-menu').click();await page.locator('[data-chat-channel="desktop"]').click();
    await ask({continue:'desktop-restart',expectModel:'deepseek-flash'},'已恢复历史');
    // The settings dialog replaces the SDK process, then reuses its stored history.
    await page.locator('#settings').click();await page.locator('#model-choice').selectOption('deepseek-v4-pro');await page.locator('#model-key').fill('local-resume-test-no-provider-access');await page.locator('#picker-confirm').click();await page.waitForFunction(()=>!document.querySelector('#picker').open);
    await ask({continue:'desktop-restart',expectModel:'deepseek-v4-pro'},'deepseek-v4-pro');
    await page.locator('#prompt').fill(JSON.stringify({wait:true}));await page.locator('.send-button').click();
    await page.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('正在等待停止测试'));
    await page.locator('#stop-agent').click();await page.waitForFunction(()=>!busy);
    await ask({continue:'desktop-restart',expectModel:'deepseek-v4-pro'},'已恢复历史');
    // A semester has its own chat and runtime; returning restores the original chat.
    let semesters=(await api('/api/state')).semesters;
    await api('/api/semesters',{action:'create',args:{name:'下一学期',expected:semesters.version}});await page.reload();await page.waitForFunction(()=>document.querySelector('#semester-menu').textContent==='下一学期');
    await ask({remember:'next-semester-only'},'已记住');
    semesters=(await api('/api/state')).semesters;
    await api('/api/semesters',{action:'switch',args:{semester:initial,expected:semesters.version}});await page.reload();await page.waitForFunction(()=>document.querySelector('#semester-menu').textContent!=='下一学期');
    await page.locator('#conversation-menu').click();await page.locator('[data-chat-channel="desktop"]').click();
    await ask({continue:'desktop-restart',expectModel:'deepseek-v4-pro'},'已恢复历史');
    assert.ok(!(await page.locator('#conversation').textContent()).includes('next-semester-only'));
    const history=(await api('/api/state')).messages;
    assert.equal(history.desktop.filter(message=>message.role==='user'&&message.text.includes('"remember"')).length,1);
    assert.equal(history[file.id].filter(message=>message.role==='user'&&message.text.includes('"remember"')).length,1);
    assert.deepEqual(errors,[]);
    console.log('UI session resume passed: desktop and file chats after service restart, model change, stop/continue, semester round-trip, ordered history and no duplicate initial questions. No remote model calls.');
  }finally{await browser?.close();await close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
