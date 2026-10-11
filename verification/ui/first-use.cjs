// Ordinary-user checks against the real app-owned backend, with no model calls.
const {chromium}=require(process.env.STUDY_UI_PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const root=process.env.STUDY_TEST_RUNTIME||path.resolve(__dirname,'../..');
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'学习桌面 空格-first-use-'));
  const env={...process.env};delete env.DEEPSEEK_API_KEY;
  const child=spawn(process.env.STUDY_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),['-X','utf8','packages/agent/desktop.py','--data',data],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let diagnostics='',browser,ready;
  child.stderr.on('data',chunk=>diagnostics+=chunk);
  const exited=new Promise(resolve=>child.once('close',resolve));
  try{
    ready=await new Promise((resolve,reject)=>{child.stdout.once('data',chunk=>resolve(JSON.parse(chunk.toString())));child.once('error',reject);child.once('exit',()=>reject(new Error(diagnostics)));});
    const origin=`http://127.0.0.1:${ready.port}`;
    async function api(route,value){const response=await fetch(origin+route,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;}
    browser=await chromium.launch({headless:true,executablePath:process.env.STUDY_UI_BROWSER||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.waitForSelector('#model-setup:not([hidden])');
    assert.equal(await page.locator('#picker').evaluate(element=>element.open),false);
    await page.reload();await page.waitForSelector('#model-setup:not([hidden])');
    assert.equal(await page.locator('#picker').evaluate(element=>element.open),false);
    // Reading and receiving files work before model configuration.
    await page.locator('#file-input').setInputFiles({name:'已有课堂稿.md',mimeType:'text/markdown',buffer:Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('# 函数与导数\r\n已有原稿，无需转写。','utf16le')])});
    await page.waitForSelector('button[aria-label="打开 已有课堂稿.md"]');
    await page.getByRole('button',{name:'打开 已有课堂稿.md',exact:true}).click();await page.waitForSelector('.markdown-body h1');assert.equal(await page.locator('.markdown-body h1').textContent(),'函数与导数');
    const initial=await api('/api/state');assert.equal(initial.files[0].folder,null);assert.equal(initial.transcription.installed,false);
    assert.equal(fs.existsSync(path.join(data,'.transcription/venv')),false);
    await page.locator('#settings').click();await page.locator('#model-key').fill('first-use-private-test-key');await page.locator('#picker-confirm').click();
    await page.waitForFunction(async()=>Boolean((await(await fetch('/api/settings')).json()).configured));
    assert.equal((await api('/api/settings')).configured,true);
    assert.ok(!JSON.stringify(await api('/api/state')).includes('first-use-private-test-key'));
    // A task can belong to a course without forcing today's date.
    await api('/api/workspace',{action:'course',args:{code:'DEMO',name:'数学'},semester:'initial'});
    const course=(await api('/api/state')).courses[0];
    await page.reload();await page.waitForFunction(()=>courses.some(course=>course.code==='DEMO'));await page.waitForSelector('#back');
    assert.equal(await page.locator('#picker').evaluate(element=>element.open),false);
    assert.equal(await page.locator('#model-setup').evaluate(element=>element.hidden),true);
    await page.locator('#back').click();await page.locator('#new-task').click();
    await page.locator('#task-title').fill('有空时复习');await page.locator('#task-new-course').selectOption(course.id);await page.locator('#task-date').fill('');await page.locator('#picker-confirm').click();
    await page.waitForFunction(async()=>{const state=await(await fetch('/api/state')).json();return state.tasks.some(task=>task.title==='有空时复习');});
    const before=await api('/api/state');assert.equal(before.tasks.length,1);assert.equal(before.tasks[0].scheduled_date,null);
    const backup=Buffer.from(await(await fetch(origin+'/api/semester-export?semester=initial')).arrayBuffer());
    await page.locator('#semester-menu').click();await page.locator('#semester-action').selectOption('import');
    await page.locator('#semester-backup').setInputFiles({name:'学期备份.zip',mimeType:'application/zip',buffer:backup});await page.locator('#picker-confirm').click();
    await page.waitForFunction(async()=>{const state=await(await fetch('/api/state')).json();return state.semesters.items.length===2;});
    const after=await api('/api/state');assert.equal(after.semesters.active,'initial');assert.equal(after.files[0].sha256,before.files[0].sha256);
    assert.deepEqual(errors,[]);
    console.log('First use passed: no-key reading, inbox upload, existing transcript without downloads, private settings, unscheduled course task and independent backup restore. No model calls.');
    // Desktop update events update only their own controls, preserving unsaved settings.
    assert.equal(await page.locator('#app-update').evaluate(element=>element.hidden),true);
    const desktopPage=await browser.newPage();
    await desktopPage.addInitScript(()=>{
      let listener;window.updateActions=[];
      window.studyDesktop={updates:{
        state:async()=>({status:'idle',current:'0.1.2',canInstall:true}),
        subscribe:callback=>{listener=callback;return ()=>{};},
        check:async()=>{window.updateActions.push('check');return {status:'current',current:'0.1.2',canInstall:true};},
        download:async()=>{window.updateActions.push('download');return {status:'downloading',current:'0.1.2',canInstall:true,percent:0};},
        install:async()=>{window.updateActions.push('install');return {status:'installing',current:'0.1.2',canInstall:true};}
      }};
      window.updateEvent=state=>listener({current:'0.1.2',version:'0.1.3',canInstall:true,...state});
    });
    await desktopPage.goto(origin);await desktopPage.waitForSelector('#folders');
    await desktopPage.evaluate(()=>window.updateEvent({status:'available'}));
    await desktopPage.locator('#app-update').click();
    await desktopPage.locator('#model-key').fill('unsaved-private-key');
    await desktopPage.getByRole('button',{name:'下载更新',exact:true}).click();
    assert.deepEqual(await desktopPage.evaluate(()=>window.updateActions),['download']);
    await desktopPage.evaluate(()=>window.updateEvent({status:'downloading',percent:42}));
    assert.equal(await desktopPage.locator('#model-key').inputValue(),'unsaved-private-key');
    assert.equal(await desktopPage.locator('[data-update-action]').isDisabled(),true);
    await desktopPage.evaluate(()=>window.updateEvent({status:'ready'}));
    await desktopPage.locator('#update-settings').getByRole('button',{name:'重启更新',exact:true}).click();
    assert.deepEqual(await desktopPage.evaluate(()=>window.updateActions),['download','install']);
    await desktopPage.evaluate(()=>window.updateEvent({status:'available',canInstall:false}));
    assert.equal(await desktopPage.getByRole('button',{name:'查看新版',exact:true}).count(),1);
    assert.deepEqual(await desktopPage.evaluate(()=>window.updateActions),['download','install']);
    console.log('Desktop update UI passed: optional prompt, download/restart controls and unsaved settings preserved.');
    await desktopPage.close();
    await api('/api/app-close',{token:ready.close_token});
  }finally{
    await browser?.close();if(child.exitCode===null)child.kill('SIGTERM');await exited;fs.rmSync(data,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exit(1);});
