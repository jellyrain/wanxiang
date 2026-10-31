import React,{useEffect,useState} from 'react';
import type {DesktopStatus} from '../shared/desktop.ts';
import {CheckField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {isDesktop} from './runtime.ts';

export function DesktopSettings(){
  const [status,setStatus]=useState<DesktopStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(!isDesktop)return;
    let alive=true;
    const load=async()=>{const r=await window.studio!.getDesktopStatus();if(!alive)return;if(r.ok)setStatus(r.value);else setError(r.error.message);};
    void load();const timer=setInterval(()=>void load(),5000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  if(!isDesktop)return null;
  const change=async(enabled:boolean)=>{
    setBusy(true);setError('');try{const r=await window.studio!.setCloseToTray(enabled);if(r.ok)setStatus(r.value);else setError(r.error.message);}finally{setBusy(false);}
  };
  const act=async(action:'hide'|'quit')=>{
    setBusy(true);setError('');try{const r=await(action==='hide'?window.studio!.hideToTray():window.studio!.quitApplication());if(!r.ok)setError(r.error.message);}finally{setBusy(false);}
  };
  const locked=busy||!status||status.phase!=='running';
  const openData=async()=>{setError('');try{const r=await window.studio!.openDataDirectory();if(!r.ok)setError(r.error.message);}catch{setError('资料目录无法打开，请重试。');}};
  return <>
    <section className="backup-panel data-settings" aria-label="本地资料">
      <header><h2>本地资料</h2><span className="tag">{status?.version??'…'} · {status?.edition==='portable'?'免安装版':status?.packaged?'安装版':'开发版'}</span></header>
      <div className="settings-data-path"><code>{status?.dataDirectory??'读取中…'}</code><button className="btn" disabled={!status} onClick={()=>void openData()}><Icon name="folder"/>打开资料目录</button></div>
      {status?.edition==='portable'&&<p className="backup-help">搬移软件时，请保留整个文件夹。</p>}
    </section>
    <section className="backup-panel desktop-settings" aria-label="窗口与启动">
      <header><h2>窗口与启动</h2></header>
      <div className="settings-row"><label className="backup-toggle"><CheckField aria-label="关闭窗口后收起到托盘" checked={status?.closeToTray??true} disabled={locked||!status?.trayAvailable} onCheckedChange={enabled=>void change(enabled)}/>关闭窗口后收起到托盘</label><button className="btn small" disabled={locked||!status?.trayAvailable} onClick={()=>void act('hide')}>收起窗口</button></div>
      {status?.loginAtStartupSupported&&<div className="settings-row"><label className="backup-toggle"><CheckField aria-label="登录后在后台启动" checked={status.loginAtStartup} disabled={locked} onCheckedChange={enabled=>{setBusy(true);setError('');void window.studio!.setLoginAtStartup(enabled).then(r=>{if(r.ok)setStatus(r.value);else setError(r.error.message);}).finally(()=>setBusy(false));}}/>登录后在后台启动</label></div>}
      <div className="settings-row"><span className="settings-muted">退出后，网页与 AI 连接停止。</span><button className="btn small" disabled={locked} onClick={()=>void act('quit')}>退出软件</button></div>
    </section>
    {(error||status?.error)&&<p className="editor-error" role="alert">{error||status?.error}</p>}
  </>;
}
