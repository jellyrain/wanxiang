import { Input } from './Fields.tsx';
import React, { useState } from 'react';
import { Dialog, AlertDialog } from 'radix-ui';
import type { Tag, Character, Result, CatalogRecord } from '../shared/types.ts';
import { Icon } from './Icon.tsx';

const colors = ['#bda374','#77a993','#7fa8cc','#ad8dc2','#cb909f','#bd9679'];
function unwrap<T>(result:Result<T>):T { if (!result.ok) throw new Error(result.error.message); return result.value; }
export function TagBadge({tag}:{tag:Tag}) { return <span className="tag configured-tag"><i style={{background:tag.color}}/>{tag.name}</span>; }

export function TagManager({worldId,worldName,tags,characters,catalogs=[],onChanged,onClose}:{worldId:string;worldName:string;tags:Tag[];characters:Character[];catalogs?:CatalogRecord[];onChanged:()=>Promise<void>;onClose:()=>void}) {
  const [editing,setEditing] = useState<Tag|null>(null);
  const [name,setName] = useState('');
  const [color,setColor] = useState(colors[0]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [deleting,setDeleting] = useState<Tag|null>(null);
  const [discard,setDiscard] = useState(false);
  const [next,setNext] = useState<{tag:Tag|null}|'close'|null>(null);
  const dirty = name !== (editing?.name ?? '') || color !== (editing?.color ?? colors[0]);
  const load = (tag:Tag|null) => { setEditing(tag); setName(tag?.name ?? ''); setColor(tag?.color ?? colors[0]); setError(''); };
  const request = (target:{tag:Tag|null}|'close') => {
    if (busy) return;
    if (dirty) { setNext(target); setDiscard(true); }
    else if (target === 'close') onClose(); else load(target.tag);
  };
  const save = async (event:React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      unwrap(await window.studio!.saveTag({id:editing?.id,worldId,name,color,expectedVersion:editing?.version ?? 0}));
      await onChanged(); load(null); setNotice(editing ? '标签已更新，关联资料已同步。' : '标签已加入，可在资料档案中选择。');
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setError('');
    try {
      unwrap(await window.studio!.deleteTag(deleting.id,deleting.version));
      await onChanged(); if (editing?.id === deleting.id) load(null); setDeleting(null); setNotice('标签已删除，资料档案仍保留。');
    } catch(e) { setError((e as Error).message); setDeleting(null); }
    finally { setBusy(false); }
  };
  const count = (tag:Tag) => characters.filter(c => c.tags.some(t => t.id === tag.id)).length+catalogs.filter(c=>c.tagIds.includes(tag.id)).length;
  return <><Dialog.Root open onOpenChange={open => { if (!open) request('close'); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/>
    <Dialog.Content className="editor-dialog tag-manager" onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => {e.preventDefault();request('close');}}>
      <div className="editor-heading"><div><Dialog.Title>先定义标签，再组织资料</Dialog.Title><Dialog.Description>{worldName} · 共享这个世界的作品使用同一套资料标签。</Dialog.Description></div><button className="icon-button" aria-label="关闭标签配置" onClick={() => request('close')} disabled={busy}><Icon name="close"/></button></div>
      <div className="tag-manager-body" inert={busy}>
        <section className="tag-catalog"><div className="between"><h3>已配置 <small>{tags.length}</small></h3><button className="text-link" onClick={() => request({tag:null})}><Icon name="plus"/>新标签</button></div>
          <div className="tag-catalog-list">{tags.map(tag => <div key={tag.id} className={`tag-catalog-row ${editing?.id === tag.id ? 'active' : ''}`}><button onClick={() => request({tag})} aria-label={`编辑标签 ${tag.name}`}><TagBadge tag={tag}/><small>{count(tag)} 份资料</small></button><button className="icon-button" aria-label={`删除标签 ${tag.name}`} onClick={() => setDeleting(tag)}><Icon name="close"/></button></div>)}
            {!tags.length && <p className="tag-empty">还没有标签，点击添加。</p>}
          </div>
        </section>
        <form className="tag-config-form" onSubmit={save}><h3>{editing ? '编辑标签' : '创建标签'}</h3>
          <label className="editor-field"><span>标签名称</span><Input value={name} maxLength={60} required placeholder="例如：主角、剑修、旅人" onChange={e => setName(e.target.value)}/></label>
          <fieldset className="tag-colors"><legend>标记颜色</legend><div className="row">{colors.map(value => <button key={value} type="button" className="tag-color" style={{background:value}} aria-label={`颜色 ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}>{color === value && <Icon name="check"/>}</button>)}<label className="custom-color" title="自定义颜色"><Input type="color" aria-label="自定义标签颜色" value={color} onChange={e => setColor(e.target.value)}/></label></div></fieldset>
          <p className="tag-config-hint">{editing ? '修改名称或颜色，会同步到已使用该标签的资料。' : '标签可以提前创建，暂时没有关联资料也会保留。'}</p>
          <button className="btn primary" type="submit" disabled={!name.trim() || !dirty}>{editing ? '保存标签' : '添加标签'}</button>
        </form>
      </div>
      {(error || notice) && <div className={error ? 'editor-error' : 'tag-notice'} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <AlertDialog.Root open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay nested-overlay"/><AlertDialog.Content className="confirm-dialog nested-dialog"><AlertDialog.Title>删除“{deleting?.name}”？</AlertDialog.Title><AlertDialog.Description>会从标签库及 {deleting ? count(deleting) : 0} 份资料（含已归档资料）中移除此标签，关联资料会保留。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn" disabled={busy}>取消</AlertDialog.Cancel><button className="btn danger" disabled={busy} onClick={() => void remove()}>删除标签</button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    <AlertDialog.Root open={discard} onOpenChange={setDiscard}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay nested-overlay"/><AlertDialog.Content className="confirm-dialog nested-dialog"><AlertDialog.Title>标签修改尚未保存</AlertDialog.Title><AlertDialog.Description>继续编辑，或放弃这次尚未保存的修改。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn primary">继续编辑</AlertDialog.Cancel><AlertDialog.Action className="btn" onClick={() => {if(next === 'close') onClose();else if(next) load(next.tag);setNext(null);}}>放弃修改</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </>;
}
