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
    const row=key=>page.locator('.history-row').filter({has:page.locator(`[data-chat-channel="${key}"]`)});
    async function menuAction(key,action){await row(key).locator('summary').click();await row(key).locator(`[data-chat-action="${action}"]`).click();}
    // Round 1: discover and manage conversations without a history dialog.
    assert.ok(await page.locator('#chat-sidebar').isVisible());
    assert.equal(await page.locator('.quick-actions,#chat-latest,.preview-label').count(),0);
    await ask({remember:'archive-desktop-token'},'已记住');
    const desktop=await page.evaluate(()=>channel());
    await row(desktop).locator('summary').click();
    const menuBox=await row(desktop).locator('details>div').boundingBox();
    assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=1280);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.chatAction),'rename');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.chatAction),'archive');
    await page.keyboard.press('Escape');
    assert.equal(await row(desktop).locator('details').getAttribute('open'),null);
    assert.ok(await row(desktop).locator('summary').evaluate(node=>node===document.activeElement));
    await page.locator('#prompt').fill('归档时保留我的草稿');
    await menuAction(desktop,'rename');
    await row(desktop).locator('input').fill('微积分答疑');
    await page.evaluate(()=>refresh(true));
    assert.equal(await row(desktop).locator('input').inputValue(),'微积分答疑');
    await row(desktop).locator('button[type="submit"]').click();
    await page.waitForFunction(()=>chats.some(chat=>chat.title==='微积分答疑'));
    await menuAction(desktop,'archive');
    await page.waitForFunction(key=>channel()!==key,desktop);
    assert.equal(await page.locator('#picker').evaluate(node=>node.open),false);
    assert.equal(await page.locator(`[data-chat-channel="${desktop}"]`).count(),0);
    await page.locator('#history-filter').selectOption('archived');
    await page.locator(`[data-chat-channel="${desktop}"]`).click();
    assert.ok(await page.locator('#prompt').isDisabled());
    assert.equal(await page.locator('#prompt').inputValue(),'归档时保留我的草稿');
    await page.locator('#restore-chat').click();
    await page.waitForFunction(()=>!document.querySelector('#prompt').disabled);
    assert.equal(await page.locator('#prompt').inputValue(),'归档时保留我的草稿');
    await ask({continue:'archive-desktop-token'},'已恢复历史');
    await page.locator('#history-filter').selectOption('open');
    await page.locator('#new-chat').click();
    await page.waitForFunction(key=>channel()!==key,desktop);
    const separate=await page.evaluate(()=>channel());
    await ask({fresh:'archive-desktop-token'},'独立的新对话');
    await page.locator(`[data-id="${file.id}"] .file-open`).click();await page.waitForSelector('.markdown-body');
    await ask({remember:'delete-file-token'},'已记住');
    const fileChat=await page.evaluate(()=>channel());
    const filler=[];
    for(let i=0;i<16;i++)filler.push(await api('/api/chats',{action:'create',title:'较早的讨论 '+i}));
    for(const chat of filler)await api('/api/chats',{action:'rename',channel:chat.channel,title:'较早的讨论 '+chat.channel.slice(0,4)});
    await page.evaluate(()=>refresh(true));
    await row(desktop).scrollIntoViewIfNeeded();
    await row(desktop).locator('summary').click();
    const bounded=await row(desktop).locator('details>div').boundingBox();
    assert.ok(bounded.y>=0&&bounded.y+bounded.height<=900,'Menu must stay inside viewport even in scrolled history');
    await page.keyboard.press('Escape');
    const middle=filler[8].channel;
    await row(middle).scrollIntoViewIfNeeded();
    await row(middle).locator('summary').click();
    const previous=(await row(middle).locator('details>div').boundingBox()).y;
    await page.locator('#history-results').evaluate(node=>node.scrollTop-=30);
    await page.waitForTimeout(100);
    const tracked=await row(middle).locator('details>div').boundingBox();
    assert.notEqual(tracked.y,previous,'Harness menu must follow its trigger while the sidebar scrolls');
    await page.keyboard.press('Escape');
    for(const chat of filler)await api('/api/chats',{action:'archive',channel:chat.channel});
    await page.evaluate(()=>refresh(true));
    console.log('Round 1 passed: persistent sidebar, independent new chats, inline rename, archive filter, read-only archive and restored draft/model history.');
    // Round 2: deletion removes SDK persistence and cannot be undone by stale saves.
    await page.locator('#prompt').fill(JSON.stringify({wait:true}));await page.locator('.send-button').click();
    await page.waitForFunction(()=>busy&&document.querySelector('#conversation').textContent.includes('正在等待停止测试'));
    const refused=await fetch(origin+'/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',channel:fileChat})});
    assert.equal(refused.status,400);assert.match((await refused.json()).error,/先停止/);
    await page.locator('#stop-agent').click();await page.waitForFunction(()=>!busy);
    await menuAction(fileChat,'delete');await row(fileChat).locator('[data-chat-action="cancel"]').click();
    assert.ok((await api('/api/state')).messages[fileChat].length>0);
    const otherWindow=await browser.newPage();await otherWindow.goto(origin);await otherWindow.waitForFunction(()=>serverVersion>=0);
    await otherWindow.locator(`[data-chat-channel="${fileChat}"]`).click();
    await otherWindow.locator('#prompt').fill('另一个窗口尚未发送的内容');
    await menuAction(fileChat,'delete');await row(fileChat).locator('[data-chat-action="confirm-delete"]').click();
    await page.waitForFunction(key=>!chats.some(chat=>chat.channel===key),fileChat,{timeout:40000});
    await otherWindow.waitForFunction(key=>channel()!==key,fileChat);
    await otherWindow.close();
    let snapshot=await api('/api/state');
    assert.ok(snapshot.files.some(item=>item.id===file.id));
    assert.equal(snapshot.messages[fileChat],undefined);assert.equal(snapshot.drafts[fileChat],undefined);
    const stale=await fetch(origin+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'draft',args:{channel:fileChat,value:{prompt:'迟到的保存'}}})});
    assert.equal(stale.status,400);
    function filesUnder(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?filesUnder(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
    assert.ok(!filesUnder(data).filter(name=>name.endsWith('.jsonl')).some(name=>fs.readFileSync(name,'utf8').includes('delete-file-token')),'Deleted SDK history must actually leave disk');
    await ask({fresh:'delete-file-token'},'独立的新对话');
    await close();await start();await page.reload();await page.waitForFunction(()=>serverVersion>=0);
    assert.equal(await page.locator(`[data-chat-channel="${fileChat}"]`).count(),0);
    await page.locator(`[data-chat-channel="${desktop}"]`).click();
    await ask({continue:'archive-desktop-token'},'已恢复历史');
    assert.ok((await api('/api/state')).messages[separate].length>0);
    console.log('Round 2 passed: busy deletion refusal, cancel/confirm, physical SDK history deletion, stale draft rejection, restart isolation and preserved other chats/files.');
    // Round 3: use the space and controls; nothing ornamental blocks reading.
    const layout=await page.evaluate(()=>Object.fromEntries(['sidebar','assistant','workspace'].map(key=>{const box=document.querySelector(key==='sidebar'?'#chat-sidebar':'.'+key).getBoundingClientRect();return [key,{x:box.x,right:box.right,width:box.width}]})));
    assert.ok(layout.assistant.x-layout.sidebar.right<20,'Conversation must sit beside its navigation');
    assert.ok(layout.workspace.x>layout.assistant.right,'Files must be the right preview');
    assert.ok(layout.assistant.width>layout.workspace.width,'Conversation should be the main workspace');
    await page.locator('#expand-chat').click();
    assert.ok(await page.locator('.assistant').evaluate(node=>node.clientWidth>800));
    assert.ok(await page.locator('#conversation').evaluate(node=>node.clientHeight>document.querySelector('.assistant').clientHeight*.7));
    assert.ok(await page.locator('.composer').evaluate(node=>node.clientHeight<120));
    await page.locator('#prompt').fill(Array.from({length:10},()=> '多行问题').join('\n'));
    assert.ok(await page.locator('#prompt').evaluate(node=>node.clientHeight<=160));
    await page.locator('.app-header .assistant-toggle').click();
    assert.ok(await page.locator('.workspace').isVisible());
    await page.locator('#restore-assistant').click();
    assert.ok(await page.locator('.assistant').isVisible());
    await page.locator('#home').click();
    await page.locator(`[data-id="${file.id}"] .file-open`).click();await page.waitForSelector('.markdown-body');
    await page.locator('#back').click();
    assert.ok(await page.locator('#desktop').isVisible());
    assert.equal(await page.evaluate(()=>state.folder),null);
    await page.locator('#hide-chat-sidebar').click();assert.equal(await page.locator('#chat-sidebar').isVisible(),false);
    await page.locator('#conversation-menu').click();assert.ok(await page.locator('#chat-sidebar').isVisible());
    await page.setViewportSize({width:390,height:844});await page.locator('#hide-chat-sidebar').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize({width:1440,height:960});await page.locator('#conversation-menu').click();
    if(process.env.STUDY_UI_CAPTURE)await page.screenshot({path:process.env.STUDY_UI_CAPTURE});
    assert.deepEqual(errors,[]);
    console.log('Round 3 passed: expanded chat uses the window, compact auto-growing composer, desktop return, sidebar collapse and narrow-window overflow checks.');
  }catch(error){if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:'/workspace/scratch/chat-management-failure.png'});throw new Error(error.stack+'\n'+diagnostics);}
  finally{await browser?.close();await close();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
