const {app,BrowserWindow,dialog,shell}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
app.setName('Study Agent');
let window,backend,stopping=false,origin,closeToken,exitStatus=0;
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
function pythonPath(root){return process.platform==='win32'?path.join(root,'python.exe'):path.join(root,'bin','python3');}
async function launch(){
  if(process.env.STUDY_DESKTOP_SMOKE){app.setPath('userData',fs.mkdtempSync(path.join(app.getPath('temp'),'study-desktop-smoke-')));}
  window=new BrowserWindow({show:!process.env.STUDY_DESKTOP_SMOKE,width:1400,height:940,minWidth:900,minHeight:640,title:'Study Agent',backgroundColor:'#eef5ff',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
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
      if(event.ready&&!ready){ready=true;closeToken=event.close_token;clearTimeout(timeout);origin=`http://127.0.0.1:${event.port}`;window.loadURL(origin).then(async()=>{if(process.env.STUDY_DESKTOP_SMOKE){const okay=await window.webContents.executeJavaScript("Boolean(document.querySelector('#settings') && document.querySelector('#folders'))");if(!okay)return failed('安装包界面检查失败');console.log('Packaged desktop opened its own backend and learning UI.');app.quit();}}).catch(()=>failed('学习桌面未能打开，请重新打开软件。'));}
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
app.whenReady().then(launch).catch(()=>{exitStatus=1;if(!process.env.STUDY_DESKTOP_SMOKE)dialog.showErrorBox('无法打开 Study Agent','软件启动未完成，请重新安装。');else console.error('软件启动未完成');app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(stopping||!backend||backend.exitCode!==null)return;
  event.preventDefault();stopping=true;
  // Closing the window must also stop model calls and any optional inference worker.
  backend.once('exit',()=>app.exit(exitStatus));
  if(origin&&closeToken)fetch(origin+'/api/app-close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:closeToken})}).catch(()=>{});
  else if(process.platform==='win32')spawn('taskkill',['/PID',String(backend.pid),'/T','/F'],{windowsHide:true});
  else backend.kill('SIGTERM');
  setTimeout(()=>{if(backend.exitCode===null){if(process.platform==='win32')spawn('taskkill',['/PID',String(backend.pid),'/T','/F'],{windowsHide:true});else backend.kill('SIGKILL');}app.exit(exitStatus);},6000).unref();
});
