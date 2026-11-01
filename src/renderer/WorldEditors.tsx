import {assetUrl} from './runtime.ts';
import { LibraryImageButton } from './AssetPicker.tsx';
import React, { useRef, useState } from 'react';
import { Dialog, Tabs } from 'radix-ui';
import type { Character, WorldCategory, WorldCategoryInput, WorldEntry, WorldEntryInput, WorldEntryStatus } from '../shared/types.ts';
import { JourneyDialog } from './JourneyEditors.tsx';
import { CheckField, Input, SelectField, Textarea } from './Fields.tsx';
import { Icon } from './Icon.tsx';

export const entryStatuses:Record<WorldEntryStatus,string>={draft:'草稿',pending:'待讨论',adopted:'已采用'};

function CategoryEditor({worldId,category,onClose,onSaved}:{worldId:string;category:WorldCategory|null;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [draft,setDraft]=useState<WorldCategoryInput>(()=>({id:category?.id,worldId,name:category?.name??'',color:category?.color??'#bda374',description:category?.description??'',active:category?.active??true,expectedVersion:category?.version??0}));
  const initial=useRef(JSON.stringify(draft)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const result=await window.studio!.saveWorldCategory(draft);if(!result.ok)throw new Error(result.error.message);await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <JourneyDialog scopeLabel="世界分类" savedHint="同一世界的作品共用这些分类" title={category?'编辑设定分类':'新建设定分类'} description="按你的世界组织资料，例如地点、势力、规则、器物。" dirty={initial.current!==JSON.stringify(draft)} busy={busy} error={error} onClose={onClose} onSubmit={save}>
    <div className="editor-two"><label className="editor-field"><span>分类名称 *</span><Input required maxLength={60} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="editor-field"><span>分类颜色</span><Input className="relation-color-input" type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label></div>
    <label className="editor-field"><span>分类说明</span><Textarea rows={3} maxLength={1000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
    <label className="journey-check"><CheckField checked={draft.active} onCheckedChange={active=>setDraft({...draft,active})}/>允许新条目使用这个分类</label>
    <p className="attribute-hint">停用分类会保留已有条目。</p>
  </JourneyDialog>;
}

export function WorldCategoryManager({worldId,categories,entries,onChanged,onClose}:{worldId:string;categories:WorldCategory[];entries:WorldEntry[];onChanged:()=>Promise<void>;onClose:()=>void}) {
  const [editing,setEditing]=useState<WorldCategory|null|undefined>(undefined);
  if(editing!==undefined)return <CategoryEditor worldId={worldId} category={editing} onClose={()=>setEditing(undefined)} onSaved={onChanged}/>;
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="editor-dialog relation-type-dialog"><div className="editor-heading"><div><Dialog.Title>配置设定分类</Dialog.Title><Dialog.Description>分类名称、说明与颜色由你定义。</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭分类配置"><Icon name="close"/></Dialog.Close></div>
    <div className="journey-editor-body"><div className="between journey-section-head"><h3>{categories.length} 个分类</h3><button className="btn primary small" onClick={()=>setEditing(null)}><Icon name="plus"/>新建分类</button></div><div className="relation-type-list">{categories.map(c=><button className="relation-type-row" key={c.id} onClick={()=>setEditing(c)}><i style={{background:c.color}}/><strong>{c.name}</strong><small>{entries.filter(e=>e.categoryId===c.id).length} 项设定{c.active?'':' · 已停用'}</small><Icon name="pen"/></button>)}</div>{!categories.length&&<div className="journey-empty"><h3>为你的世界分门别类</h3><p>从最需要的一个分类开始，之后可以随时补充。</p></div>}</div>
    <div className="editor-footer"><small>停用分类不会移除已有资料</small><Dialog.Close className="btn">完成</Dialog.Close></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function WorldEntryEditor({worldId,entry,categories,entries,characters,categoryId,onClose,onSaved}:{worldId:string;entry:WorldEntry|null;categories:WorldCategory[];entries:WorldEntry[];characters:Character[];categoryId:string;onClose:()=>void;onSaved:(id:string)=>Promise<void>}) {
  const [draft,setDraft]=useState<WorldEntryInput>(()=>{
    const category=categories.find(c=>c.id===entry?.categoryId)??categories.find(c=>c.id===categoryId&&c.active)??categories.find(c=>c.active);
    return {id:entry?.id,worldId,categoryId:category?.id??'',expectedCategoryVersion:category?.version??0,expectedVersion:entry?.version??0,name:entry?.name??'',aliases:entry?.aliases??'',summary:entry?.summary??'',body:entry?.body??'',pending:entry?.pending??'',source:entry?.source??'',status:entry?.status??'draft',facts:structuredClone(entry?.facts??[]),imageId:entry?.imageId??null,links:structuredClone(entry?.links??[])};
  });
  const initial=useRef(JSON.stringify(draft)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[tab,setTab]=useState('basic'),[linkTarget,setLinkTarget]=useState('');
  const update=(change:Partial<WorldEntryInput>)=>setDraft(d=>({...d,...change}));
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const r=await window.studio!.saveWorldEntry(draft);if(!r.ok)throw new Error(r.error.message);await onSaved(r.value.id);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const pickImage=async()=>{setBusy(true);setError('');try{const r=await window.studio!.pickWorldImage(worldId);if(!r.ok)throw new Error(r.error.message);if(r.value)update({imageId:r.value.id});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const targets=[...characters.map(c=>({kind:'character' as const,id:c.id,name:c.name,archived:c.archived})),...entries.filter(e=>e.id!==entry?.id).map(e=>({kind:'entry' as const,id:e.id,name:e.name,archived:e.archived}))];
  const available=targets.filter(t=>!t.archived&&!draft.links.some(l=>l.kind===t.kind&&l.targetId===t.id));
  const addLink=()=>{const target=available.find(t=>`${t.kind}:${t.id}`===linkTarget);if(target){update({links:[...draft.links,{kind:target.kind,targetId:target.id,label:''}]});setLinkTarget('');}};
  const textField=(key:'name'|'aliases'|'summary'|'body'|'pending'|'source',label:string,max:number,rows?:number)=><label className="editor-field"><span>{label}</span>{rows?<Textarea maxLength={max} rows={rows} value={draft[key]} onChange={e=>update({[key]:e.target.value})}/>:<Input maxLength={max} required={key==='name'} value={draft[key]} onChange={e=>update({[key]:e.target.value})}/>}</label>;
  return <JourneyDialog scopeLabel="世界档案" savedHint="保存在当前世界的设定库中" title={entry?'编辑设定条目':'新建设定条目'} description="记录世界如何运转，以及它与人物、其他设定的联系。" dirty={initial.current!==JSON.stringify(draft)} busy={busy} error={error} onClose={onClose} onSubmit={save}>
    <Tabs.Root value={tab} onValueChange={setTab}><Tabs.List className="world-editor-tabs" aria-label="设定编辑分类"><Tabs.Trigger value="basic">基础信息</Tabs.Trigger><Tabs.Trigger value="content">正文与字段</Tabs.Trigger><Tabs.Trigger value="links">关联档案 · {draft.links.length}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="basic">{textField('name','条目名称 *',200)}<div className="editor-two"><label className="editor-field"><span>所属分类 *</span><SelectField value={draft.categoryId} required onValueChange={id=>update({categoryId:id,expectedCategoryVersion:categories.find(c=>c.id===id)!.version})}>{categories.filter(c=>c.active||c.id===draft.categoryId).map(c=><option key={c.id} value={c.id}>{c.name}{c.active?'':'（已停用）'}</option>)}</SelectField></label><label className="editor-field"><span>设定状态</span><SelectField value={draft.status} onValueChange={status=>update({status:status as WorldEntryStatus})}>{Object.entries(entryStatuses).map(([id,label])=><option key={id} value={id}>{label}</option>)}</SelectField></label></div>{textField('aliases','别名 / 其他称呼',1000)}{textField('summary','摘要',3000,3)}
        <div className="world-image-picker">{draft.imageId&&<img src={assetUrl(draft.imageId)} alt="条目图片预览"/>}<div><span>条目图片</span><small>保存完整图片，阅读时可放大查看。</small><div className="row"><button type="button" className="btn small" onClick={()=>void pickImage()}><Icon name="image"/>{draft.imageId?'更换图片':'选择图片'}</button><LibraryImageButton worldId={worldId} onChoose={asset=>update({imageId:asset.id})}/>{draft.imageId&&<button type="button" className="btn ghost small" onClick={()=>update({imageId:null})}>移除关联</button>}</div></div></div>
      </Tabs.Content>
      <Tabs.Content value="content">{textField('body','设定正文',100000,9)}<div className="between journey-section-head"><h3>补充资料 <small>{draft.facts.length} / 60</small></h3><button type="button" className="btn small" disabled={draft.facts.length>=60} onClick={()=>update({facts:[...draft.facts,{id:crypto.randomUUID(),label:'',value:''}]})}><Icon name="plus"/>添加字段</button></div>
        <div className="world-fact-fields">{draft.facts.map((f,index)=><div className="world-fact-field" key={f.id}><Input aria-label={`字段 ${index+1} 名称`} maxLength={80} placeholder="字段名称" value={f.label} onChange={e=>update({facts:draft.facts.map(x=>x.id===f.id?{...x,label:e.target.value}:x)})}/><Textarea aria-label={`字段 ${index+1} 内容`} maxLength={10000} rows={2} placeholder="字段内容（可留空）" value={f.value} onChange={e=>update({facts:draft.facts.map(x=>x.id===f.id?{...x,value:e.target.value}:x)})}/><button type="button" className="icon-button" aria-label={`移除字段 ${index+1}`} onClick={()=>update({facts:draft.facts.filter(x=>x.id!==f.id)})}><Icon name="close"/></button></div>)}</div>
        {textField('pending','待讨论内容',30000,3)}{textField('source','来源 / 参考说明',3000,2)}
      </Tabs.Content>
      <Tabs.Content value="links"><p className="attribute-hint">选择人物或设定，可补充关联说明。</p><div className="world-link-add"><SelectField aria-label="选择关联档案" value={linkTarget} onValueChange={setLinkTarget}><option value="">选择人物或设定…</option>{available.map(t=><option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.kind==='character'?'人物':'设定'} · {t.name}</option>)}</SelectField><button type="button" className="btn" disabled={!linkTarget||draft.links.length>=100} onClick={addLink}><Icon name="plus"/>添加关联</button></div>
        <div className="world-link-fields">{draft.links.map((link,index)=>{const target=targets.find(t=>t.id===link.targetId&&t.kind===link.kind);return <div className="world-link-field" key={`${link.kind}:${link.targetId}`}><div><small>{link.kind==='character'?'人物档案':'世界设定'}{target?.archived?' · 已归档':''}</small><strong>{target?.name??'未找到档案'}</strong></div><Input aria-label={`与${target?.name??'档案'}的关联说明`} maxLength={200} placeholder="关联说明（选填）" value={link.label} onChange={e=>update({links:draft.links.map((l,i)=>i===index?{...l,label:e.target.value}:l)})}/><button type="button" className="icon-button" aria-label={`移除关联 ${target?.name}`} onClick={()=>update({links:draft.links.filter((_,i)=>i!==index)})}><Icon name="close"/></button></div>;})}</div>
        {!draft.links.length&&<div className="journey-empty"><Icon name="network"/><h3>让设定彼此相连</h3><p>关联后可在档案间跳转。</p></div>}
      </Tabs.Content>
    </Tabs.Root>
  </JourneyDialog>;
}
