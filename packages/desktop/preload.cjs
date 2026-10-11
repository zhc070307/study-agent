const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('studyDesktop',{
  updates:{
    state:()=>ipcRenderer.invoke('study:update','state'),
    check:()=>ipcRenderer.invoke('study:update','check'),
    download:()=>ipcRenderer.invoke('study:update','download'),
    install:()=>ipcRenderer.invoke('study:update','install'),
    subscribe:callback=>{
      const listener=(_event,value)=>callback(value);
      ipcRenderer.on('study:update-state',listener);
      return ()=>ipcRenderer.removeListener('study:update-state',listener);
    }
  }
});
