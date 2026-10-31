import { CONTENT_CHANNELS } from '../shared/api.ts';
import { BACKUP_CHANNELS } from '../shared/backup.ts';
import {SKILL_PACKAGES,type SkillKind} from '../shared/skills.ts';
import type { Asset, DesktopApi, MediaImportReport, Result } from '../shared/types.ts';
import {TRANSFER_LIMIT,type TransferFile,type TransferExportInput} from '../shared/transfer.ts';

export const isDesktop=Boolean(window.studio);
export const assetUrl=(id:string|null|undefined)=>id?(isDesktop?`ocasset://asset/${id}`:`/api/v1/assets/${encodeURIComponent(id)}`):'';
let session:Promise<void>|undefined;
let generation:string|undefined;
export class LoginRequired extends Error {}
export async function connectBrowser(credentials?:{password:string;remember:boolean}){
  if(credentials!==undefined)session=undefined;
  if(!session)session=fetch('/api/v1/session',{method:'POST',headers:{'X-Wanxiang-Client':'browser','Content-Type':'application/json'},body:JSON.stringify(credentials??{}),credentials:'same-origin',signal:AbortSignal.timeout(10000)}).then(async r=>{
    if(!r.ok){const result=await r.json().catch(()=>null);const message=result?.error?.message??'网页连接未能建立，请使用软件设置中显示的地址。';if(r.status===401){window.dispatchEvent(new Event('wanxiang-login-required'));throw new LoginRequired(message);}throw Error(message);}
  }).catch(e=>{session=undefined;throw e;});
  return session;
}
async function request<T>(path:string,init?:RequestInit):Promise<Result<T>>{
  try{
    await connectBrowser();
    const options={...init,credentials:'same-origin' as const,signal:AbortSignal.timeout(path.startsWith('commands/')&&Object.hasOwn(BACKUP_CHANNELS,path.slice(9))?600000:30000)};
    let r=await fetch(`/api/v1/${path}`,options);
    if(r.status===401){session=undefined;await connectBrowser();r=await fetch(`/api/v1/${path}`,{...options,signal:AbortSignal.timeout(30000)});}
    const result=await r.json() as Result<T>;
    if(path==='snapshot'&&result.ok&&generation===undefined)generation=(result.value as unknown as {generation:string}).generation;
    return result;
  }catch(e){return {ok:false,error:{code:'UNAVAILABLE',message:e instanceof Error&&e.message.startsWith('网页连接')?e.message:'无法连接万象工坊，请确认桌面软件仍在运行，再重试。'}};}
}
function chooseFiles(multiple=false,accept='image/png,image/jpeg,image/webp'):Promise<File[]>{
  return new Promise(resolve=>{
    const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.hidden=true;
    const finish=(files:File[])=>{input.remove();resolve(files);};
    input.addEventListener('change',()=>finish(Array.from(input.files??[])),{once:true});input.addEventListener('cancel',()=>finish([]),{once:true});
    document.body.append(input);input.click();
  });
}
async function upload(file:File,worldId:string):Promise<Result<Asset>>{
  if(file.size>25*1024*1024)return {ok:false,error:{code:'VALIDATION',message:'图片不能超过 25 MB。'}};
  return request<Asset>(`assets?${new URLSearchParams({worldId,name:file.name})}`,{method:'POST',headers:{'Content-Type':'application/octet-stream',...(generation?{'X-Wanxiang-Generation':generation}:{})},body:file});
}
const pick=async(worldId:string):Promise<Result<Asset|null>>=>{const [file]=await chooseFiles();return file?upload(file,worldId):{ok:true,value:null};};
async function importMedia(worldId:string):Promise<Result<MediaImportReport|null>>{
  const files=await chooseFiles(true);if(!files.length)return {ok:true,value:null};
  if(files.length>50)return {ok:false,error:{code:'VALIDATION',message:'每次最多导入 50 张图片。'}};
  const snapshot=await window.studio!.snapshot();if(!snapshot.ok)return snapshot;
  const known=new Set(snapshot.value.media.map(m=>m.id)),report:MediaImportReport={importedIds:[],existingIds:[],errors:[]};
  for(const file of files){const r=await upload(file,worldId);if(!r.ok){report.errors.push({name:file.name,message:r.error.message});continue;}const group=known.has(r.value.id)?report.existingIds:report.importedIds;if(!group.includes(r.value.id))group.push(r.value.id);}
  return {ok:true,value:report};
}
async function downloadSkill(kind:SkillKind):Promise<Result<string|null>>{
  try{
    await connectBrowser();
    const fetchPackage=()=>fetch(`/api/v1/skills/${encodeURIComponent(kind)}`,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
    let response=await fetchPackage();
    if(response.status===401){session=undefined;await connectBrowser();response=await fetchPackage();}
    if(!response.ok){const failure=await response.json().catch(()=>null);throw Error(failure?.error?.message??'Skill 下载未完成，请重试。');}
    const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');
    anchor.href=url;anchor.download=SKILL_PACKAGES[kind].fileName;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return {ok:true,value:SKILL_PACKAGES[kind].fileName};
  }catch(error){return {ok:false,error:{code:'UNAVAILABLE',message:error instanceof Error?error.message:'Skill 下载未完成，请重试。'}};}
}
export function initializeRuntime(){
  document.documentElement.dataset.platform=isDesktop?'desktop':'web';
  if(isDesktop)return;
  const desktopOnly=async():Promise<Result<never>>=>({ok:false,error:{code:'UNAVAILABLE',message:'请在桌面软件的“软件设置”中管理后台运行，或使用系统托盘菜单。'}});
  const commands=Object.fromEntries(Object.keys({...CONTENT_CHANNELS,...BACKUP_CHANNELS}).map(name=>[name,(...args:unknown[])=>request(`commands/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args,generation})})])) as Pick<DesktopApi,keyof typeof CONTENT_CHANNELS|keyof typeof BACKUP_CHANNELS>;
  window.studio={
    getDesktopStatus:desktopOnly,openDataDirectory:desktopOnly,completeOnboarding:desktopOnly,setLoginAtStartup:desktopOnly,setCloseToTray:desktopOnly,hideToTray:desktopOnly,quitApplication:desktopOnly,
    getUpdateStatus:desktopOnly,getUpdateCache:desktopOnly,clearUpdateCache:desktopOnly,saveUpdateSettings:desktopOnly,checkForUpdates:desktopOnly,downloadUpdate:desktopOnly,installUpdate:desktopOnly,openUpgradeRecovery:desktopOnly,
    setLanEnabled:desktopOnly,setBrowserAccessMode:desktopOnly,clearBrowserSessions:desktopOnly,createConnectionPairing:desktopOnly,getMcpConfig:desktopOnly,rotateConnectionCredentials:desktopOnly,
    ...commands,
    pickTransferFile:async():Promise<Result<TransferFile|null>>=>{
      const [file]=await chooseFiles(false,'.wanxiang,.txt,.md');if(!file)return {ok:true,value:null};
      if(file.size>TRANSFER_LIMIT)return {ok:false,error:{code:'TOO_LARGE',message:'文件不能超过 64 MB。'}};
      try{return {ok:true,value:{name:file.name,content:new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())}};}catch{return {ok:false,error:{code:'VALIDATION',message:'文件无法读取，请另存为 UTF-8 编码后重试。'}};}
    },
    saveTransferFile:async(input:TransferExportInput)=>{
      const result=await commands.exportTransfer(input);if(!result.ok)return result;
      const url=URL.createObjectURL(new Blob([result.value.content],{type:'application/octet-stream'})),anchor=document.createElement('a');
      anchor.href=url;anchor.download=result.value.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return {ok:true,value:result.value.name};
    },
    downloadSkill,
    snapshot:()=>request('snapshot'),getRevision:()=>request('revision'),getConnectionInfo:()=>request('info'),openWeb:async()=>({ok:true,value:undefined}),
    pickPortrait:pick,pickWorldImage:pick,pickMapImage:pick,importMedia,pickBackupDirectory:async()=>({ok:false,error:{code:'UNAVAILABLE',message:'网页中请填写本机备份目录，或在桌面软件中选择文件夹。'}})
  };
}
