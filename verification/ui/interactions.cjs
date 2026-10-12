// Three ordinary-user journeys against a temporary workspace; no paid model calls.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'study-interactions-'));
  const child=spawn('python3',['-u','-c',`
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
  let diagnostics='',browser;
  child.stderr.on('data',chunk=>diagnostics+=chunk);
  try{
    const port=await new Promise((resolve,reject)=>{child.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim())));child.once('error',reject);child.once('exit',()=>reject(new Error(diagnostics)));});
    const origin=`http://127.0.0.1:${port}`;
    const api=async(endpoint,value)=>{const response=await fetch(origin+endpoint,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
    const op=(action,args)=>api('/api/workspace',{action,args,id:crypto.randomUUID()});
    const math=await op('course',{code:'MATH',name:'微积分'}),physics=await op('course',{code:'PHYS',name:'物理'});
    const note=await op('create',{name:'第一讲.md',text:'# 导数与变化率\n\n求导是研究瞬时变化率的方法。\n\n'+Array.from({length:35},(_,i)=>`## 段落 ${i}\n\n阅读材料。`).join('\n\n'),folder:math.folders.materials});
    const other=await op('create',{name:'第一讲.md',text:'# 运动学',folder:physics.folders.materials});
    const inbox=await op('create',{name:'新课件.txt',text:'待整理'});
    const practice=await op('create',{name:'练习.md',kind:'practice',course:'MATH',text:'# 独立练习\n\n请说明导数的含义。'});
    const pdf=await op('create',{name:'导数.pdf',mime:'application/pdf',data:fs.readFileSync(path.join(root,'ui/samples/materials/derivatives.pdf')).toString('base64'),folder:math.folders.materials});
    browser=await chromium.launch({headless:true,executablePath:process.env.STUDY_UI_BROWSER||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.waitForSelector(`[data-folder="${math.folder}"]`);
    // Round 1: locate same-named files, navigate directly, move without losing originals.
    await page.locator('#file-search').fill('第一讲');
    assert.equal(await page.locator('#files .file-card').count(),2);
    assert.match(await page.locator(`[data-id="${note.id}"] small`).textContent(),/微积分/);
    assert.match(await page.locator(`[data-id="${other.id}"] small`).textContent(),/物理/);
    await page.locator(`[data-id="${note.id}"] .file-open`).click();await page.waitForSelector('.markdown-body');
    await page.locator('#file-actions summary').click();await page.locator(`#document-meta [data-browse-folder="${math.folder}"]`).click();
    await page.waitForSelector(`[data-folder="${math.folders.materials}"]`);
    assert.equal(await page.locator('#file-search').inputValue(),'');
    await page.locator('#files-heading [data-browse-folder=""]').click();
    await page.locator(`[data-id="${inbox.id}"]`).dragTo(page.locator(`[data-folder="${math.folder}"]`));
    await page.waitForFunction(async id=>(await(await fetch('/api/state')).json()).files.find(f=>f.id===id)?.folder!==null,inbox.id);
    assert.equal((await api('/api/state')).files.find(f=>f.id===inbox.id).sha256,inbox.sha256);
    await page.locator('#attach-context').click();await page.locator('.picker-search').fill('物理');
    await page.locator(`.picker-option input[value="${other.id}"]`).check();
    await page.locator('.picker-search').fill('微积分');await page.locator(`.picker-option input[value="${note.id}"]`).check();
    await page.locator('#picker-confirm').click();assert.equal(await page.locator('#contexts [data-remove]').count(),2);
    await page.locator('#clear-context').click();
    console.log('Round 1 passed: cross-folder search, distinguish duplicate names, breadcrumbs, drag-to-folder and filtered multi-selection.');
    // Round 2: preview references without switching the conversation; recover work after failure/reload.
    await page.locator('#file-search').fill('微积分');await page.locator(`[data-id="${note.id}"] .file-open`).click();await page.waitForSelector('.markdown-body');
    await page.locator('#prompt').fill('我的问题还没写完');
    await page.locator('#attach-context').click();await page.locator(`.picker-option input[value="${other.id}"]`).check();await page.locator('#picker-confirm').click();
    await page.locator(`[data-open-context="${other.id}"]`).click();await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='运动学');
    assert.equal(await page.locator('#prompt').inputValue(),'我的问题还没写完');
    assert.equal(await page.evaluate(()=>channel()),note.id);
    if(!await page.locator('#file-actions').evaluate(node=>node.open))await page.locator('#file-actions summary').click();await page.locator('#edit-file').click();await page.locator('#edit-text').fill('# 用户修改，失败也要保留');
    await page.route('**/api/workspace',route=>{const value=route.request().postDataJSON();return value.action==='write'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'暂时无法保存，请稍后重试'})}):route.continue();});
    await page.locator('#picker-confirm').click();await page.waitForSelector('.picker-error');
    assert.equal(await page.locator('#edit-text').inputValue(),'# 用户修改，失败也要保留');
    assert.ok(await page.locator('#picker').evaluate(dialog=>dialog.open));
    await page.unroute('**/api/workspace');await page.locator('#picker-confirm').click();await page.waitForFunction(()=>!document.querySelector('#picker').open);
    await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='用户修改，失败也要保留');
    await page.locator('#back').click();await page.locator('#file-search').fill('练习.md');await page.locator(`[data-id="${practice.id}"] .file-open`).click();
    await page.locator('.answer-input').fill('还没做完的推导，不能当作已经完成');
    await page.waitForFunction(async id=>(await(await fetch('/api/state')).json()).drafts['__answer:'+id]?.text.includes('还没做完'),practice.id);
    assert.equal((await api('/api/state')).answers[practice.id],undefined,'Autosaved draft must not become submitted evidence');
    await page.reload();await page.waitForSelector('.answer-input');assert.match(await page.locator('.answer-input').inputValue(),/还没做完/);
    await page.locator('.save-answer').click();await page.waitForFunction(()=>document.querySelector('.answer-status')?.textContent==='已保存');
    assert.match((await api('/api/state')).answers[practice.id],/还没做完/);
    await page.locator('#back').click();await page.locator('#file-search').fill('导数.pdf');await page.locator(`[data-id="${pdf.id}"] .file-open`).click();
    await page.waitForSelector('.pdf-sheet[data-rendered="true"]');
    await page.locator('.pdf-page-input').fill('2');await page.locator('.pdf-page-input').press('Enter');await page.locator('[data-pdf="in"]').click();
    await page.waitForSelector('.pdf-sheet[data-page-number="2"][data-rendered="true"]');
    await page.waitForFunction(async id=>{const draft=(await(await fetch('/api/state')).json()).drafts['__reader:'+id];return draft?.pdfPage===2&&draft.pdfZoom>1;},pdf.id);
    // Use the wheel across a physical page boundary, without any page-button click.
    await page.locator('[data-pdf="previous"]').click();
    await page.waitForFunction(()=>document.querySelector('.pdf-page-input').value==='1');
    const firstSheet=await page.locator('.pdf-sheet[data-page-number="1"]').elementHandle();
    const pdfBounds=await page.locator('.pdf-pages').boundingBox();
    await page.mouse.move(pdfBounds.x+pdfBounds.width/2,pdfBounds.y+pdfBounds.height/2);
    await page.mouse.wheel(0,2000);
    await page.waitForFunction(()=>document.querySelector('.pdf-page-input').value==='2');
    assert.ok(await firstSheet.evaluate(node=>node.isConnected),'Continuous scrolling must retain the adjacent page');
    const sheet=await page.locator('.pdf-sheet[data-page-number="2"]').elementHandle();await op('write',{file:note.id,expected:note.sha256,text:'# 与当前 PDF 无关的改动'});
    await page.waitForFunction(async()=>serverVersion===(await(await fetch('/api/state')).json()).version);
    assert.ok(await sheet.evaluate(node=>node.isConnected),'An unrelated file update must not tear down the current reader');
    await page.reload();await page.waitForSelector('.pdf-sheet[data-page-number="2"][data-rendered="true"]');assert.equal(await page.locator('.pdf-zoom').textContent(),'115%');
    console.log('Round 2 passed: reference preview keeps question and conversation, failed editor saves retain text, unsaved answer recovery, PDF reading position and stable reader updates.');
    // Round 3: use real saved transcripts to recover a prior question, not a simulated DOM history.
    const transcript=[
      {id:'desk-question',channel:'desktop',value:{role:'user',text:'我想安排下一周',time:Date.now()-2000}},
      {id:'note-question',channel:note.id,value:{role:'user',text:'请解释变化率',files:[note.id],refs:'第一讲.md',time:Date.now()-1000}},
      ...Array.from({length:18},(_,i)=>({id:'answer-'+i,channel:note.id,value:{role:'assistant',text:`## 解释 ${i+1}

变化率是每单位输入的变化量。

${'进一步结合题目理解。'.repeat(12)}`,time:Date.now()+i}})),
      {id:'code-answer',channel:note.id,value:{role:'assistant',text:'这里是公式示例：\n\n```python\nrate = (y2 - y1) / (x2 - x1)\n```',time:Date.now()+20}}
    ];
    const seed=path.join(data,'history.json');fs.writeFileSync(seed,JSON.stringify(transcript));
    execFileSync('python3',['-c',`
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'packages/agent'))
from workspace import Workspace
from semesters import Semesters
store=Workspace(Semesters(sys.argv[2]).directory())
for entry in json.loads(Path(sys.argv[3]).read_text()):store.message(entry['id'],entry['channel'],entry['value'])
store.close()
`,root,data,seed]);
    await page.waitForFunction(id=>state.messages.get(id)?.length===20,note.id);
    await page.locator('#conversation-menu').click();await page.locator('#history-search').fill('每单位输入');
    assert.equal(await page.locator('.history-row').count(),1);
    await page.locator(`[data-chat-channel="${note.id}"]`).click();
    assert.equal(await page.locator('.pdf-page-input').inputValue(),'2','History navigation must not replace the open reader');
    await page.locator('#find-chat').click();await page.locator('#chat-find-input').fill('变化率');
    assert.equal(await page.locator('#chat-find-count').textContent(),'1/19 条');
    await page.locator('#chat-find-next').click();assert.equal(await page.locator('#chat-find-count').textContent(),'2/19 条');
    const located=await page.locator('.find-current').getAttribute('data-message');
    assert.equal(await page.locator('#chat-latest').count(),0);
    assert.ok(await page.locator('#conversation').evaluate(node=>node.scrollTop+node.clientHeight<node.scrollHeight-24));
    await page.locator('#chat-find-close').click();
    const top=await page.locator('#conversation').evaluate(node=>node.scrollTop);
    await page.waitForFunction(async id=>{const saved=(await(await fetch('/api/state')).json()).drafts[id]?.chatScroll;return saved&&!saved.follow;},note.id);
    await page.reload();await page.waitForFunction(id=>channel()===id,note.id);await page.waitForSelector('.pdf-sheet[data-page-number="2"][data-rendered="true"]');
    assert.ok(Math.abs((await page.locator('#conversation').evaluate(node=>node.scrollTop))-top)<20,'Reopening must preserve the history reading position');
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin});
    await page.locator('[data-message="note-question"] [data-copy-message]').click();await page.waitForFunction(()=>document.querySelector('[data-message="note-question"] [data-copy-message]').textContent==='已复制');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'请解释变化率');
    await page.locator('[data-message="code-answer"] .copy-code').click();await page.waitForFunction(()=>document.querySelector('[data-message="code-answer"] .copy-code').textContent==='已复制');
    assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).trim(),'rate = (y2 - y1) / (x2 - x1)');
    await page.locator('#prompt').fill('保留我正在写的问题');
    await page.locator('[data-message="note-question"] [data-reuse-message]').click();
    assert.equal(await page.locator('#prompt').inputValue(),`保留我正在写的问题

请解释变化率`);
    assert.ok(await page.locator(`[data-open-context="${note.id}"]`).count());
    await page.locator('[data-message="answer-0"] [data-reuse-message]').click();assert.match(await page.locator('#prompt').inputValue(),/> ## 解释 1/);
    // A failed request must retain both the original question and a new draft typed during admission.
    await page.evaluate(()=>{modelSetupNeeded=false;});
    let releaseFailure,notifyPending;
    const pending=new Promise(resolve=>notifyPending=resolve),failure=new Promise(resolve=>releaseFailure=resolve);
    await page.route('**/api/chat',async route=>{notifyPending();await failure;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'连接暂时中断'})});});
    await page.locator('#prompt').fill('这是发出去但暂时失败的问题');await page.locator('.send-button').click();await pending;
    assert.equal(await page.locator('#prompt').inputValue(),'');await page.locator('#prompt').fill('等待时新写的问题');releaseFailure();
    await page.waitForSelector('#recover-prompt');assert.equal(await page.locator('#prompt').inputValue(),'等待时新写的问题');
    await page.locator('#recover-prompt').click();await page.locator('#picker-confirm').click();await page.waitForFunction(()=>!document.querySelector('#picker').open);
    assert.equal(await page.locator('#prompt').inputValue(),`等待时新写的问题

这是发出去但暂时失败的问题`);
    await page.unroute('**/api/chat');
    // Switching chats preserves their own drafts, including a chat preview beside another file.
    await page.locator('#conversation-menu').click();await page.locator('[data-chat-channel="desktop"]').click();await page.locator('#prompt').fill('桌面的独立草稿');
    await page.locator('#conversation-menu').click();await page.locator(`[data-chat-channel="${note.id}"]`).click();assert.match(await page.locator('#prompt').inputValue(),/等待时新写的问题/);
    await page.locator('#prompt').press('Control+k');await page.locator('.picker-search').fill('物理');await page.locator(`input[value="${other.id}"]`).check();await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('.markdown-body h1')?.textContent==='用户修改，失败也要保留');
    await page.locator('#prompt').press('Control+Shift+f');await page.waitForSelector('#history-search');await page.locator('#history-search').press('Escape');
    assert.ok(!await page.locator('#picker').evaluate(dialog=>dialog.open));
    // Narrow desktop windows retain usable controls without horizontal overflow.
    await page.setViewportSize({width:390,height:844});if(await page.locator('#restore-assistant').isVisible())await page.locator('#restore-assistant').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('Round 3 passed: saved-history search, find navigation, transcript scroll recovery, copy text/code, question reuse, separate chat drafts and failed-send recovery.');
    assert.deepEqual(errors,[]);
    if(process.env.STUDY_UI_CAPTURE){fs.mkdirSync(path.join(root,'ui/previews'),{recursive:true});await page.screenshot({path:path.join(root,'ui/previews/interactions.png')});}
  }finally{
    await browser?.close();if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}fs.rmSync(data,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exit(1);});
