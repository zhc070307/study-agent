// Browser -> cloud storage -> actual upstream SDK/tools -> ledger and Chinese PDF.
// All data temporary; deterministic model responses; never calls DeepSeek.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const packages=path.join(root,'node_modules/.pnpm');
const packageName=fs.readdirSync(packages).find(name=>/^playwright@\d/.test(name));
const {chromium}=require(process.env.STUDY_UI_PLAYWRIGHT_MODULE || path.join(packages,packageName,'node_modules/playwright'));
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'study-web-check-'));
  let processChild=spawn('python3',[path.join(__dirname,'serve-test.py'),data],{cwd:root,stdio:['ignore','pipe','pipe']});
  let diagnostics='';processChild.stderr.on('data',chunk=>diagnostics+=chunk);
  const port=await new Promise((resolve,reject)=>{processChild.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim())));processChild.once('exit',code=>reject(new Error('Server exited '+code+': '+diagnostics)));});
  const origin=`http://127.0.0.1:${port}`;
  async function api(endpoint,value){const response=await fetch(origin+endpoint,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
  const op=(action,args,id=crypto.randomUUID())=>api('/api/workspace',{action,args,id,semester:'initial'});
  let browser;
  try {
    const course=await op('course',{code:'CALC',name:'微积分'});
    const folder={id:course.folders.materials};
    const source=await op('create',{name:'导数笔记.md',mime:'text/markdown',text:fs.readFileSync(path.join(root,'ui/samples/notes/derivatives.md'),'utf8'),folder:folder.id});
    const latex=await op('create',{name:'向量与坐标.tex',mime:'text/x-tex',text:fs.readFileSync(path.join(root,'ui/samples/notes/vectors.tex'),'utf8'),folder:folder.id});
    const pdf=await op('create',{name:'导数与微分.pdf',mime:'application/pdf',data:fs.readFileSync(path.join(root,'ui/samples/materials/derivatives.pdf')).toString('base64'),folder:folder.id});
    const exampleTask=await op('task',{title:'查看导数笔记',file:source.id});
    // Read-only/host boundary: arbitrary uploaded active content cannot become same-origin HTML.
    const html=await op('create',{name:'unsafe.html',mime:'text/html',text:'<script>window.pwned=true</script>',folder:folder.id});
    const served=await fetch(origin+'/api/file/'+html.id);assert.match(served.headers.get('content-type'),/text\/plain/);
    const badHost=await new Promise(resolve=>{require('node:http').get(origin+'/api/state',{headers:{Host:'evil.test'}},response=>{response.resume();resolve(response.statusCode);});});assert.equal(badHost,400);
    const csrf=await fetch(origin+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:JSON.stringify({action:'folder',args:{name:'evil'}})});assert.equal(csrf.status,400);
    const traversal=await fetch(origin+'/api/file/%2e%2e%2fREADME.md');assert.equal(traversal.status,400);
    browser=await chromium.launch({headless:true,executablePath:process.env.STUDY_UI_BROWSER || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[],external=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin+'/'))external.push(request.url());});
    await page.goto(origin);
    await page.waitForSelector('[data-folder="'+course.folder+'"]');
    assert.equal(await page.locator('#files').evaluate(element=>element.hidden),false);
    await page.locator('[data-period="all"]').click();
    if(process.env.STUDY_UI_CAPTURE)await page.screenshot({path:path.join(root,'ui/previews/desktop.png')});
    // User-visible audio tool, using a scripted recognizer in the temporary test workspace.
    const audio=await op('create',{name:'第一讲录音.wav',mime:'audio/wav',data:Buffer.from('scripted audio').toString('base64'),folder:folder.id});
    if(await page.locator('[data-folder="'+course.folder+'"]').count())await page.locator('[data-folder="'+course.folder+'"]').click();
    await page.locator('[data-folder="'+folder.id+'"]').click();
    await page.getByRole('button',{name:'打开 第一讲录音.wav',exact:true}).click();
    await page.locator('#transcribe-file').click();
    await page.waitForFunction(()=>document.querySelector('#transcribe-file')?.textContent==='打开原稿');
    await page.locator('#transcribe-file').click();
    await page.waitForSelector('.file-text');
    assert.match(await page.locator('.file-text').textContent(),/脚本化转写示例/);
    let speechState=await api('/api/state');
    const transcript=speechState.files.find(file=>file.name==='第一讲录音-原稿.txt');
    assert.equal(transcript.folder,folder.id);assert.deepEqual(transcript.sources,[audio.id]);
    assert.equal(speechState.transcription.jobs[0].status,'completed');
    await page.locator('#back').click();
    assert.equal(await page.evaluate(()=>state.folder),null);
    await page.locator('[data-period="all"]').click();
    await page.locator('[data-task="'+exampleTask.id+'"]').check();
    await page.waitForFunction(async id=>{const data=await (await fetch('/api/state')).json();return data.tasks.find(task=>task.id===id)?.done&&data.drafts.__layout?.active===null&&data.drafts.__layout?.folder===null;},exampleTask.id);
    await page.reload();await page.waitForSelector('[data-task="'+exampleTask.id+'"]',{state:'attached'});assert.ok(await page.locator('[data-task="'+exampleTask.id+'"]').isChecked());
    await page.locator('.completed-tasks>summary').click();
    await page.locator('[data-task-open="'+source.id+'"]').click();
    await page.waitForSelector('.markdown-body h1');
    await page.locator('[data-mode="source"]').click();assert.equal(await page.locator('.file-text').textContent(),source.text);
    await page.locator('[data-mode="preview"]').click();
    // Native physical selection, preserving the selected original text and actual file identity.
    await page.locator('.markdown-body h1').dblclick({position:{x:30,y:16}});
    await page.waitForSelector('#quote-bar:not([hidden])');
    if(process.env.STUDY_UI_CAPTURE)await page.screenshot({path:path.join(root,'ui/previews/file.png')});
    await page.locator('#ask-selection').click();
    await page.locator('#prompt').fill('请解释导数并组织练习、生成 PDF。约定不设置阅读与练习先后。');
    await page.locator('.send-button').click();
    await page.waitForSelector('.chat-progress');
    assert.match(await page.locator('#conversation').textContent(),/请解释导数并组织练习/);
    console.log('Checking SDK generation and PDF');
    await page.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('核对项 10'),{},{timeout:90000});
    assert.equal((await api('/api/state')).runtime.status,'running','Reply must be visible before the model finishes');
    await page.locator('#conversation').evaluate(element=>{
      element.scrollTop=0;
      const body=element.querySelector('.user .chat-body'),range=document.createRange();range.selectNodeContents(body);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    });
    assert.equal(await page.locator('#chat-latest').count(),0);
    await page.evaluate(()=>connectChat());
    await page.waitForSelector('#stop-agent[hidden]',{state:'attached',timeout:30000});
    assert.equal(await page.locator('#conversation').evaluate(element=>element.scrollTop),0,'Streaming must not pull a reader back down');
    assert.match(await page.evaluate(()=>getSelection().toString()),/请解释导数/,'Updates must preserve selected history');
    assert.equal(await page.locator('.message.user').count(),1,'Reconnecting must not duplicate messages');
    await page.waitForTimeout(2300);
    assert.equal(await page.locator('#conversation').evaluate(element=>element.scrollTop),0,'Periodic refresh must preserve the scroll position');
    await page.locator('#conversation').evaluate(node=>{node.scrollTop=node.scrollHeight});
    assert.ok(await page.locator('#conversation').evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop<24));
    await page.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('练习与 PDF 已保存')||document.querySelector('#conversation').textContent.includes('本次处理未完成'),{},{timeout:90000});
    console.log('SDK generation completed');
    let state=await api('/api/state');assert.equal(state.runtime.error,null,JSON.stringify(state.messages));
    assert.ok(await page.locator('.chat-body strong').count()>0);
    assert.ok(state.files.some(file=>file.name==='平方函数练习.md'));
    assert.ok(state.files.some(file=>file.name==='导数说明.pdf'&&file.accepted));
    assert.ok(state.tasks.some(task=>task.title==='完成平方函数练习'&&!task.done));
    assert.ok(state.messages[source.id].some(message=>message.role==='user'&&message.refs.includes('文字选区')));
    assert.equal(state.files.find(file=>file.id===source.id).course,'CALC');
    // Model-created artifact is available directly in its conversation.
    await page.getByRole('button',{name:'平方函数练习.md',exact:true}).click();
    await page.locator('.answer-input').fill("f'(3)=2×3=6，表示 x=3 时的瞬时变化率。");
    await page.locator('.save-answer').click();await page.waitForFunction(()=>document.querySelector('.answer-status')?.textContent==='已保存');
    await page.locator('.ask-answer').click();await page.locator('.send-button').click();
    await page.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('作答反馈已登记'),{},{timeout:30000});
    const exercise=state.files.find(file=>file.name==='平方函数练习.md');
    await page.locator('#prompt').fill('下次想继续讨论');await page.waitForTimeout(650);
    await page.reload();await page.waitForSelector('.answer-input');
    assert.match(await page.locator('.answer-input').inputValue(),/2×3=6/);
    assert.equal(await page.locator('#prompt').inputValue(),'下次想继续讨论');
    assert.match(await page.locator('#conversation').textContent(),/作答反馈已登记/);
    // PDF viewer: real second-page native selection and zoom.
    await page.locator('#compare').click();await page.locator('#picker-body input[value="'+pdf.id+'"]').check();await page.locator('#picker-confirm').click();
    await page.waitForSelector('.pdf-sheet[data-rendered]');
    await page.locator('[data-pdf="next"]').click();await page.waitForSelector('.pdf-sheet[data-page-number="2"][data-rendered]');
    const span=page.locator('.textLayer span').filter({hasText:/[\p{L}\p{N}]{2}/u}).first();await span.dblclick();await page.waitForSelector('#quote-bar:not([hidden])');if(process.env.STUDY_UI_CAPTURE)await page.screenshot({path:path.join(root,'ui/previews/pdf.png')});
    await page.locator('#ask-selection').click();assert.match(await page.locator('#contexts').textContent(),/选区/);
    await page.locator('[data-pdf="in"]').click();await page.waitForFunction(()=>document.querySelector('.pdf-zoom')?.textContent==='115%');
    await page.locator('#close-compare').click();
    // Compilation from the UI and old-PDF preservation on a real TeX error.
    await page.locator('#back').click();while(await page.locator('#clear-folder').isVisible())await page.locator('#clear-folder').click();if(await page.locator('[data-folder="'+course.folder+'"]').count())await page.locator('[data-folder="'+course.folder+'"]').click();
    await page.locator('[data-folder="'+folder.id+'"]').click();
    await page.getByRole('button',{name:'打开 向量与坐标.tex',exact:true}).click();
    await page.locator('#compile-file').click();await page.waitForSelector('.pdf-sheet[data-rendered]',{timeout:30000});
    state=await api('/api/state');const generated=state.files.find(file=>file.id===latex.id).pdf;assert.ok(generated);
    const oldPdf=state.files.find(file=>file.id===generated.file);
    await page.locator('#edit-file').click();await page.locator('#edit-text').fill('\\badcommand');await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('.compile-status')?.textContent.includes('编译失败'),{},{timeout:30000});
    state=await api('/api/state');assert.equal(state.files.find(file=>file.id===oldPdf.id).sha256,oldPdf.sha256);
    assert.equal(state.files.find(file=>file.id===latex.id).compile_result.ok,false);
    await page.locator('#view-pdf').click();await page.locator('#history-file').click();await page.waitForSelector('#picker-body input[name=version]');const versions=page.locator('#picker-body input');assert.ok(await versions.count()>=2);await versions.last().check();await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('.compile-status')?.textContent.includes('源码已修改')||document.querySelector('.file-text')?.textContent.includes('documentclass'));
    // Stop a genuinely running SDK stream, then retain saved results.
    await page.locator('#prompt').fill('继续');await page.locator('.send-button').click();await page.waitForSelector('#stop-agent:not([hidden])');await page.locator('#stop-agent').click();
    await page.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('已停止'),{},{timeout:15000});
    await page.reload();await page.waitForSelector('[data-folder]',{state:'attached'});assert.ok((await api('/api/state')).files.some(file=>file.id===exercise.id));
    // Upload from the browser, and server-side rename/move with reload.
    await page.locator('#back').click();while(await page.locator('#clear-folder').isVisible())await page.locator('#clear-folder').click();if(await page.locator('[data-folder="'+course.folder+'"]').count())await page.locator('[data-folder="'+course.folder+'"]').click();
    await page.locator('[data-folder="'+folder.id+'"]').click();
    await page.locator('#file-input').setInputFiles({name:'new.md',mimeType:'',buffer:Buffer.from('# 新上传\n\n<script>window.pwned=true</script>\n![远程](https://example.com/x.png)')});
    await page.waitForSelector('button[aria-label="打开 new.md"]');assert.equal((await api('/api/state')).files.find(file=>file.name==='new.md').folder,null);await page.getByRole('button',{name:'打开 new.md',exact:true}).click();await page.waitForSelector('.markdown-body h1');assert.equal(await page.evaluate(()=>window.pwned),undefined);
    await page.locator('#rename').click();await page.locator('#rename-input').fill('新文件.md');await page.locator('#picker-confirm').click();await page.waitForTimeout(600);
    await page.reload();await page.waitForFunction(()=>document.querySelector('#document-tabs').textContent.includes('新文件.md'));
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    // An unconfigured app offers an inline setup entry without opening a modal.
    await page.setViewportSize({width:1440,height:960});
    await page.route('**/api/settings',async route=>{
      if(route.request().method()!=='GET')return route.continue();
      const response=await route.fetch();const value=await response.json();
      await route.fulfill({json:{...value,needs_setup:!value.configured}});
    });
    await page.reload();await page.waitForSelector('#model-setup:not([hidden])');
    assert.equal(await page.locator('#picker').evaluate(element=>element.open),false);
    await page.reload();await page.waitForSelector('#model-setup:not([hidden])');
    assert.equal(await page.locator('#picker').evaluate(element=>element.open),false);
    await page.locator('#prompt').fill('未配置时保留的问题');await page.locator('.send-button').click();
    await page.waitForSelector('#model-key');
    assert.equal(await page.locator('#prompt').inputValue(),'未配置时保留的问题');
    await page.locator('#model-key').fill('browser-settings-fixture');await page.locator('#picker-confirm').click();
    await page.waitForSelector('#model-setup[hidden]',{state:'attached'});
    await page.reload();await page.waitForSelector('[data-folder]',{state:'attached'});
    assert.equal(await page.locator('#picker').evaluate(element=>element.open),false);
    assert.equal((await api('/api/settings')).configured,true);
    // Restart the actual HTTP process and recover the same desk, conversations and answers.
    processChild.kill('SIGTERM');await new Promise(resolve=>processChild.once('exit',resolve));
    processChild=spawn('python3',[path.join(__dirname,'serve-test.py'),data,String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
    processChild.stderr.on('data',chunk=>diagnostics+=chunk);
    const restartedPort=await new Promise((resolve,reject)=>{processChild.stdout.once('data',chunk=>resolve(Number(chunk.toString().trim())));processChild.once('exit',code=>reject(new Error('Restart exited '+code)));});
    assert.equal(restartedPort,port);
    assert.equal((await api('/api/settings')).configured,true,'Saved key must survive a full service restart');
    await page.setViewportSize({width:1440,height:960});await page.reload();await page.waitForSelector('[data-folder]',{state:'attached'});
    await page.locator('#back').click();while(await page.locator('#clear-folder').isVisible())await page.locator('#clear-folder').click();
    await page.locator('[data-period="all"]').click();await page.getByRole('button',{name:/^完成平方函数练习/}).click();await page.waitForSelector('.answer-input');
    assert.match(await page.locator('.answer-input').inputValue(),/2×3=6/);
    await page.locator('#conversation-menu').click();await page.locator('#history-search').fill('作答反馈已登记');await page.locator('.history-row').click();
    assert.ok(await page.locator('.answer-input').isVisible(),'Looking up prior feedback keeps the practice open');
    assert.match(await page.locator('#conversation').textContent(),/作答反馈已登记/);
    const recovered=await api('/api/state');assert.ok(recovered.tasks.find(task=>task.id===exampleTask.id).done);assert.ok(recovered.files.find(file=>file.id===oldPdf.id));
    // Durable domain feedback and flow edits, not just UI messages.
    const {execFileSync}=require('node:child_process');
    const result=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({'assessments':c.execute('SELECT COUNT(*) FROM assessment_attempts').fetchone()[0],'flows':c.execute('SELECT COUNT(*) FROM flow_active WHERE flow="memory"').fetchone()[0],'answers':c.execute('SELECT COUNT(*) FROM desktop_answers').fetchone()[0]}))`,path.join(data,'.study-system/data/task_memory.sqlite3')],{encoding:'utf8'}));
    assert.equal(result.assessments,1);assert.equal(result.flows,1);assert.ok(result.answers>=2);
    // Third perspective: close a semester, start another, and recover the old one.
    await page.locator('#back').click();while(await page.locator('#clear-folder').isVisible())await page.locator('#clear-folder').click();
    const removable=(await api('/api/state')).files.find(f=>f.name==='新文件.md');
    await page.locator('[data-id="'+removable.id+'"] .file-check').check();
    page.once('dialog',dialog=>dialog.accept());await page.locator('#remove-files').click();
    await page.waitForSelector('#file-trash:not([hidden])');
    assert.ok((await api('/api/state')).trash.some(f=>f.id===removable.id));
    await page.locator('#file-trash').click();await page.locator('#picker-body input[value="'+removable.id+'"]').check();await page.locator('#picker-confirm').click();
    await page.waitForSelector('button[aria-label="打开 新文件.md"]');
    await page.locator('#semester-menu').click();await page.locator('#semester-action').selectOption('create');
    page.once('dialog',dialog=>dialog.accept('下个学期'));await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#semester-menu').textContent==='下个学期');
    const next=await api('/api/state');assert.equal(next.files.length,0);assert.equal(next.tasks.length,0);assert.equal(next.courses.length,0);
    assert.ok(next.agreements.references.some(r=>r.scope==='learning'&&r.key==='学习安排'));
    await page.locator('#semester-menu').click();await page.locator('#picker-body input[value="initial"]').check();await page.locator('#semester-action').selectOption('switch');await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#semester-menu').textContent==='当前学期');
    assert.ok((await api('/api/state')).files.some(f=>f.id===removable.id));
    await page.locator('#semester-menu').click();await page.locator('#semester-action').selectOption('archive');
    page.once('dialog',dialog=>dialog.accept());await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#semester-menu').textContent.includes('已归档'));
    assert.ok(await page.locator('#prompt').isDisabled());
    await page.locator('#semester-menu').click();await page.locator('#semester-action').selectOption('reopen');await page.locator('#picker-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#semester-menu').textContent==='当前学期');
    assert.ok(await page.locator('#prompt').isEnabled());
    // A normal desk with several courses, an inbox, and dozens of daily tasks.
    await page.locator('#back').click();while(await page.locator('#clear-folder').isVisible())await page.locator('#clear-folder').click();
    for(const [code,title] of [['PHYS','大学物理'],['LINALG','线性代数'],['CS','计算机基础']]){
      await op('course',{code,name:title});
      for(let number=1;number<=8;number++)await op('task',{title:`${title} · 练习 ${number}`,course:code});
    }
    await page.reload();await page.waitForSelector('.task-group');
    assert.ok(await page.locator('.task-group').count()>=3);
    assert.ok(await page.locator('#tasks').evaluate(element=>element.scrollHeight>element.clientHeight));
    await page.locator('#task-course').selectOption('phys');assert.equal(await page.locator('.task-row:not(.done)').count(),8);
    await page.locator('#task-course').selectOption('');
    await page.locator('.task-group').first().locator('summary').click();assert.equal(await page.locator('.task-group').first().evaluate(element=>element.open),false);
    assert.equal(await page.locator('.quick-actions').count(),0);
    await page.locator('#attach-context').click();await page.locator('.picker-option').first().locator('input').check();await page.locator('#picker-confirm').click();assert.ok(await page.locator('#contexts [data-remove]').count()>0);
    if(process.env.STUDY_UI_CAPTURE)await page.screenshot({path:path.join(root,'ui/previews/desktop.png')});
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.STUDY_UI_CAPTURE)await page.screenshot({path:path.join(root,'ui/previews/mobile.png')});
    assert.deepEqual(errors,[]);
    console.log('Cloud browser end-to-end passed: persistent files/tasks/chat/answers; SDK tools and workflow change; feedback ledger; actual Chinese PDF, page images/quotes, failure recovery and stop; scoped memory, semester change/archive/reopen and file removal/restore. Scripted model only.');
  } catch(error){if(process.env.STUDY_UI_CAPTURE&&browser){const pages=browser.contexts()[0]?.pages();if(pages?.length)await pages[0].screenshot({path:'/workspace/study-blue-failure.png'});}const {execFileSync}=require('node:child_process');const events=execFileSync('python3',['-c',`import pathlib,json,sys; print(json.dumps([json.loads(line)['data'] for p in pathlib.Path(sys.argv[1]).rglob('*.jsonl') for line in p.read_text().splitlines() if json.loads(line).get('type')=='turn/end'],ensure_ascii=False))`,data],{encoding:'utf8'});throw new Error(error.stack+'\nSDK outcomes: '+events+'\nServer: '+diagnostics);}
  finally {await browser?.close();processChild.kill('SIGTERM');await new Promise(resolve=>processChild.once('exit',resolve));fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
