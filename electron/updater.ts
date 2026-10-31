import {ContentError} from '../src/core/store.ts';
import type {UpdateStatus,UpgradePoint} from '../src/shared/update.ts';
import type {UpdatePreferences} from './update-settings.ts';

export interface UpdateDriver {
  check(url:string):Promise<{version:string;notes:string}|null>;
  download(progress:(percent:number)=>void):Promise<void>;
  install():Promise<void>;
}
const busy=new Set(['checking','downloading','preparing','installing']);
interface Options {version:string;edition:UpdateStatus['edition'];preferences:UpdatePreferences;driver:UpdateDriver;
  protect:(target:string)=>Promise<UpgradePoint>;requestQuit:()=>void}
export class UpdateCoordinator {
  readonly state:UpdateStatus;
  installRequested=false;
  private readonly options:Options;
  constructor(options:Options){
    this.options=options;
    const {version,edition,preferences}=options;
    this.state={currentVersion:version,packaged:edition!=='development',edition,settings:preferences.value,
      phase:preferences.value.url?'idle':'unconfigured',availableVersion:null,releaseNotes:'',progress:0,error:preferences.error,lastChecked:null,protection:null};
  }
  status(){return structuredClone(this.state);}
  private assertIdle(){if(busy.has(this.state.phase))throw new ContentError('BUSY','更新正在进行，请稍候。');}
  private assertRelease(){if(!this.state.packaged)throw new ContentError('UNAVAILABLE','开发版不替换程序，请在打包后的软件中检查更新。');}
  private fail(error:unknown){this.state.phase='error';this.state.error=error instanceof Error?error.message:'更新未完成，请重试。';}
  save(input:unknown){
    this.assertIdle();this.state.settings=this.options.preferences.save(input);
    Object.assign(this.state,{phase:this.state.settings.url?'idle':'unconfigured',availableVersion:null,releaseNotes:'',progress:0,error:null,protection:null});return this.status();
  }
  async check(){
    this.assertIdle();this.assertRelease();
    if(!this.state.settings.url)throw new ContentError('VALIDATION','请先保存更新源地址。');
    Object.assign(this.state,{phase:'checking',error:null,availableVersion:null,releaseNotes:'',progress:0});
    try{const info=await this.options.driver.check(this.state.settings.url);this.state.lastChecked=new Date().toISOString();
      this.state.phase=info?'available':'idle';this.state.availableVersion=info?.version??null;this.state.releaseNotes=info?.notes??'';
    }catch(error){this.fail(error);}return this.status();
  }
  async download(){
    this.assertRelease();if(this.state.phase!=='available')throw new ContentError('BUSY','请先检查可用的新版本。');
    this.state.phase='downloading';this.state.error=null;
    try{await this.options.driver.download(percent=>{this.state.progress=Math.min(100,Math.max(0,percent));});this.state.phase='downloaded';this.state.progress=100;}
    catch(error){this.fail(error);}return this.status();
  }
  requestInstall(){
    this.assertRelease();if(this.state.phase!=='downloaded')throw new ContentError('BUSY','请先完成更新下载。');
    this.installRequested=true;this.state.phase='preparing';this.state.error=null;this.options.requestQuit();
  }
  cancelInstall(){if(!this.installRequested)return;this.installRequested=false;this.state.phase='downloaded';}
  async prepare(){
    if(!this.installRequested)return;
    try{this.state.protection=await this.options.protect(this.state.availableVersion!);}
    catch(error){this.installRequested=false;this.fail(error);throw error;}
  }
  async finish(){
    if(!this.installRequested)throw Error('没有待安装的更新。');
    try{this.state.phase='installing';await this.options.driver.install();}
    catch(error){this.installRequested=false;this.fail(error);throw error;}
  }
}
