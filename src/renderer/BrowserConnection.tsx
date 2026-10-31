import React,{useEffect,useState} from 'react';
import {connectBrowser,isDesktop,LoginRequired} from './runtime.ts';
import {Input,CheckField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
export function BrowserConnection({children}:{children:React.ReactNode}){
  const [connected,setConnected]=useState(isDesktop),[mounted,setMounted]=useState(isDesktop),[code,setCode]=useState(''),[busy,setBusy]=useState(!isDesktop),[error,setError]=useState('');
  const [remember,setRemember]=useState(false);
  const connect=async(credentials?:{password:string;remember:boolean})=>{
    setBusy(true);setError('');try{await connectBrowser(credentials);setConnected(true);setMounted(true);setCode('');}catch(e){setError(credentials===undefined&&e instanceof LoginRequired?'':e instanceof Error?e.message:'连接未完成，请确认软件仍在运行。');}finally{setBusy(false);}
  };
  useEffect(()=>{
    if(isDesktop)return;
    const lock=()=>setConnected(false);window.addEventListener('wanxiang-login-required',lock);void connect();
    return()=>window.removeEventListener('wanxiang-login-required',lock);
  },[]);
  return <>{mounted&&<div style={{display:connected?'contents':'none'}}>{children}</div>}{!connected&&<main className="browser-pairing"><form onSubmit={e=>{e.preventDefault();void connect(code?{password:code,remember}:undefined);}}>
    <Icon name="network"/><h1>让你的世界，随处可读</h1><p>已开启密码保护时，在电脑端「软件设置 → 连接」生成临时密码。</p>
    <label htmlFor="connection-code">临时密码</label><Input id="connection-code" autoComplete="one-time-code" inputMode="numeric" maxLength={8} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="输入电脑端显示的 8 位临时密码"/>
    <label className="backup-toggle"><CheckField aria-label="记住这台设备" checked={remember} onCheckedChange={setRemember}/>记住这台设备，30 天内免登录</label>
    <button className="btn primary" type="submit" disabled={busy}>{busy?'正在连接…':'连接资料库'}</button>
    {error&&<p role="alert" className="editor-error">{error}</p>}<small>临时密码 5 分钟内有效，仅使用一次。记住设备后，软件重启也无需重新登录。本机和可信局域网直接访问模式会自动连接。{mounted?'已有编辑仍保留在当前页面，重新登录后可继续。':''}</small>
  </form></main>}</>;
}
