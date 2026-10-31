import {assetUrl} from './runtime.ts';
import React, { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { MediaAsset, MediaCatalog } from '../shared/types.ts';
import { emptyMediaCatalog, mediaSearchText } from '../shared/gallery.ts';
import { Input, SelectField } from './Fields.tsx';
import { Icon } from './Icon.tsx';

export function MediaImage({id,name,className='',onSize}:{id:string|null;name:string;className?:string;onSize?:(width:number,height:number)=>void}) {
  const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[id]);
  return id&&!failed?<img className={className} src={assetUrl(id)} alt={name} loading="lazy" draggable={false} onError={()=>setFailed(true)} onLoad={e=>onSize?.(e.currentTarget.naturalWidth,e.currentTarget.naturalHeight)}/>:<div className={`media-image-missing ${className}`}><Icon name="image"/><span>{id?'图片暂时无法读取':'等待一张图片'}</span></div>;
}

export function AssetPicker({worldId,onClose,onChoose}:{worldId:string;onClose:()=>void;onChoose:(asset:MediaAsset)=>void}) {
  const [media,setMedia]=useState<MediaAsset[]>([]),[catalog,setCatalog]=useState<MediaCatalog>(()=>emptyMediaCatalog(worldId)),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[selected,setSelected]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;void window.studio!.snapshot().then(r=>{if(!active)return;if(!r.ok)throw Error(r.error.message);setMedia((r.value.media??[]).filter(m=>m.worldId===worldId&&!m.archived));setCatalog(r.value.mediaCatalogs?.find(c=>c.worldId===worldId)??emptyMediaCatalog(worldId));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[worldId]);
  const shown=media.filter(m=>(!category||m.categoryId===category)&&mediaSearchText(m,catalog).includes(query.trim().toLowerCase())),asset=shown.find(m=>m.id===selected);
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay asset-picker-overlay"/><Dialog.Content className="editor-dialog asset-picker-dialog" onInteractOutside={e=>e.preventDefault()}>
    <div className="editor-heading"><div><Dialog.Title>从素材库选择</Dialog.Title><Dialog.Description>选择当前世界的图片。</Dialog.Description></div><button className="icon-button" aria-label="关闭素材选择" onClick={onClose}><Icon name="close"/></button></div>
    <div className="asset-picker-toolbar"><Input aria-label="搜索素材库图片" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索名称、标签、说明"/><SelectField aria-label="筛选素材库分类" value={category} onValueChange={setCategory}><option value="">全部分类</option>{catalog.categories.map(c=><option key={c.id} value={c.id}>{c.name}{c.active?'':'（已停用）'}</option>)}</SelectField></div>
    <div className="asset-picker-body">{loading?<p className="empty">正在读取素材…</p>:error?<p className="editor-error" role="alert">{error}</p>:shown.length?<div className="asset-picker-grid">{shown.map(m=><button className={`asset-picker-item ${m.id===selected?'selected':''}`} key={m.id} aria-pressed={m.id===selected} aria-label={`选择素材 ${m.name}`} onClick={()=>setSelected(m.id)}><MediaImage id={m.id} name={m.name}/><span>{m.name}</span>{m.favorite&&<Icon name="star"/>}</button>)}</div>:<div className="empty"><Icon name="image"/><p>{query||category?'没有匹配的素材。':'素材库还没有图片。可以关闭此窗口，从本地导入。'}</p></div>}</div>
    <div className="editor-footer"><small>{asset?.name??'选择后确认使用'}</small><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!asset} onClick={()=>{if(asset){onChoose(asset);onClose();}}}>使用这张图片</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function LibraryImageButton({worldId,onChoose,disabled=false}:{worldId:string;onChoose:(asset:MediaAsset)=>void;disabled?:boolean}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="btn small" disabled={disabled} onClick={()=>setOpen(true)}><Icon name="grid"/>从素材库选择</button>{open&&<AssetPicker worldId={worldId} onClose={()=>setOpen(false)} onChoose={onChoose}/>}</>;
}
