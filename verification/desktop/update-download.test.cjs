const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {NsisUpdater}=require('../../packages/desktop/node_modules/electron-updater');
const {ElectronHttpExecutor}=require('../../packages/desktop/node_modules/electron-updater/out/electronHttpExecutor');
const {DesktopUpdates}=require('../../packages/desktop/updater.cjs');
const yaml=require('../../packages/desktop/node_modules/js-yaml');

test('real updater downloads verified bytes, rejects corruption and refuses a downgrade',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-updater-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('Test payload; never executed.');let corrupt=false,downloads=0;
  const server=http.createServer((req,res)=>{
    if(/^\/latest(?:-linux|-mac)?\.yml(?:\?|$)/.test(req.url)){res.setHeader('Content-Type','text/yaml');res.end(yaml.dump({version:'0.1.3',files:[{url:'Study-Agent-0.1.3-win-x64.exe',size:bytes.length,sha512:crypto.createHash('sha512').update(bytes).digest('base64')}]}));}
    else if(req.url.startsWith('/Study-Agent-0.1.3-win-x64.exe')){downloads++;res.end(corrupt?Buffer.from('Damaged payload'):bytes);}
    else{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  function create(version,cache){
    const data=path.join(root,cache);fs.mkdirSync(data);
    const config=path.join(data,'app-update.yml');fs.writeFileSync(config,'updaterCacheDirName: study-agent\n');
    const app={version,name:'Study Agent',isPackaged:true,appUpdateConfigPath:config,userDataPath:data,baseCachePath:data,whenReady:async()=>{},onQuit(){},quit(){throw new Error('Installer must never execute in tests');},relaunch(){}};
    const updater=new NsisUpdater(null,app);
    class LocalExecutor extends ElectronHttpExecutor{createRequest(options,callback){assert.equal(options.hostname,'127.0.0.1');return http.request(options,callback);}}
    updater.httpExecutor=new LocalExecutor();updater.setFeedURL({provider:'generic',url:'http://127.0.0.1:'+server.address().port});updater.disableDifferentialDownload=true;
    return new DesktopUpdates({backgroundDownload:false,updater,version});
  }
  const good=create('0.1.2','good');let error;good.updater.on('error',e=>{error=e;});await good.check();assert.equal(good.snapshot().status,'available',String(error));assert.equal(downloads,0);
  await good.download();assert.equal(good.snapshot().status,'ready',String(error));
  assert.deepEqual(fs.readFileSync(good.updater.downloadedUpdateHelper.file),bytes);
  corrupt=true;const damaged=create('0.1.2','damaged');await damaged.check();await damaged.download();assert.equal(damaged.snapshot().status,'error');
  const newer=create('0.1.4','newer');await newer.check();assert.equal(newer.snapshot().status,'current');assert.equal(downloads,2);
});
