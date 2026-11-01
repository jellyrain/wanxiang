import React,{useEffect,useRef,useState} from 'react';
import {Tabs} from 'radix-ui';
import type {CatalogKind,LibraryConfig,LibrarySnapshot,RecordKind} from '../shared/types.ts';
import {libraryConfig,categoryLabels,recordKinds} from '../shared/library-config.ts';
import {JourneyDialog} from './JourneyEditors.tsx';
import {Input,SelectField,CheckField} from './Fields.tsx';
import {FactFields} from './RecordFields.tsx';
import {TagManager} from './TagManager.tsx';
import {AttributeManager} from './AttributeManager.tsx';
import {DeletionDialog} from './DeletionDialog.tsx';
import {Icon} from './Icon.tsx';

export function LibraryConfigDialog({library,worldId,initialKind='character',onClose,onChanged}:{library:LibrarySnapshot;worldId:string;initialKind?:RecordKind;onClose:()=>void;onChanged:()=>Promise<void>}){
  const saved=libraryConfig(library,worldId),[draft,setDraft]=useState<LibraryConfig>(()=>structuredClone(saved)),initial=useRef(JSON.stringify(draft));
  const [kind,setKind]=useState<RecordKind>(initialKind),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[manager,setManager]=useState<'tags'|'templates'|null>(null),[deleting,setDeleting]=useState<{id:string;kind:CatalogKind}|null>(null);
  const dirty=initial.current!==JSON.stringify(draft),group=draft.groups[kind],templates=library.attributeTemplates.filter(t=>t.worldId===worldId),characters=library.characters.filter(c=>c.worldId===worldId),catalogs=[...library.items,...library.techniques,...library.places].filter(r=>r.worldId===worldId);
  useEffect(()=>{if(!dirty&&saved.version!==draft.version){const next=structuredClone(saved);initial.current=JSON.stringify(next);setDraft(next);}},[saved,dirty,draft.version]);
  const update=(change:Partial<typeof group>)=>setDraft({...draft,groups:{...draft.groups,[kind]:{...group,...change}}});
  const reorder=(index:number,offset:number)=>{const next=[...group.categories];[next[index],next[index+offset]]=[next[index+offset],next[index]];update({categories:next});};
  const save=async(e:React.FormEvent)=>{e.preventDefault();e.stopPropagation();setBusy(true);setError('');setNotice('');try{const r=await window.studio!.saveLibraryConfig({...draft,expectedVersion:draft.version});if(!r.ok)throw Error(r.error.message);initial.current=JSON.stringify(r.value);setDraft(r.value);await onChanged();setNotice('资料配置已保存');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <><JourneyDialog wide title="资料配置" description={library.worlds.find(w=>w.id===worldId)?.name??''} scopeLabel="世界资料配置" dirty={dirty} busy={busy} error={error} onClose={onClose} onSubmit={save} submitLabel="保存配置">
    <div className="row wrap config-shortcuts"><button type="button" className="btn" onClick={()=>setManager('tags')}><Icon name="tag"/>管理标签</button><button type="button" className="btn" onClick={()=>setManager('templates')}><Icon name="radar"/>管理数值模板</button></div>
    <Tabs.Root value={kind} onValueChange={v=>setKind(v as RecordKind)}><Tabs.List className="world-editor-tabs" aria-label="配置资料类型">{Object.entries(recordKinds).map(([id,name])=><Tabs.Trigger key={id} value={id}>{name}</Tabs.Trigger>)}</Tabs.List>
      <Tabs.Content value={kind} className="config-sections">
        {kind!=='character'&&<section><div className="between field-section-head"><h3>{categoryLabels[kind]}</h3><button type="button" className="btn small" disabled={group.categories.length>=200} onClick={()=>update({categories:[...group.categories,{id:crypto.randomUUID(),name:'',active:true}]})}>新增类别</button></div><div className="config-category-list">{group.categories.map((c,i)=><div className="config-category-row" key={c.id}><Input aria-label={`类别名称 ${i+1}`} value={c.name} maxLength={200} onChange={e=>update({categories:group.categories.map(v=>v.id===c.id?{...v,name:e.target.value}:v)})}/><label className="row"><CheckField checked={c.active} onCheckedChange={active=>update({categories:group.categories.map(v=>v.id===c.id?{...v,active}:v)})}/>启用</label><div className="row"><button type="button" className="icon-button" aria-label={`上移类别 ${c.name||i+1}`} disabled={i===0} onClick={()=>reorder(i,-1)}>↑</button><button type="button" className="icon-button" aria-label={`下移类别 ${c.name||i+1}`} disabled={i===group.categories.length-1} onClick={()=>reorder(i,1)}>↓</button><button type="button" className="btn small danger" disabled={dirty&&saved.groups[kind].categories.some(v=>v.id===c.id)} title={dirty?'请先保存当前配置':''} onClick={()=>{if(!saved.groups[kind].categories.some(v=>v.id===c.id))update({categories:group.categories.filter(v=>v.id!==c.id)});else setDeleting({id:c.id,kind});}}>删除</button></div></div>)}</div>{!group.categories.length&&<p className="muted">暂无类别。资料仍可保存为未分类。</p>}{dirty&&<p className="muted">保存配置后，可预览删除已有类别的影响。</p>}</section>}
        <section><label className="editor-field"><span>新{recordKinds[kind]}的默认数值模板</span><SelectField aria-label="默认数值模板" value={group.templateId??''} onValueChange={v=>update({templateId:v||null})}><option value="">不预设数值模板</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></label></section>
        <FactFields value={group.fields} onChange={fields=>update({fields})}/><p className="muted">补充资料中的字段和内容用于新建{recordKinds[kind]}；已有资料可在编辑时添加预设字段。</p>
      </Tabs.Content>
    </Tabs.Root>{notice&&<p role="status">{notice}</p>}
  </JourneyDialog>
  {manager==='tags'&&<TagManager worldId={worldId} worldName={library.worlds.find(w=>w.id===worldId)?.name??''} tags={library.tags.filter(t=>t.worldId===worldId)} characters={characters} catalogs={catalogs} onChanged={onChanged} onClose={()=>setManager(null)}/>}
  {manager==='templates'&&<AttributeManager worldId={worldId} templates={templates} setting={library.attributeDefaults.find(d=>d.worldId===worldId)} characters={characters} catalogs={catalogs} onChanged={onChanged} onClose={()=>setManager(null)}/>}
  {deleting&&<DeletionDialog library={library} initialTarget={{kind:'catalogCategory',id:deleting.id,parentId:worldId,catalogKind:deleting.kind}} onChanged={onChanged} onClose={()=>setDeleting(null)}/>}
  </>;
}
