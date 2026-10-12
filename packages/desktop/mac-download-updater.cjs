// Unsigned Mac builds use the normal installation disk, downloaded and verified in-app.
// Replacement remains a Finder operation; this does not bypass Gatekeeper or code signing.
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const yaml=require('js-yaml'),semver=require('semver');
const RELEASES='https://github.com/zhc070307/study-agent/releases';
class MacDownloadUpdater extends EventEmitter {
  constructor({version,cache,fetch,openInstaller,quit,baseURL=RELEASES}){
    super();Object.assign(this,{version,cache,fetch,openInstaller,quit,baseURL});
  }
  async response(url){
    const response=await this.fetch(url,{signal:AbortSignal.timeout(20*60*1000)});
    if(!response.ok)throw new Error('Update download failed');
    if(response.url){
      const final=new URL(response.url),base=new URL(this.baseURL);
      if(final.origin!==base.origin&&!(final.protocol==='https:'&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname)))throw new Error('Unexpected update location');
    }
    return response;
  }
  async checkForUpdates(){
    this.emit('checking-for-update');
    const response=await this.response(this.baseURL+'/latest/download/latest-mac.yml');
    let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(text.length>65536)throw new Error('Update metadata too large');}
    const info=yaml.load(text);
    if(!semver.valid(info?.version)||info.version.includes('-'))throw new Error('Invalid update version');
    if(!semver.gt(info.version,this.version)){this.emit('update-not-available');return {};}
    const filename=`Study-Agent-${info.version}-mac-${process.arch}.dmg`;
    const file=info.files?.find(item=>item.url===filename);
    if(!file||!Number.isSafeInteger(file.size)||file.size<=0||file.size>2*1024**3||typeof file.sha512!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512))throw new Error('Invalid update file');
    this.info={version:info.version,file};this.emit('update-available',this.info);return this.info;
  }
  async verified(file){
    try{
      if((await fsp.stat(file)).size!==this.info.file.size)return false;
      const hash=crypto.createHash('sha512');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
      return hash.digest('base64')===this.info.file.sha512;
    }catch{return false;}
  }
  async downloadUpdate(){
    if(!this.info)throw new Error('Check for an update first');
    await fsp.mkdir(this.cache,{recursive:true,mode:0o700});
    const {file,version}=this.info,target=path.join(this.cache,file.url);
    if(!await this.verified(target)){
      const disk=await fsp.statfs(this.cache);if(disk.bavail*disk.bsize<file.size*4)throw new Error('Not enough space for update');
      const temporary=target+'.partial';await fsp.rm(temporary,{force:true});
      const output=await fsp.open(temporary,'wx',0o600);
      try{
        const response=await this.response(this.baseURL+`/download/v${version}/`+file.url);
        const hash=crypto.createHash('sha512');let size=0;
        for await(const value of response.body){
          const chunk=Buffer.from(value);size+=chunk.length;if(size>file.size)throw new Error('Unexpected update size');
          hash.update(chunk);await output.writeFile(chunk);this.emit('download-progress',{percent:size/file.size*100});
        }
        if(size!==file.size||hash.digest('base64')!==file.sha512)throw new Error('Update checksum mismatch');
        await output.sync();await output.close();await fsp.rename(temporary,target);
      }catch(error){await output.close().catch(()=>{});await fsp.rm(temporary,{force:true});throw error;}
    }
    this.downloadedFile=target;
    for(const name of await fsp.readdir(this.cache))if(name!==file.url&&/^Study-Agent-\d+\.\d+\.\d+-mac-(arm64|x64)\.dmg(?:\.partial)?$/.test(name))await fsp.rm(path.join(this.cache,name),{force:true});
    this.emit('update-downloaded',{version});
  }
  async quitAndInstall(){
    if(!this.downloadedFile||!await this.verified(this.downloadedFile))throw new Error('Update file is missing or changed');
    const error=await this.openInstaller(this.downloadedFile);if(error)throw new Error('Cannot open installer');
    await this.quit();
  }
}
module.exports={MacDownloadUpdater};
