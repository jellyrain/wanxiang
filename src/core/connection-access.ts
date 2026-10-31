import {randomBytes,randomInt,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {networkInterfaces} from 'node:os';
import {ContentError} from './store.ts';
import type {BrowserAccessMode} from '../shared/api.ts';

export const equalSecret=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export const isLoopback=(address:string|undefined)=>address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';
export function lanAddresses(){return [...new Set(Object.values(networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal).map(a=>a!.address))];}
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
const secret=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const DAY=86400000;
type RememberedSession={hash:string;expiresAt:number};
type Settings={version:2;id:string;lanEnabled:boolean;accessMode:BrowserAccessMode;key:string;rememberedSessions:RememberedSession[]};

/** Device credentials and remembered logins are separate from creative content and its backups. */
export class ConnectionAccess {
  private state:Settings={version:2,id:randomBytes(16).toString('hex'),lanEnabled:false,accessMode:'direct',key:randomBytes(32).toString('hex'),rememberedSessions:[]};
  private pairing:{code:string;expiresAt:number;failures:number}|undefined;
  private sessions=new Map<string,number>();
  private file:string|undefined;
  private now:()=>number;
  constructor(file?:string,now:()=>number=Date.now){
    this.file=file;this.now=now;
    if(file&&existsSync(file)){
      const saved=JSON.parse(readFileSync(file,'utf8'));
      if(!saved||typeof saved.lanEnabled!=='boolean'||!secret(saved.key))throw new ContentError('VALIDATION','连接设置无法读取，请检查 connection-settings.json。');
      if(saved.version===1){
        // Do not silently remove protection from an already exposed legacy installation.
        this.commit({...this.state,lanEnabled:saved.lanEnabled,accessMode:saved.lanEnabled?'password':'direct',key:saved.key});
      }else{
        if(saved.version!==2||typeof saved.id!=='string'||!/^[a-f0-9]{32}$/.test(saved.id)||!['direct','password'].includes(saved.accessMode)||!Array.isArray(saved.rememberedSessions)||saved.rememberedSessions.length>100||saved.rememberedSessions.some((s:RememberedSession)=>!s||!secret(s.hash)||!Number.isSafeInteger(s.expiresAt)))throw new ContentError('VALIDATION','连接设置无法读取，请检查 connection-settings.json。');
        this.state=saved;
      }
    }else this.commit(this.state);
  }
  private commit(next:Settings){
    if(this.file){
      mkdirSync(dirname(this.file),{recursive:true});const temporary=this.file+'.'+randomUUID()+'.partial';
      try{writeFileSync(temporary,JSON.stringify(next,null,2),{mode:0o600,flag:'wx',flush:true});renameSync(temporary,this.file);}
      finally{if(existsSync(temporary))unlinkSync(temporary);}
    }
    this.state=next;
  }
  get id(){return this.state.id;}
  get lanEnabled(){return this.state.lanEnabled;}
  get accessMode(){return this.state.accessMode;}
  get rememberedDeviceCount(){return this.state.rememberedSessions.filter(s=>s.expiresAt>this.now()).length;}
  saveMode(enabled:boolean){
    this.commit({...this.state,lanEnabled:enabled});
    if(!enabled){this.pairing=undefined;this.sessions.clear();}
  }
  setAccessMode(mode:BrowserAccessMode){
    if(mode!=='direct'&&mode!=='password')throw new ContentError('VALIDATION','请选择有效的浏览器访问方式。');
    if(mode===this.accessMode)return;
    this.commit({...this.state,accessMode:mode,rememberedSessions:[]});this.sessions.clear();this.pairing=undefined;
  }
  clearBrowserSessions(){
    this.commit({...this.state,rememberedSessions:[]});this.sessions.clear();this.pairing=undefined;
  }
  credentials(){return {authorization:'Bearer '+this.state.key};}
  acceptsKey(key:string){return equalSecret(key,this.state.key);}
  rotate(){this.commit({...this.state,key:randomBytes(32).toString('hex')});}
  createPairing(){
    if(!this.lanEnabled||this.accessMode!=='password')throw new ContentError('VALIDATION','请先开启局域网并选择密码保护。');
    this.pairing={code:randomInt(0,100000000).toString().padStart(8,'0'),expiresAt:this.now()+5*60*1000,failures:0};
    return {code:this.pairing.code,expiresAt:this.pairing.expiresAt};
  }
  login(password:unknown,remember:unknown=false){
    if(!this.lanEnabled)throw new ContentError('UNAUTHORIZED','局域网访问已关闭。');
    if(typeof remember!=='boolean')throw new ContentError('VALIDATION','请选择是否记住这台设备。');
    if(this.accessMode==='password'){
      if(password===undefined)throw new ContentError('UNAUTHORIZED','请输入电脑端生成的临时密码。');
      const pairing=this.pairing;
      if(!pairing||pairing.expiresAt<=this.now()||pairing.failures>=10)throw new ContentError('UNAUTHORIZED','临时密码已失效，请在电脑端重新生成。');
      if(typeof password!=='string'||!equalSecret(password,pairing.code)){pairing.failures++;throw new ContentError('UNAUTHORIZED','临时密码不正确，请重新输入。');}
    }
    const persistent=this.accessMode==='password'&&remember;
    const token=randomBytes(32).toString('hex'),expiresAt=this.now()+(persistent?30:1)*DAY,tokenHash=hash(token);
    if(persistent){
      const kept=this.state.rememberedSessions.filter(s=>s.expiresAt>this.now()).slice(-99);
      this.commit({...this.state,rememberedSessions:[...kept,{hash:tokenHash,expiresAt}]});
    }else{
      for(const [key,expiry] of this.sessions)if(expiry<=this.now())this.sessions.delete(key);
      if(this.sessions.size>=100)this.sessions.delete(this.sessions.keys().next().value!);
      this.sessions.set(tokenHash,expiresAt);
    }
    this.pairing=undefined;
    return {token,maxAge:persistent?30*86400:undefined};
  }
  acceptsSession(token:string){
    if(!this.lanEnabled||!secret(token))return false;
    const tokenHash=hash(token),now=this.now();
    return (this.sessions.get(tokenHash)??0)>now||this.state.rememberedSessions.some(s=>s.hash===tokenHash&&s.expiresAt>now);
  }
}
