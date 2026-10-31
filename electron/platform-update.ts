import electronUpdater from 'electron-updater';
import {app} from 'electron';
import {join} from 'node:path';
import type {UpdateDriver} from './updater.ts';

class WindowsUpdater extends electronUpdater.NsisUpdater {
  constructor(cache:string){super();Object.defineProperty(this.app,'baseCachePath',{get:()=>cache});}
}
class MacUpdater extends electronUpdater.MacUpdater {
  constructor(cache:string){super();Object.defineProperty(this.app,'baseCachePath',{get:()=>cache});}
}
class LinuxUpdater extends electronUpdater.AppImageUpdater {
  constructor(cache:string){super();Object.defineProperty(this.app,'baseCachePath',{get:()=>cache});}
}
export function createInstalledDriver(cache=join(app.getPath('userData'),'update-cache'),macSigned=false):UpdateDriver {
  const updater=process.platform==='darwin'?new MacUpdater(cache):process.platform==='linux'?new LinuxUpdater(cache):new WindowsUpdater(cache);
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;
  if(updater instanceof WindowsUpdater)updater.disableWebInstaller=true;
  let failure:Error|null=null;
  updater.on('error',error=>{failure=error;console.error('[更新]',error);});
  return {
    async check(url){
      if(process.platform==='darwin'&&!macSigned)throw Error('当前 macOS 测试包未使用发布证书签名，请从发布页下载新版本并手动替换应用。');
      if(process.platform==='linux'&&!process.env.APPIMAGE)throw Error('请从 AppImage 文件启动软件后更新；解压运行的版本需手动替换程序。');
      failure=null;updater.setFeedURL({provider:'generic',url,useMultipleRangeRequest:false});
      const result=await updater.checkForUpdates();
      if(failure)throw failure;
      if(!result?.isUpdateAvailable)return null;
      const info=result.updateInfo;
      return {version:info.version,notes:typeof info.releaseNotes==='string'?info.releaseNotes:(info.releaseNotes??[]).map(n=>n.note).join('\n')};
    },
    async download(progress){
      const listener=(value:{percent:number})=>progress(value.percent);updater.on('download-progress',listener);
      try{failure=null;await updater.downloadUpdate();if(failure)throw failure;}finally{updater.off('download-progress',listener);}
    },
    async install(){failure=null;updater.quitAndInstall(true,true);if(failure)throw failure;}
  };
}
