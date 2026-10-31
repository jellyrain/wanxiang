import {createHash} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {copyFile,mkdtemp,open,rename,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import type {UpdateDriver} from './updater.ts';
import {normalizeUpdateSettings} from './update-settings.ts';

export interface PortableManifest {format:2;kind:'folder-zip';root:'WanxiangWorkshop';version:string;file:string;bytes:number;sha512:string;releaseNotes?:string}
const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newerVersion(next:string,current:string){
  if(!versionPattern.test(next)||!versionPattern.test(current))throw Error('免安装更新仅接受正式版本号，例如 1.2.3。');
  const a=next.split('.').map(BigInt),b=current.split('.').map(BigInt);
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;
}
export function portableManifest(raw:unknown):PortableManifest {
  const m=raw as PortableManifest;
  if(!m||m.format!==2||m.kind!=='folder-zip'||m.root!=='WanxiangWorkshop'||typeof m.version!=='string'||!versionPattern.test(m.version)||typeof m.file!=='string'||
    m.file!==`WanxiangWorkshop-${m.version}-win-x64-Portable.zip`||
    !Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>2*1024**3||typeof m.sha512!=='string'||!/^[a-f0-9]{128}$/.test(m.sha512)||
    m.releaseNotes!==undefined&&(typeof m.releaseNotes!=='string'||m.releaseNotes.length>50000))throw Error('免安装版更新清单无效。');
  return m;
}
async function response(url:URL,signal:AbortSignal){
  for(let n=0;n<6;n++){
    const r=await fetch(url,{redirect:'manual',signal,cache:'no-store'});
    if([301,302,303,307,308].includes(r.status)){
      await r.body?.cancel();const next=new URL(r.headers.get('location')??'',url);
      if(next.username||next.password||!(next.protocol==='https:'||url.protocol==='http:'&&next.origin===url.origin))throw Error('更新服务器返回了不安全的跳转。');
      url=next;continue;
    }
    if(!r.ok||!r.body)throw Error(`更新下载失败（HTTP ${r.status}）。`);return r;
  }throw Error('更新服务器跳转次数过多。');
}
async function hashFile(path:string){const hash=createHash('sha512');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}
export function createPortableDriver(options:{version:string;executable:string;cache:string;helper:string;quit:()=>void}):UpdateDriver {
  let selected:PortableManifest|undefined,source:URL|undefined,downloaded:string|undefined;
  return {
    async check(base){
      selected=undefined;downloaded=undefined;
      const normalized=normalizeUpdateSettings({url:base,checkOnStartup:false}).url;
      const r=await response(new URL('latest-portable.json',normalized),AbortSignal.timeout(30000));
      const reader=r.body!.getReader();let text='';const decoder=new TextDecoder();let bytes=0;
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>128*1024)throw Error('更新清单过大。');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
      finally{await reader.cancel();}
      const m=portableManifest(JSON.parse(text));
      if(!newerVersion(m.version,options.version))return null;
      selected=m;source=new URL(m.file,normalized);return {version:m.version,notes:m.releaseNotes??''};
    },
    async download(progress){
      if(!selected||!source)throw Error('请重新检查更新。');
      mkdirSync(options.cache,{recursive:true});const directory=await mkdtemp(join(options.cache,'p-')),temporary=join(directory,'download.partial'),complete=join(directory,'update.zip');
      const r=await response(source,AbortSignal.timeout(30*60*1000));
      const file=await open(temporary,'wx'),hash=createHash('sha512');let bytes=0;
      try{
        for await(const part of r.body!){bytes+=part.length;if(bytes>selected.bytes)throw Error('更新文件大小超过清单记录。');hash.update(part);await file.writeFile(part);progress(bytes/selected.bytes*100);}
        if(bytes!==selected.bytes||hash.digest('hex')!==selected.sha512)throw Error('更新文件校验失败，请重新检查并下载。');
        await file.sync();
      }catch(error){await file.close();await unlink(temporary).catch(()=>{});throw error;}
      await file.close();await rename(temporary,complete);downloaded=complete;
    },
    async install(){
      if(!downloaded||!selected||await hashFile(downloaded)!==selected.sha512)throw Error('下载的更新文件已改变，请重新下载。');
      const target=resolve(options.executable);
      if(!target.toLowerCase().endsWith('.exe')||lstatSync(target).isSymbolicLink()||!lstatSync(target).isFile())throw Error('免安装程序路径无效。');
      const job=dirname(downloaded),config=join(job,'install.json'),ready=join(job,'ready'),result=join(options.cache,'portable-result.json');
      const helper=join(job,'install.ps1');await copyFile(options.helper,helper);
      writeFileSync(config,JSON.stringify({pid:process.pid,directory:dirname(target),executable:basename(target),archive:downloaded,root:selected.root,version:selected.version,sha512:selected.sha512,ready,result}),{flag:'wx'});
      // The script launches an independent hidden worker. DETACHED_PROCESS can
      // prevent PowerShell from running; an inherited console dies with the app.
      const child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Config',config,'-Launch'],{windowsHide:true,stdio:'ignore'});
      let failure:Error|undefined;child.once('error',error=>{failure=error;});
      for(let n=0;n<600&&!existsSync(ready)&&!failure&&child.exitCode===null;n++)await new Promise(done=>setTimeout(done,100));
      if(failure||!existsSync(ready)){child.kill();throw failure??Error('更新助手未能启动，程序保持运行。');}
      child.unref();options.quit();
    }
  };
}

export function previousPortableError(cache:string){
  const path=join(cache,'portable-result.json');if(!existsSync(path))return null;
  try{const value=JSON.parse(readFileSync(path,'utf8'));return value.ok?null:`上次免安装更新未完成，原程序已保留：${String(value.error).slice(0,500)}`;}catch{return '上次更新结果无法读取，请检查程序目录。';}
}
