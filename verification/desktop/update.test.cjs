const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DesktopUpdates}=require('../../packages/desktop/updater.cjs');
const {prepare}=require('../../scripts/prepare-release.cjs');
const yaml=require('../../packages/desktop/node_modules/js-yaml');

class Updater extends EventEmitter{
  checks=0;downloads=0;installs=0;
  async checkForUpdates(){this.checks++;this.emit('update-available',{version:'0.1.3'});return {};}
  async downloadUpdate(){this.downloads++;this.emit('download-progress',{percent:47.4});this.emit('update-downloaded',{version:'0.1.3'});}
  quitAndInstall(silent,relaunch){assert.equal(silent,false);assert.equal(relaunch,true);this.installs++;}
}
test('check, download and restart are separate; busy operations and cancellation preserve the update',async()=>{
  const updater=new Updater();let ready=false;
  const updates=new DesktopUpdates({backgroundDownload:false,updater,version:'0.1.2',prepareInstall:async()=>ready});
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);
  await updates.check();assert.equal(updates.snapshot().status,'available');assert.equal(updater.downloads,0);
  await updates.download();assert.equal(updates.snapshot().status,'ready');
  await updates.check();assert.equal(updater.checks,1);
  await updates.install();assert.equal(updater.installs,0);assert.equal(updates.snapshot().status,'ready');
  ready=null;await updates.install();assert.equal(updater.installs,0);
  ready=true;await updates.install();assert.equal(updater.installs,1);assert.equal(updates.snapshot().status,'installing');
});
test('unpackaged runs stay offline and unsigned Mac uses the release page',async()=>{
  const updater=new Updater(),disabled=new DesktopUpdates({backgroundDownload:false,updater,version:'0.1.2',enabled:false});
  await disabled.check();assert.equal(updater.checks,0);
  let opened;
  const updates=new DesktopUpdates({backgroundDownload:false,updater:new Updater(),version:'0.1.2',canInstall:false,openRelease:url=>{opened=url;}});
  await updates.check();await updates.download();assert.equal(updates.updater.downloads,0);
  assert.equal(opened,'https://github.com/zhc070307/study-agent/releases');
});
test('failed download is recoverable and raw errors stay out of the interface',async()=>{
  const updater=new Updater();updater.downloadUpdate=async()=>{throw new Error('private credentials');};
  const updates=new DesktopUpdates({backgroundDownload:false,updater,version:'0.1.2'});
  await updates.check();await updates.download();assert.equal(updates.snapshot().status,'error');
  assert.ok(!JSON.stringify(updates.snapshot()).includes('private'));await updates.check();assert.equal(updates.snapshot().status,'available');
  updater.emit('download-progress',{percent:150});assert.equal(updates.snapshot().percent,100);
});
test('duplicate checks are suppressed while the first request is pending',async()=>{
  const updater=new Updater();let done;
  updater.checkForUpdates=()=>{updater.checks++;return new Promise(resolve=>{done=resolve;});};
  const updates=new DesktopUpdates({backgroundDownload:false,updater,version:'0.1.2-beta.1'});
  const checking=updates.check();await updates.check();assert.equal(updater.checks,1);assert.equal(updater.allowPrerelease,true);
  done(null);await checking;assert.equal(updates.snapshot().status,'current');
});
test('repeated restart clicks do not open multiple dialogs or install twice',async()=>{
  const updater=new Updater();let done,calls=0;
  const updates=new DesktopUpdates({backgroundDownload:false,updater,version:'0.1.2',prepareInstall:()=>{calls++;return new Promise(resolve=>{done=resolve;});}});
  await updates.check();await updates.download();const installing=updates.install();await updates.install();assert.equal(calls,1);
  done(true);await installing;assert.equal(updater.installs,1);
});
function fixture(t,version='0.1.2'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input=path.join(root,'input'),output=path.join(root,'output');fs.mkdirSync(input);
  const names=['Study-Agent-'+version+'-win-x64.exe','Study-Agent-'+version+'-mac-arm64.dmg','Study-Agent-'+version+'-mac-arm64.zip'];
  for(const name of names)fs.writeFileSync(path.join(input,name),'installer bytes '+name);
  const item=name=>({url:name,size:fs.statSync(path.join(input,name)).size,sha512:crypto.createHash('sha512').update(fs.readFileSync(path.join(input,name))).digest('base64')});
  const channel=version.includes('-')?'beta':'latest';
  fs.writeFileSync(path.join(input,channel+'.yml'),yaml.dump({version,files:[item(names[0])]}));
  fs.writeFileSync(path.join(input,channel+'-mac.yml'),yaml.dump({version,files:[item(names[2]),item(names[1])]}));
  return {input,output,names};
}
test('release preparation preserves filenames and verifies the actual installer bytes',t=>{
  const {input,output,names}=fixture(t);const manifest=prepare(input,output,'0.1.2');
  for(const name of names){assert.deepEqual(fs.readFileSync(path.join(output,name)),fs.readFileSync(path.join(input,name)));assert.match(manifest[name].digest,/^sha256:[a-f0-9]{64}$/);}
  assert.ok(manifest['latest-mac.yml']);assert.ok(manifest['SHA256SUMS.txt']);
});
test('corrupt installers cannot be published',t=>{
  const {input,output,names}=fixture(t);fs.appendFileSync(path.join(input,names[0]),'corrupt');
  assert.throws(()=>prepare(input,output,'0.1.2'),/checksum mismatch/);assert.ok(!fs.existsSync(output));
});
test('missing Mac update payload, wrong version and unsafe URLs cannot be published',t=>{
  const {input,output}=fixture(t);const file=path.join(input,'latest-mac.yml'),info=yaml.load(fs.readFileSync(file,'utf8'));
  info.files[0].url='../installer.zip';fs.writeFileSync(file,yaml.dump(info));assert.throws(()=>prepare(input,output,'0.1.2'),/Unsafe/);
  assert.throws(()=>prepare(input,output,'0.1.3'),/version/);
  fs.unlinkSync(file);assert.throws(()=>prepare(input,output,'0.1.2'),/Missing update metadata/);
});
test('beta versions use their own update channel',t=>{
  const {input,output}=fixture(t,'0.1.2-beta.1');assert.ok(prepare(input,output,'0.1.2-beta.1')['beta.yml']);
});
