import React,{useEffect,useState} from 'react';
import type {UpdateStatus} from '../shared/update.ts';
import {CheckField,Input} from './Fields.tsx';
import {isDesktop} from './runtime.ts';

const labels:Record<UpdateStatus['phase'],string>={unconfigured:'尚未配置更新源',idle:'检查更新',checking:'正在检查…',available:'发现新版本',downloading:'正在下载…',downloaded:'下载完成',preparing:'正在保护资料…',installing:'正在重启更新…',error:'更新未完成'};
export function UpdateSettings({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}){
  const [cache,setCache]=useState<{bytes:number;files:number}|null>(null),[cacheNotice,setCacheNotice]=useState('');
  useEffect(()=>{if(isDesktop)void window.studio!.getUpdateCache().then(r=>{if(r.ok)setCache(r.value);});},[]);
  const [status,setStatus]=useState<UpdateStatus|null>(null),[url,setUrl]=useState(''),[startup,setStartup]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!isDesktop)return;let alive=true,initialized=false;
    const load=async()=>{try{const r=await window.studio!.getUpdateStatus();if(!alive)return;if(r.ok){setStatus(r.value);if(!initialized){initialized=true;setUrl(r.value.settings.url);setStartup(r.value.settings.checkOnStartup);setLoaded(true);}}else setError(r.error.message);}catch{if(alive)setError('更新状态无法读取，请重新打开设置。');}};
    void load();const timer=setInterval(()=>void load(),1000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  const changed=Boolean(loaded&&status&&(url.trim()!==status.settings.url||startup!==status.settings.checkOnStartup));
  useEffect(()=>{onDirtyChange(changed||busy);return()=>onDirtyChange(false);},[changed,busy,onDirtyChange]);
  if(!isDesktop)return null;
  const locked=busy||!loaded||Boolean(status&&['checking','downloading','preparing','installing'].includes(status.phase));
  const action=async(kind:'save'|'check'|'download'|'install'|'recovery')=>{
    setBusy(true);setError('');try{
      const api=window.studio!;const r=await(kind==='save'?api.saveUpdateSettings({url,checkOnStartup:startup}):kind==='check'?api.checkForUpdates():kind==='download'?api.downloadUpdate():kind==='install'?api.installUpdate():api.openUpgradeRecovery());
      if(!r.ok)setError(r.error.message);else if(r.value){setStatus(r.value);if(kind==='save'){setUrl(r.value.settings.url);setStartup(r.value.settings.checkOnStartup);}}
    }catch{setError('更新操作未完成，请重试。');}finally{setBusy(false);}
  };
  return <section className="desktop-settings backup-panel" aria-label="软件更新">
    <header><div><h2>软件更新</h2></div><span className="tag">{status?.currentVersion??'…'} · {status?.edition==='portable'?'免安装版':status?.packaged?'安装版':'开发版'}</span></header>
    <div className="update-settings-body"><label className="field">更新源地址<Input aria-label="更新源地址" placeholder="https://你的更新服务器/万象工坊/" value={url} disabled={locked} onChange={e=>setUrl(e.target.value)}/></label>
      <label className="backup-toggle"><CheckField aria-label="启动时自动检查更新" checked={startup} disabled={locked||!url.trim()} onCheckedChange={setStartup}/>启动时自动检查更新</label>
      <p className="backup-help">地址留空时不检查更新。</p>
      <div className="desktop-settings-actions"><button className="btn" disabled={locked||!changed} onClick={()=>void action('save')}>保存更新设置</button>
        <button className="btn" disabled={locked||changed||!status?.packaged||!status.settings.url} onClick={()=>void action('check')}>检查更新</button>
        {status?.phase==='available'&&<button className="btn primary" disabled={locked||changed} onClick={()=>void action('download')}>下载 {status.availableVersion}</button>}
        {status?.phase==='downloaded'&&<p className="backup-help">更新前，请保存所有窗口和设备上的草稿。</p>}
        {status?.phase==='downloaded'&&<button className="btn primary" disabled={locked||changed} onClick={()=>void action('install')}>重启并更新</button>}
        <button className="btn" disabled={locked} onClick={()=>void action('recovery')}>打开升级保护目录</button></div>
      <p className="backup-help" role="status">{status?labels[status.phase]:'读取更新状态…'}{status?.phase==='idle'&&status.lastChecked?' · 当前已是最新版本':''}{status?.phase==='downloading'?` ${Math.floor(status.progress)}%`:''}</p>
      {status?.phase==='downloading'&&<progress aria-label="更新下载进度" value={status.progress} max={100}/>}
      {status?.releaseNotes&&<p className="update-release-notes">{status.releaseNotes}</p>}
      {!status?.packaged&&<p className="backup-help">开发版可以保存设置；程序更新在安装版和免安装版中使用。</p>}
      {status?.protection&&<p className="backup-help">已保留升级前资料：{new Date(status.protection.createdAt).toLocaleString('zh-CN')}</p>}
      <div className="settings-row settings-cache"><div><strong>下载缓存</strong><p className="backup-help">{cache?`${(cache.bytes/1024**2).toFixed(1)} MB`:'读取中…'} · 保留资料、恢复点和旧程序备份</p></div><button className="btn" disabled={locked||!cache?.files||!status||!['idle','unconfigured','error'].includes(status.phase)} onClick={()=>{setBusy(true);setError('');void window.studio!.clearUpdateCache().then(r=>{if(r.ok){setCache({bytes:0,files:0});setCacheNotice(`已清理 ${(r.value.bytes/1024**2).toFixed(1)} MB`);}else setError(r.error.message);}).catch(()=>setError('缓存清理失败，请重试。')).finally(()=>setBusy(false));}}>清理下载缓存</button></div>
      {cacheNotice&&<p role="status">{cacheNotice}</p>}
      {(error||status?.error)&&<p className="editor-error" role="alert">{error||status?.error}</p>}
    </div>
  </section>;
}
