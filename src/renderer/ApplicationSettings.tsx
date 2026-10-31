import {AboutSettings} from './AboutSettings.tsx';
import React, {useEffect,useRef,useState} from 'react';
import {AlertDialog,Tabs} from 'radix-ui';
import type {BackupEstimate,BackupPoint,BackupSettings,BackupStatus,RestorePreview} from '../shared/backup.ts';
import type {Result,LibrarySnapshot} from '../shared/types.ts';
import {Input,SelectField,CheckField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {isDesktop} from './runtime.ts';
import {LocalConnection} from './LocalConnection.tsx';
import {DesktopSettings} from './DesktopSettings.tsx';
import {UpdateSettings} from './UpdateSettings.tsx';
import {HistoryDialog} from './HistoryDialog.tsx';
import {TransferDialog} from './TransferDialog.tsx';

function unwrap<T>(result:Result<T>):T {if(!result.ok)throw Error(result.error.message);return result.value;}
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未备份';
const size=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024**2?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024**2).toFixed(1)} MB`;
type Confirmation={kind:'baseline';estimate:BackupEstimate}|{kind:'restore';preview:RestorePreview}|{kind:'delete';point:BackupPoint};

function BackupSettings({onDirtyChange}:{onDirtyChange:(dirty:boolean)=>void}) {
  const [status,setStatus]=useState<BackupStatus|null>(null),[draft,setDraft]=useState<BackupSettings|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [confirmation,setConfirmation]=useState<Confirmation|null>(null),[acknowledged,setAcknowledged]=useState(false);
  const latestSaved=useRef<BackupSettings|null>(null);
  const receive=(value:BackupStatus)=>{
    const previous=latestSaved.current;latestSaved.current=value.settings;
    setStatus(value);
    // Follow other windows when this form is untouched, but keep a locally edited draft.
    setDraft(current=>current===null||JSON.stringify(current)===JSON.stringify(previous)?value.settings:current);
  };
  const refresh=async()=>{const value=unwrap(await window.studio!.getBackupStatus());receive(value);return value;};
  useEffect(()=>{
    let alive=true;
    const load=async()=>{try{const value=unwrap(await window.studio!.getBackupStatus());if(alive)receive(value);}catch(e){if(alive)setError((e as Error).message);}};
    void load();const timer=setInterval(()=>void load(),5000);return()=>{alive=false;clearInterval(timer);};
  },[]);
  const dirty=Boolean(status&&draft&&JSON.stringify(status.settings)!==JSON.stringify(draft));
  useEffect(()=>{onDirtyChange(dirty||busy||Boolean(confirmation));return()=>onDirtyChange(false);},[dirty,busy,confirmation,onDirtyChange]);
  const perform=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();await refresh();}catch(e){setError((e as Error).message);try{await refresh();}catch{/* Keep the original error. */}}finally{setBusy(false);}};
  const save=()=>perform(async()=>{const value=unwrap(await window.studio!.saveBackupSettings(draft!));setStatus(value);setDraft(value.settings);setNotice(value.needsBaseline&&value.settings.automatic?'设置已保存。请手动建立基准，自动任务才会开始保存增量。':'备份设置已保存');});
  const previewBaseline=()=>perform(async()=>{setAcknowledged(false);setConfirmation({kind:'baseline',estimate:unwrap(await window.studio!.estimateBackup())});});
  const previewRestore=(id:string)=>perform(async()=>{setAcknowledged(false);setConfirmation({kind:'restore',preview:unwrap(await window.studio!.previewBackupRestore(id))});});
  const confirm=()=>perform(async()=>{
    if(!confirmation)return;
    if(confirmation.kind==='baseline') {
      unwrap(await window.studio!.createBackupBaseline({generation:confirmation.estimate.generation,sequence:confirmation.estimate.sequence}));setNotice('基准备份已建立');
    } else if(confirmation.kind==='restore') {
      unwrap(await window.studio!.restoreBackup(confirmation.preview.token));setNotice('资料库已恢复，正在重新载入…');setTimeout(()=>window.location.reload(),300);
    } else {unwrap(await window.studio!.deleteBackupPoint(confirmation.point.id));setNotice('恢复点已删除');}
    setConfirmation(null);
  });
  if(!status||!draft)return <section className="backup-settings">{error?<div className="error-banner" role="alert">{error}<button className="btn small" onClick={()=>void perform(async()=>{await refresh();})}>重试</button></div>:<div className="empty">正在读取备份设置…</div>}</section>;
  const locked=busy||status.busy;
  return <section className="backup-settings">
    {error&&!confirmation&&<div className="error-banner" role="alert">{error}</div>}
    <div className="application-settings-scroll">
      <div className="backup-summary">
        <article><span><Icon name="archive"/>恢复基础</span><strong>{status.needsBaseline?'等待手动基准':'基准已就绪'}</strong><small>{status.needsBaseline?'先建立一次基准备份':'后续保存增量'}</small></article>
        <article><span><Icon name="history"/>自动增量</span><strong>{status.settings.automatic?`每 ${status.settings.intervalMinutes} 分钟`:'尚未开启'}</strong><small>{status.busy?status.phase:status.pendingChanges?`${status.pendingChanges} 项变更待备份`:'没有待备份的变化'}</small></article>
        <article><span><Icon name="check"/>最近成功</span><strong>{time(status.lastSuccess)}</strong><small>{status.points.length} 个恢复点</small></article>
      </div>
      {(status.repositoryError||status.lastError)&&<div className="backup-warning" role="status"><Icon name="info"/><div><strong>备份需要留意</strong><p>{status.repositoryError||status.lastError}</p></div></div>}
      <div className="backup-config-grid">
        <section className="backup-panel"><header><h2>备份安排</h2></header>
          <label className="editor-field"><span>保存目录</span><div className="backup-path"><Input aria-label="备份保存目录" value={draft.directory} onChange={e=>setDraft({...draft,directory:e.target.value})} disabled={locked}/>{isDesktop&&<button className="btn" disabled={locked} onClick={()=>void perform(async()=>{const path=unwrap(await window.studio!.pickBackupDirectory());if(path)setDraft({...draft,directory:path});})}><Icon name="folder"/>选择</button>}</div></label>
          <div className="backup-settings-row"><label className="backup-toggle"><CheckField checked={draft.automatic} disabled={locked} onCheckedChange={automatic=>setDraft({...draft,automatic})}/>自动保存增量</label><label className="editor-field"><span>备份间隔</span><SelectField aria-label="备份间隔" value={String(draft.intervalMinutes)} disabled={locked} onValueChange={v=>setDraft({...draft,intervalMinutes:Number(v)})}>{[5,15,30,60,120,360,1440].map(n=><option value={String(n)} key={n}>{n<60?`${n} 分钟`:`${n/60} 小时`}</option>)}</SelectField></label><label className="editor-field"><span>旧分支保留</span><SelectField aria-label="旧分支保留时间" value={String(draft.retentionDays)} disabled={locked} onValueChange={v=>setDraft({...draft,retentionDays:Number(v)})}>{[0,7,30,90,365].map(n=><option value={String(n)} key={n}>{n?`${n} 天`:'全部保留'}</option>)}</SelectField></label></div>
          <p className="backup-help">无变化时跳过备份；清理旧分支会保留恢复所需的依赖。</p>
          <footer><span>{dirty?'尚未保存':''}</span><button className="btn primary" disabled={locked||!dirty} onClick={()=>void save()}>保存设置</button></footer>
        </section>
        <section className="backup-panel backup-actions"><h2>手动备份</h2><button className="btn primary" disabled={locked||dirty||status.needsBaseline} onClick={()=>void perform(async()=>{const value=unwrap(await window.studio!.runIncrementalBackup());setNotice(value.skipped?'没有新变化，本次已跳过。':'增量备份已保存。');})}><Icon name="plus"/>立即保存增量</button><button className="btn" disabled={locked||dirty} onClick={()=>void previewBaseline()}><Icon name="archive"/>{status.needsBaseline?'手动建立初始基准':'手动建立新基准'}</button><small>{dirty?'请先保存备份设置。':'基准保存全量，增量只保存变化。'}</small></section>
      </div>
      <section className="backup-panel backup-history"><header><div><h2>恢复点</h2></div><button className="text-link" disabled={locked} onClick={()=>void perform(async()=>{await refresh();})}>刷新 <Icon name="redo"/></button></header>
        {!status.points.length?<div className="backup-empty"><Icon name="archive"/><strong>还没有恢复点</strong><p>手动建立一次基准，就可以开始保存后续增量。</p></div>:<div className="backup-points">{status.points.map(point=>{
          const protectedPoint=point.id===status.headId||status.points.some(p=>p.parentId===point.id);
          return <article className="backup-point" key={point.id}><div className="backup-point-icon"><Icon name={point.kind==='baseline'?'archive':'history'}/></div><div className="backup-point-title"><strong>{time(point.createdAt)} <span className="tag">{point.kind==='baseline'?'手动基准':'增量'}</span>{point.id===status.headId&&<span className="backup-current">当前链</span>}</strong><small>{point.label} · {point.records} 条记录 · 新增 {point.newImages} 张图片</small></div><span className="backup-point-size">{size(point.bytes)}</span><button className="btn small" disabled={locked||dirty} onClick={()=>void previewRestore(point.id)}>预览恢复</button><button className="icon-button" aria-label={`删除恢复点 ${time(point.createdAt)}`} title={protectedPoint?'当前链或后续增量仍依赖此恢复点':'删除这个独立恢复点'} disabled={locked||dirty||protectedPoint} onClick={()=>{setError('');setAcknowledged(false);setConfirmation({kind:'delete',point});}}><Icon name="close"/></button></article>;
        })}</div>}
        
      </section>
    </div>
    <AlertDialog.Root open={Boolean(confirmation)} onOpenChange={open=>{if(!open&&!busy){setConfirmation(null);setError('');}}}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay"/><AlertDialog.Content className="confirm-dialog backup-confirm"><AlertDialog.Title>{confirmation?.kind==='baseline'?'手动建立基准备份':confirmation?.kind==='restore'?'恢复整个资料库？':'删除这个恢复点？'}</AlertDialog.Title><AlertDialog.Description>{confirmation?.kind==='baseline'?'完整备份当前资料库的文字与图片。':confirmation?.kind==='restore'?'恢复会替换所有作品、世界及其关联资料。其他窗口会要求重新打开，尚未保存的草稿不会进入备份。':'此恢复点没有后续依赖。删除后无法再恢复到这个时间点。'}</AlertDialog.Description>
      {confirmation?.kind==='baseline'&&<div className="backup-preview"><span>{confirmation.estimate.worlds} 个世界 · {confirmation.estimate.works} 部作品</span><span>{confirmation.estimate.records} 条记录 · {confirmation.estimate.images} 张图片</span><strong>预计 {size(confirmation.estimate.bytes)}</strong><small>相同图片会复用，实际新增大小可能更小。</small></div>}
      {confirmation?.kind==='restore'&&<div className="backup-preview"><strong>{time(confirmation.preview.point.createdAt)}</strong><span>{confirmation.preview.worlds} 个世界 · {confirmation.preview.works} 部作品</span><span>{confirmation.preview.characters} 位人物 · {confirmation.preview.chapters} 章 · {confirmation.preview.images} 张图片</span><small>已校验 {confirmation.preview.chainLength} 个依赖恢复点及图片。</small><p>{confirmation.preview.canProtectCurrent?'恢复前会补存当前未备份的增量，保留原分支。':'当前资料没有可用基准，恢复前不会自动创建全量备份。若要保留当前资料，请先取消并手动建立基准。'}</p></div>}
      {confirmation?.kind==='restore'&&<label className="backup-toggle"><CheckField checked={acknowledged} onCheckedChange={setAcknowledged} disabled={busy}/>我已处理其他窗口的草稿，确认恢复全部作品</label>}
      {error&&<p className="editor-error" role="alert">{error}</p>}<div className="dialog-buttons"><AlertDialog.Cancel className="btn" disabled={busy}>取消</AlertDialog.Cancel><button className="btn primary" disabled={busy||(confirmation?.kind==='restore'&&!acknowledged)} onClick={()=>void confirm()}>{busy?'正在处理…':confirmation?.kind==='baseline'?'手动建立全量基准':confirmation?.kind==='restore'?'确认恢复全部资料':'删除恢复点'}</button></div>
    </AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    {(busy||status.busy)&&<div className="save-notice" role="status">{status.phase||'正在处理，请稍候…'}</div>}
    {notice&&!busy&&<div className="save-notice" role="status">{notice}</div>}
  </section>;
}

export function ApplicationSettings({onDirtyChange,library,onChanged,onShowWelcome,onShowAppearance}:{onDirtyChange:(dirty:boolean)=>void;library:LibrarySnapshot;onChanged:()=>Promise<void>;onShowWelcome:()=>void;onShowAppearance:()=>void}) {
  const [tab,setTab]=useState('general'),[historyOpen,setHistoryOpen]=useState(false),[transferOpen,setTransferOpen]=useState(false);
  const [backupDirty,setBackupDirty]=useState(false),[updateDirty,setUpdateDirty]=useState(false);
  useEffect(()=>{onDirtyChange(backupDirty||updateDirty||historyOpen||transferOpen);return()=>onDirtyChange(false);},[backupDirty,updateDirty,historyOpen,transferOpen,onDirtyChange]);
  const tabs=[['general','通用','sliders'],['backup','备份与恢复','archive'],['connection','连接','network'],...(isDesktop?[['update','更新','redo']]:[]),['about','关于','info']];
  return <section className="application-settings">
    <div className="page-head"><h1>软件设置</h1></div>
    <Tabs.Root value={tab} onValueChange={setTab} className="settings-tabs">
      <Tabs.List className="settings-nav" aria-label="设置分类">{tabs.map(([value,label,icon])=><Tabs.Trigger value={value} key={value}><Icon name={icon}/>{label}{((value==='backup'&&backupDirty)||(value==='update'&&updateDirty))&&<span className="settings-unsaved" aria-label="未保存"/>}</Tabs.Trigger>)}</Tabs.List>
      <Tabs.Content forceMount value="general" className="settings-panel settings-general">
        <DesktopSettings/>
        <section className="backup-panel settings-shortcuts" aria-label="资料与外观"><h2>资料与外观</h2>
          <div className="settings-row"><span><Icon name="palette"/>主题与背景</span><button className="btn" onClick={onShowAppearance}>自定义 <Icon name="arrow"/></button></div>
          <div className="settings-row"><span><Icon name="folder"/>导入与导出</span><button className="btn" onClick={()=>setTransferOpen(true)}>打开 <Icon name="arrow"/></button></div>
          <div className="settings-row"><span><Icon name="history"/>修改历史</span><button className="btn" onClick={()=>setHistoryOpen(true)}>查看 <Icon name="arrow"/></button></div>
          <div className="settings-row"><span><Icon name="book"/>开始使用</span><button className="btn" onClick={onShowWelcome}>新建或导入作品 <Icon name="arrow"/></button></div>
        </section>
      </Tabs.Content>
      <Tabs.Content forceMount value="backup" className="settings-panel"><BackupSettings onDirtyChange={setBackupDirty}/></Tabs.Content>
      <Tabs.Content forceMount value="connection" className="settings-panel"><LocalConnection/></Tabs.Content>
      {isDesktop&&<Tabs.Content forceMount value="update" className="settings-panel"><UpdateSettings onDirtyChange={setUpdateDirty}/></Tabs.Content>}
      <Tabs.Content value="about" className="settings-panel"><AboutSettings/></Tabs.Content>
    </Tabs.Root>
    {historyOpen&&<HistoryDialog library={library} onChanged={onChanged} onClose={()=>setHistoryOpen(false)}/>}
    {transferOpen&&<TransferDialog library={library} onChanged={onChanged} onClose={()=>setTransferOpen(false)}/>}
  </section>;
}
