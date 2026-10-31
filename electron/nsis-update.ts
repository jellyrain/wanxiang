import electronUpdater from 'electron-updater';
import {app} from 'electron';
import {join} from 'node:path';
import type {UpdateDriver} from './updater.ts';

class LocalNsisUpdater extends electronUpdater.NsisUpdater {
  constructor(cache:string){
    // A custom constructor adapter disables Electron's HTTP executor in updater 6.
    // Keep normal initialization and change only the cache location.
    super();Object.defineProperty(this.app,'baseCachePath',{get:()=>cache});
  }
}
export function createNsisDriver(cache=join(app.getPath('userData'),'update-cache')):UpdateDriver {
  const updater=new LocalNsisUpdater(cache);
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;
  updater.allowPrerelease=false;updater.disableWebInstaller=true;
  let failure:Error|null=null;
  updater.on('error',error=>{failure=error;console.error('[更新]',error);});
  return {
    async check(url){
      failure=null;updater.setFeedURL({provider:'generic',url});
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
    async install(){
      failure=null;updater.quitAndInstall(true,true);
      if(failure)throw failure;
      // The updater owns quitting and restarting the installed application.
    }
  };
}
