const {app,BrowserWindow,dialog,shell,ipcMain}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
app.setName('Study Agent');
let window,backend,updates,stopping=false,origin,closeToken,exitStatus=0,shutdownPromise;
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
function pythonPath(root){return process.platform==='win32'?path.join(root,'python.exe'):path.join(root,'bin','python3');}
async function launch(){
  if(process.env.STUDY_DESKTOP_SMOKE){app.setPath('userData',fs.mkdtempSync(path.join(app.getPath('temp'),'study-desktop-smoke-')));}
  window=new BrowserWindow({show:!process.env.STUDY_DESKTOP_SMOKE,width:1400,height:940,minWidth:900,minHeight:640,title:'Study Agent',backgroundColor:'#eef5ff',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
  await window.loadFile(path.join(__dirname,'boot.html'));
  const resources=process.resourcesPath;
  const runtime=process.env.STUDY_DESKTOP_RUNTIME||path.join(resources,'runtime');
  const python=process.env.STUDY_DESKTOP_PYTHON||pythonPath(path.join(resources,'python'));
  const tex=process.env.STUDY_DESKTOP_TEX||path.join(resources,'tex');
  const node=path.join(runtime,process.platform==='win32'?'node.exe':'node');
  const texBin=process.platform==='win32'?path.join(tex,'bin','windows'):path.join(tex,'bin','universal-darwin');
  const data=path.join(app.getPath('userData'),'learning');
  fs.mkdirSync(data,{recursive:true});
  const env={...process.env,STUDY_NATIVE:'1',STUDY_NODE:node,PYTHONUTF8:'1',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PATH:[path.dirname(node),texBin,process.env.PATH||''].join(path.delimiter),TEXMFVAR:path.join(app.getPath('userData'),'tex-cache'),TEXMFCONFIG:path.join(app.getPath('userData'),'tex-config')};
  delete env.PYTHONHOME;delete env.PYTHONPATH;
  backend=spawn(python,['-X','utf8',path.join(runtime,'packages','agent','desktop.py'),'--data',data],{cwd:runtime,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',ready=false;
  const timeout=setTimeout(()=>failed('软件未能完成启动。请重新打开；学习资料仍保留。'),60000);
  backend.stdout.on('data',chunk=>{
    output+=chunk.toString();let newline;
    while((newline=output.indexOf('\n'))>=0){
      const line=output.slice(0,newline);output=output.slice(newline+1);
      let event;try{event=JSON.parse(line);}catch{continue;}
      if(event.ready&&!ready){ready=true;closeToken=event.close_token;clearTimeout(timeout);origin=`http://127.0.0.1:${event.port}`;setupUpdates();window.loadURL(origin).then(async()=>{if(process.env.STUDY_DESKTOP_SMOKE){const okay=await window.webContents.executeJavaScript("Boolean(document.querySelector('#settings') && document.querySelector('#folders') && window.studyDesktop?.updates)");if(!okay)return failed('安装包界面检查失败');console.log('Packaged desktop opened its own backend, update bridge and learning UI.');app.quit();}}).catch(()=>failed('学习桌面未能打开，请重新打开软件。'));}
    }
  });
  // Diagnostic output stays private and bounded; never include model credentials in dialogs.
  let diagnostics='';backend.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-16000);});
  function failed(message){clearTimeout(timeout);if(stopping)return;exitStatus=1;if(!process.env.STUDY_DESKTOP_SMOKE)dialog.showErrorBox('无法打开 Study Agent',message);else console.error(message);app.quit();}
  backend.once('error',()=>failed('安装中的运行组件无法启动。请重新安装软件；不要删除学习资料。'));
  backend.once('exit',()=>{if(!stopping)failed('学习助理的运行服务已退出。请重新打开软件；已保存资料仍保留。');});
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(url!==origin&&!url.startsWith(origin+'/')){event.preventDefault();if(/^https:\/\//.test(url))shell.openExternal(url);}});
}
function setupUpdates(){
  const {autoUpdater}=require('electron-updater');
  const {DesktopUpdates}=require('./updater.cjs');
  updates=new DesktopUpdates({updater:autoUpdater,version:app.getVersion(),enabled:app.isPackaged&&!process.env.STUDY_DESKTOP_SMOKE,
    canInstall:process.platform!=='darwin'||Boolean(require('./package.json').studyMacUpdates),
    notify:state=>{if(window&&!window.isDestroyed())window.webContents.send('study:update-state',state);},
    openRelease:url=>shell.openExternal(url),
    prepareInstall:async()=>{
      const response=await fetch(origin+'/api/update-ready');if(!response.ok||!(await response.json()).ready)return false;
      const result=await dialog.showMessageBox(window,{type:'question',title:'更新 Study Agent',message:'重启并安装新版本？',detail:'课程资料、学习记录和设置会保留。',buttons:['重启更新','稍后'],defaultId:0,cancelId:1});
      if(result.response!==0)return null;
      // Recheck after the dialog; a new model call may have started in the meantime.
      const checked=await fetch(origin+'/api/update-ready');if(!checked.ok||!(await checked.json()).ready)return false;
      await shutdownBackend(true);return true;
    }});
  ipcMain.handle('study:update',async(event,action)=>{
    if(event.sender!==window?.webContents||event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==origin)throw new Error('此操作不可用');
    if(action==='state')return updates.snapshot();
    if(!['check','download','install'].includes(action))throw new Error('此操作不可用');
    return updates[action]();
  });
  if(updates.state.status!=='disabled')setTimeout(()=>updates.check(),10000).unref();
}
function shutdownBackend(idleOnly=false){
  if(shutdownPromise)return shutdownPromise;
  stopping=true;
  shutdownPromise=(async()=>{
    if(!backend||backend.exitCode!==null)return;
    // Obtain the idle lock before starting any force-exit timer.
    if(idleOnly){
      const response=await fetch(origin+'/api/app-close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:closeToken,require_idle:true}),signal:AbortSignal.timeout(3000)});
      if(!response.ok)throw new Error('当前操作尚未结束');
    }
    await new Promise((resolve,reject)=>{
      if(backend.exitCode!==null){resolve();return;}
      function forceExit(){
        if(backend.exitCode!==null)return;
        if(process.platform==='win32')spawn('taskkill',['/PID',String(backend.pid),'/T','/F'],{windowsHide:true});
        else backend.kill('SIGKILL');
      }
      const timer=setTimeout(forceExit,6000);
      const deadline=setTimeout(()=>{clearTimeout(timer);backend.removeListener('exit',exited);reject(new Error('运行服务未能退出'));},10000);
      function exited(){clearTimeout(timer);clearTimeout(deadline);resolve();}
      backend.once('exit',exited);
      if(!idleOnly){
        if(origin&&closeToken)fetch(origin+'/api/app-close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:closeToken}),signal:AbortSignal.timeout(3000)}).catch(()=>{});
        else if(process.platform==='win32')spawn('taskkill',['/PID',String(backend.pid),'/T','/F'],{windowsHide:true});
        else backend.kill('SIGTERM');
      }
    });
  })().catch(error=>{stopping=false;shutdownPromise=null;throw error;});
  return shutdownPromise;
}
app.whenReady().then(launch).catch(()=>{exitStatus=1;if(!process.env.STUDY_DESKTOP_SMOKE)dialog.showErrorBox('无法打开 Study Agent','软件启动未完成，请重新安装。');else console.error('软件启动未完成');app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(stopping||!backend||backend.exitCode!==null)return;
  event.preventDefault();shutdownBackend().then(()=>app.exit(exitStatus)).catch(()=>app.exit(1));
});
