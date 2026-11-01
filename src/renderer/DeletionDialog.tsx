import React,{useState} from 'react';
import {Dialog} from 'radix-ui';
import type {LibrarySnapshot,Result} from '../shared/types.ts';
import {deletionItems,deletionKinds,deletionKey,type DeletionKind,type DeletionTarget,type DeletionPreview} from '../shared/deletion.ts';
import {Input,SelectField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
const unwrap=<T,>(r:Result<T>):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
export function DeletionDialog({library,initialTarget,initialKind,onClose,onChanged}:{library:LibrarySnapshot;initialTarget?:DeletionTarget;initialKind?:DeletionKind;onClose:()=>void;onChanged:()=>Promise<void>}){
  const [kind,setKind]=useState<DeletionKind>(initialTarget?.kind??initialKind??'work'),[replacementId,setReplacementId]=useState(''),[query,setQuery]=useState(''),[key,setKey]=useState(initialTarget?deletionKey(initialTarget):'');
  const [preview,setPreview]=useState<DeletionPreview|null>(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const items=deletionItems(library).filter(v=>v.kind===kind&&`${v.name} ${v.scope}`.toLowerCase().includes(query.toLowerCase())),target=items.find(v=>deletionKey(v)===key);
  const reset=()=>{setPreview(null);setName('');setError('');setNotice('');};
  const read=async()=>{if(!target)return;setBusy(true);reset();try{setPreview(unwrap(await window.studio!.previewDeletion({...target,...(target.kind==='catalogCategory'?{replacementId:replacementId||null}:{})})));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const remove=async()=>{if(!preview)return;setBusy(true);setError('');try{unwrap(await window.studio!.deleteContent({token:preview.token,name}));setPreview(null);setName('');setKey('');await onChanged();setNotice(`已删除“${preview.target.name}”`);}catch(e){setPreview(null);setName('');setError((e as Error).message);}finally{setBusy(false);}};
  return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="deletion-dialog" onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
    <header><div><Dialog.Title>删除资料</Dialog.Title><Dialog.Description>选择资料，查看影响范围后永久删除。手动与 AI 创建的内容使用相同规则。</Dialog.Description></div><button className="icon-button" disabled={busy} aria-label="关闭删除资料" onClick={onClose}><Icon name="close"/></button></header>
    <div className="deletion-scroll"><div className="deletion-filters"><label className="editor-field"><span>资料类型</span><SelectField aria-label="删除资料类型" value={kind} disabled={busy} onValueChange={v=>{setKind(v as DeletionKind);setKey('');setQuery('');reset();}}>{Object.entries(deletionKinds).map(([v,label])=><option key={v} value={v}>{label}</option>)}</SelectField></label><label className="editor-field"><span>查找资料</span><Input aria-label="查找待删除资料" value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);setKey('');reset();}} placeholder="名称或所属作品、世界"/></label></div>
    <label className="editor-field"><span>选择资料（含已归档、已停用）</span><SelectField aria-label="选择待删除资料" value={key} disabled={busy} onValueChange={v=>{setKey(v);reset();}}><option value="">{items.length?'请选择资料':'没有匹配资料'}</option>{items.map(v=><option key={deletionKey(v)} value={deletionKey(v)}>{v.name} · {v.scope}</option>)}</SelectField></label>
    {target?.kind==='catalogCategory'&&<label className="editor-field"><span>使用此类别的资料</span><SelectField aria-label="删除类别后的归属" value={replacementId} disabled={busy} onValueChange={v=>{setReplacementId(v);reset();}}><option value="">清空类别，保留资料</option>{library.libraryConfigs.find(c=>c.worldId===target.worldId)?.groups[target.catalogKind!].categories.filter(c=>c.id!==target.id&&c.active).map(c=><option key={c.id} value={c.id}>转移到 {c.name}</option>)}</SelectField></label>}
    <button className="btn" disabled={busy||!target} onClick={()=>void read()}>{busy?'处理中…':'预览删除范围'}</button>
    {preview&&<section className="deletion-preview"><h3>将删除：{preview.target.name}</h3><ul>{preview.notes.map(v=><li key={v}>{v}</li>)}</ul><details open><summary>包含 {preview.included.length} 项资料</summary><ul className="deletion-items">{preview.included.map(v=><li key={deletionKey(v)}><span>{deletionKinds[v.kind]}</span>{v.name}</li>)}</ul></details>
      {preview.blockers.length?<div className="deletion-blockers" role="alert"><strong>请先解除以下引用，或删除引用它的资料：</strong><ul>{preview.blockers.map(v=><li key={v}>{v}</li>)}</ul></div>:<label className="editor-field"><span>输入完整名称“{preview.target.name}”以确认删除</span><Input aria-label="确认删除资料名称" value={name} disabled={busy} onChange={e=>setName(e.target.value)} autoComplete="off"/></label>}
    </section>}
    {error&&<p className="error-banner" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</div>
    <footer><button className="btn" disabled={busy} onClick={onClose}>关闭</button><button className="btn danger" disabled={busy||!preview||preview.blockers.length>0||name!==preview.target.name} onClick={()=>void remove()}>永久删除</button></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
