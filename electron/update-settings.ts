import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ContentError} from '../src/core/store.ts';
import type {UpdateSettings} from '../src/shared/update.ts';

export function normalizeUpdateSettings(raw:unknown):UpdateSettings{
  if(!raw||typeof raw!=='object')throw new ContentError('VALIDATION','请填写有效的更新设置。');
  const value=raw as UpdateSettings;
  if(typeof value.url!=='string'||value.url.length>2000||typeof value.checkOnStartup!=='boolean')throw new ContentError('VALIDATION','请填写有效的更新设置。');
  if(!value.url.trim())return {url:'',checkOnStartup:false};
  let url:URL;
  try{url=new URL(value.url.trim());}catch{throw new ContentError('VALIDATION','更新地址应为 HTTPS 目录地址。');}
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&local))||url.username||url.password||url.search||url.hash)
    throw new ContentError('VALIDATION','更新源须使用 HTTPS，不带账号、密码或查询参数；本机测试可使用 HTTP。');
  if(/\.(exe|ya?ml|json)$/i.test(url.pathname))throw new ContentError('VALIDATION','请填写存放 latest.yml 和安装包的目录地址。');
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return {url:url.href,checkOnStartup:value.checkOnStartup};
}

export class UpdatePreferences {
  value:UpdateSettings={url:'',checkOnStartup:false};
  error:string|null=null;
  private readonly path:string;
  constructor(path:string,defaultUrl=''){
    this.path=path;
    if(defaultUrl)this.value=normalizeUpdateSettings({url:defaultUrl,checkOnStartup:false});
    if(!existsSync(path))return;
    try{const value=JSON.parse(readFileSync(path,'utf8'));if(value.version!==1)throw Error();this.value=normalizeUpdateSettings(value.settings);}
    catch{this.value={url:'',checkOnStartup:false};this.error='更新设置无法读取，已停止自动检查。请重新保存更新源。';}
  }
  save(input:unknown){
    const value=normalizeUpdateSettings(input),temporary=this.path+'.'+randomUUID()+'.partial';
    try{writeFileSync(temporary,JSON.stringify({version:1,settings:value})+'\n',{encoding:'utf8',flag:'wx',flush:true});renameSync(temporary,this.path);this.value=value;this.error=null;}
    finally{if(existsSync(temporary))unlinkSync(temporary);}
    return this.value;
  }
}
