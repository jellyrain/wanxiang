import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

/** Device preferences stay outside creative content and its backup history. */
export class DesktopSettings {
  closeToTray=true;
  error:string|null=null;
  onboardingComplete:boolean;
  private readonly path:string;
  constructor(path:string,firstRun=false){
    this.path=path;
    this.onboardingComplete=!firstRun;
    if(!existsSync(path))return;
    try{
      const value=JSON.parse(readFileSync(path,'utf8'));
      if(value.version!==1||typeof value.closeToTray!=='boolean')throw Error();
      this.closeToTray=value.closeToTray;
      this.onboardingComplete=value.onboardingComplete!==false;
    }catch{this.error='后台偏好无法读取，暂用关闭后收起到托盘。重新设置开关可保存偏好。';}
  }
  save(closeToTray:boolean){
    if(typeof closeToTray!=='boolean')throw new TypeError('关闭行为必须是布尔值。');
    this.persist(closeToTray,this.onboardingComplete);
  }
  completeOnboarding(){this.persist(this.closeToTray,true);}
  private persist(closeToTray:boolean,onboardingComplete:boolean){
    const temporary=this.path+'.'+randomUUID()+'.partial';
    try{
      writeFileSync(temporary,JSON.stringify({version:1,closeToTray,onboardingComplete})+'\n',{encoding:'utf8',flag:'wx',flush:true});
      renameSync(temporary,this.path);
      this.closeToTray=closeToTray;this.error=null;
      this.onboardingComplete=onboardingComplete;
    }finally{if(existsSync(temporary))unlinkSync(temporary);}
  }
}
