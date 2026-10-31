import React,{useEffect,useState} from 'react';
import type {LocalConnection as Connection,ConnectionPairing,McpConnectionConfig,BrowserAccessMode} from '../shared/api.ts';
import {isDesktop} from './runtime.ts';
import {Icon} from './Icon.tsx';
import {CheckField,SelectField} from './Fields.tsx';
import {SKILL_PACKAGES,type SkillKind} from '../shared/skills.ts';

export function LocalConnection(){
  const [connection,setConnection]=useState<Connection|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [downloading,setDownloading]=useState<SkillKind|null>(null);
  const download=async(kind:SkillKind)=>{setDownloading(kind);setError('');try{const r=await window.studio!.downloadSkill(kind);if(r.ok){if(r.value)setNotice(isDesktop?`已保存 ${SKILL_PACKAGES[kind].name} 压缩包`:'已发起下载，请查看浏览器下载记录');}else setError(r.error.message);}catch{setError('Skill 下载未完成，请重试。');}finally{setDownloading(null);}};
  const [pairing,setPairing]=useState<ConnectionPairing|null>(null),[config,setConfig]=useState<McpConnectionConfig|null>(null),[target,setTarget]=useState(''),[now,setNow]=useState(Date.now());
  useEffect(()=>{let alive=true;const load=async()=>{const r=await window.studio!.getConnectionInfo();if(!alive)return;if(r.ok)setConnection(r.value);else setError(r.error.message);};void load();const timer=setInterval(()=>{setNow(Date.now());void load();},5000);return()=>{alive=false;clearInterval(timer);};},[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),3000);return()=>clearTimeout(t);},[notice]);
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setNotice('已复制');}catch{setError('复制未完成，可以选中下方内容手动复制。');}};
  const mode=async(enabled:boolean)=>{setBusy(true);setError('');try{const r=await window.studio!.setLanEnabled(enabled);if(r.ok){setConnection(r.value);setPairing(null);setTarget('');}else setError(r.error.message);}finally{setBusy(false);}};
  const pair=async()=>{setError('');const r=await window.studio!.createConnectionPairing();if(r.ok)setPairing(r.value);else setError(r.error.message);};
  const browserMode=async(value:BrowserAccessMode)=>{setBusy(true);setError('');try{const r=await window.studio!.setBrowserAccessMode(value);if(r.ok){setConnection(r.value);setPairing(null);}else setError(r.error.message);}finally{setBusy(false);}};
  const clearDevices=async()=>{setBusy(true);setError('');try{const r=await window.studio!.clearBrowserSessions();if(r.ok){setConnection(r.value);setPairing(null);setNotice('已清除浏览器登录，设备需重新输入临时密码');}else setError(r.error.message);}finally{setBusy(false);}};
  const reveal=async()=>{setError('');const r=await window.studio!.getMcpConfig();if(r.ok)setConfig(r.value);else setError(r.error.message);};
  const rotate=async()=>{setBusy(true);setError('');try{const r=await window.studio!.rotateConnectionCredentials();if(r.ok){setConfig(null);setNotice('MCP 密钥已更换，请更新 AI 客户端配置');}else setError(r.error.message);}finally{setBusy(false);}};
  const configText=config?JSON.stringify({mcpServers:{'wanxiang-workshop':{url:target?target+'/mcp':config.url,headers:config.headers}}},null,2):'';
  const locked=busy||!connection?.available;
  return <section className="local-connection panel" aria-label="浏览器与 AI 连接"><div className="local-connection-heading"><Icon name="network"/><div><h3>浏览器与 AI 连接</h3></div><span className={'tag '+(connection?.available?'gold':'')}>{connection?.available?(connection.lanEnabled?'局域网服务已启动':'本机服务已启动'):'连接未就绪'}</span></div>
    <div className="connection-columns"><div className="connection-section"><h4>浏览器访问</h4>
      {connection?.available&&<div className="local-connection-address"><code>{connection.baseUrl}</code><button className="btn small" onClick={()=>void copy(connection.baseUrl!)}>复制地址</button>{isDesktop&&<button className="btn small" onClick={()=>void window.studio!.openWeb().then(r=>{if(!r.ok)setError(r.error.message);})}>打开网页 <Icon name="arrow"/></button>}</div>}
      {isDesktop?<><label className="backup-toggle"><CheckField aria-label="局域网模式" checked={connection?.lanEnabled??false} disabled={locked} onCheckedChange={enabled=>void mode(enabled)}/>局域网模式 <span className="connection-listen">{connection?.listenHost??'127.0.0.1'}</span></label><div className="connection-access-mode"><label htmlFor="browser-access-mode">局域网浏览器访问</label><SelectField id="browser-access-mode" aria-label="局域网浏览器访问" value={connection?.browserAccessMode??'direct'} disabled={locked} onValueChange={value=>void browserMode(value as BrowserAccessMode)}><option value="direct">可信局域网直接访问</option><option value="password">密码保护 · 临时密码</option></SelectField></div></>:<p>访问方式与临时密码由电脑端管理。</p>}
      <p className="local-connection-note">{connection?.browserAccessMode==='password'?'新设备需要临时密码；可记住登录 30 天。':'开启后，同一网络的设备可直接读写资料，无需密码。'}</p>
      {connection?.lanEnabled&&<><div className="connection-lan-addresses">{connection.lanUrls?.length?connection.lanUrls.map(url=><div key={url}><code>{url}</code><button className="text-btn" onClick={()=>void copy(url)}>复制</button></div>):<p>暂未检测到局域网 IPv4 地址，请检查网络连接。</p>}</div>{isDesktop&&connection.browserAccessMode==='password'&&<><div className="connection-pair"><button className="btn small" disabled={locked} onClick={()=>void pair()}>{pairing?'重新生成临时密码':'生成临时密码'}</button>{pairing&&<span>{pairing.expiresAt>now?<><code>{pairing.code}</code><small>剩余 {Math.ceil((pairing.expiresAt-now)/60000)} 分钟 · 仅用一次</small></>:'临时密码已过期'}</span>}</div><div className="connection-actions"><span className="connection-device-count">已记住 {connection.rememberedDeviceCount??0} 台设备</span><button className="btn small" disabled={locked} onClick={()=>void clearDevices()}>清除登录设备</button></div></>}<p className="local-connection-note">仅在可信网络开启。连接失败时检查防火墙。</p></>}
    </div><div className="connection-section"><h4>AI 接入 <span className="tag">API / MCP</span></h4>
      {connection?.mcpUrl&&<div className="local-connection-address"><code>{connection.mcpUrl}</code></div>}
      {isDesktop&&<><div className="connection-actions"><button className="btn small primary" disabled={locked} onClick={()=>config?setConfig(null):void reveal()}>{config?'收起配置':'查看 MCP 配置'}</button><button className="btn small" disabled={locked} onClick={()=>void rotate()}>更换 MCP 密钥</button></div></>}
      {config&&<div className="connection-config">{connection?.lanEnabled&&<SelectField aria-label="MCP 连接地址" value={target} onValueChange={setTarget}><option value="">本机 AI</option>{connection.lanUrls?.map(url=><option key={url} value={url}>{url}</option>)}</SelectField>}<pre>{configText}</pre><button className="btn small" onClick={()=>void copy(configText)}>复制 MCP 配置</button><p>使用 Streamable HTTP，配置含密钥，请勿公开。</p></div>}
      <div className="connection-skills" aria-label="Skill 下载">{(Object.keys(SKILL_PACKAGES) as SkillKind[]).map(kind=><div className="connection-skill" key={kind}><div><h5>{SKILL_PACKAGES[kind].name}</h5><p>{SKILL_PACKAGES[kind].description}</p></div><button className="btn small" disabled={downloading!==null||(!isDesktop&&!connection?.available)} onClick={()=>void download(kind)}>{downloading===kind?'正在准备…':`下载 ${SKILL_PACKAGES[kind].name}`}</button></div>)}<details className="settings-help"><summary>如何使用 Skill</summary><p>解压后加载整个文件夹。MCP 版需配置上方连接；API 版需指定软件的连接文件。</p></details></div>
    </div></div>
    {busy&&<p className="local-connection-note" role="status">正在切换连接…</p>}
    {notice&&<p role="status" className="connection-notice">{notice}</p>}{(error||connection?.error)&&<p role="alert" className="editor-error">{error||connection?.error}</p>}
  </section>;
}
