const RELEASES='https://github.com/zhc070307/study-agent/releases';

class DesktopUpdates {
  constructor({updater,version,enabled=true,canInstall=true,prepareInstall=async()=>true,notify=()=>{},openRelease=()=>{}}){
    this.updater=updater;this.prepareInstall=prepareInstall;this.notify=notify;this.openRelease=openRelease;
    this.state={status:enabled?'idle':'disabled',current:version,version:null,percent:0,canInstall};
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
    updater.allowPrerelease=version.includes('-');updater.disableWebInstaller=true;
    updater.logger={info(){},warn(){},error(){},debug(){}};
    updater.on('checking-for-update',()=>this.set({status:'checking',message:'正在检查更新…'}));
    updater.on('update-not-available',()=>this.set({status:'current',message:'已是最新版本'}));
    updater.on('update-available',info=>this.set({status:'available',version:info.version,percent:0,message:'发现新版本 '+info.version}));
    updater.on('download-progress',info=>this.set({status:'downloading',percent:Math.max(0,Math.min(100,Math.round(info.percent))),message:'正在下载更新…'}));
    updater.on('update-downloaded',info=>this.set({status:'ready',version:info.version,percent:100,message:'更新已下载，可重启安装'}));
    updater.on('error',()=>this.failed());
  }
  set(value){Object.assign(this.state,value);this.notify(this.snapshot());}
  snapshot(){return {...this.state};}
  failed(){this.set({status:'error',message:'暂时无法完成更新，可以稍后重试；当前版本仍可使用。'});}
  async check(){
    if(['disabled','checking','downloading','ready','installing'].includes(this.state.status))return this.snapshot();
    this.set({status:'checking',message:'正在检查更新…'});
    try{const result=await this.updater.checkForUpdates();if(!result)this.set({status:'current',message:'已是最新版本'});}catch{this.failed();}
    return this.snapshot();
  }
  async download(){
    if(this.state.status!=='available')return this.snapshot();
    if(!this.state.canInstall){await this.openRelease(RELEASES);return this.snapshot();}
    this.set({status:'downloading',percent:0,message:'正在下载更新…'});
    try{await this.updater.downloadUpdate();}catch{this.failed();}
    return this.snapshot();
  }
  async install(){
    if(this.state.status!=='ready'||!this.state.canInstall||this.installPending)return this.snapshot();
    this.installPending=true;
    try{
      const ready=await this.prepareInstall();
      if(ready===null)return this.snapshot();
      if(!ready){this.set({message:'助理或文件操作尚未结束，请完成后再重启更新。'});return this.snapshot();}
      this.set({status:'installing',message:'正在重启更新…'});
      this.updater.quitAndInstall(false,true);
    }catch{this.set({status:'ready',message:'未能开始安装，请稍后重试；已下载的更新保留。'});}
    finally{this.installPending=false;}
    return this.snapshot();
  }
}
module.exports={DesktopUpdates};
