const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {MacDownloadUpdater}=require('../../packages/desktop/mac-download-updater.cjs');
const {DesktopUpdates}=require('../../packages/desktop/updater.cjs');

test('Mac downloads in-app, checks bytes and cache, opens the local installer and never navigates to GitHub',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-mac-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bytes=Buffer.from('Fixture installation disk: never executed'),filename=`Study-Agent-0.1.9-mac-${process.arch}.dmg`;
  let corrupt=false,requests=0,version='0.1.9';
  const metadata=()=>({version,files:[{url:filename,size:bytes.length,sha512:crypto.createHash('sha512').update(bytes).digest('base64')}]});
  const server=http.createServer((req,res)=>{
    if(req.url.endsWith('.yml'))res.end(JSON.stringify(metadata()));
    else if(req.url.endsWith('.dmg')){requests++;res.end(corrupt?Buffer.from('Damaged installer'):bytes);}
    else{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const make=(folder,current='0.1.8',openInstaller=async()=>'',quit=()=>{})=>new MacDownloadUpdater({version:current,cache:path.join(root,folder),fetch,baseURL:`http://127.0.0.1:${server.address().port}`,openInstaller,quit});
  let opened,quits=0;
  const updater=make('good','0.1.8',async file=>{opened=file;return '';},()=>{quits++;});
  const updates=new DesktopUpdates({updater,version:'0.1.8',installKind:'installer'});
  await updates.check();
  await new Promise((resolve,reject)=>{if(updates.state.status==='ready')return resolve();const timer=setTimeout(()=>reject(new Error('Background download did not complete')),10000);updater.once('update-downloaded',()=>{clearTimeout(timer);resolve();});});
  assert.equal(updates.state.status,'ready');assert.equal(requests,1);
  assert.deepEqual(fs.readFileSync(updater.downloadedFile),bytes);
  await updates.install();assert.equal(opened,updater.downloadedFile);assert.equal(quits,1);
  const cached=make('good');await cached.checkForUpdates();await cached.downloadUpdate();assert.equal(requests,1);
  fs.appendFileSync(cached.downloadedFile,'corrupted after download');
  await assert.rejects(cached.quitAndInstall(),/changed/);
  const failedOpen=make('open-error','0.1.8',async()=> 'Cannot mount',()=>{throw new Error('Must not quit');});
  const retry=new DesktopUpdates({updater:failedOpen,version:'0.1.8',backgroundDownload:false});
  await retry.check();await retry.download();await retry.install();assert.equal(retry.state.status,'ready');
  corrupt=true;const damaged=make('damaged');await damaged.checkForUpdates();await assert.rejects(damaged.downloadUpdate(),/checksum|size/);
  assert.equal(fs.existsSync(path.join(root,'damaged',filename)),false);
  assert.equal(fs.existsSync(path.join(root,'damaged',filename+'.partial')),false);
  const newer=make('newer','0.2.0');await newer.checkForUpdates();assert.equal(newer.info,undefined);
  version='../../bad';await assert.rejects(make('unsafe').checkForUpdates(),/version/);
});
