import React,{useState} from 'react';
import type {AttributeTemplate,CatalogKind,CharacterAttributes,Fact,LibrarySnapshot,Tag} from '../shared/types.ts';
import {categoryLabels,libraryConfig} from '../shared/library-config.ts';
import {Input,Textarea,SelectField,CheckField} from './Fields.tsx';
import {AttributeFields} from './AttributeView.tsx';
import {AttributeManager} from './AttributeManager.tsx';
import {Icon} from './Icon.tsx';

export function FactFields({value,onChange,defaults=[]}:{value:Fact[];onChange:(v:Fact[])=>void;defaults?:Fact[]}){
  const missing=defaults.filter(f=>!value.some(v=>v.label===f.label));
  return <section><div className="between field-section-head"><h3>补充资料</h3><div className="row wrap">{missing.length>0&&<button type="button" className="btn small" disabled={value.length+missing.length>60} onClick={()=>onChange([...value,...missing.map(f=>({...f,id:crypto.randomUUID()}))])}>添加预设字段</button>}<button type="button" className="btn small" disabled={value.length>=60} onClick={()=>onChange([...value,{id:crypto.randomUUID(),label:'',value:''}])}>添加字段</button></div></div>
    {value.map((f,i)=><div className="fact-editor-row" key={f.id}><label className="editor-field"><span>字段名称 {i+1}</span><Input value={f.label} maxLength={100} onChange={e=>onChange(value.map(v=>v.id===f.id?{...v,label:e.target.value}:v))}/></label><label className="editor-field"><span>内容</span><Textarea rows={2} value={f.value} maxLength={10000} onChange={e=>onChange(value.map(v=>v.id===f.id?{...v,value:e.target.value}:v))}/></label><button type="button" className="icon-button" aria-label={'移除字段 '+(f.label||i+1)} onClick={()=>onChange(value.filter(v=>v.id!==f.id))}><Icon name="close"/></button></div>)}
  </section>;
}

export function TagPicker({worldId,tags,value,onChange,onBusyChange}:{onBusyChange?:(busy:boolean)=>void;worldId:string;tags:Tag[];value:string[];onChange:(v:string[])=>void}){
  const [extra,setExtra]=useState<Tag[]>([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const choices=[...tags,...extra.filter(t=>!tags.some(v=>v.id===t.id))],visible=choices.filter(t=>t.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const create=async()=>{if(busy||!query.trim())return;setBusy(true);onBusyChange?.(true);setError('');try{const r=await window.studio!.saveTag({worldId,name:query.trim(),color:'#bda374',expectedVersion:0});if(!r.ok)throw Error(r.error.message);setExtra([...extra,r.value]);onChange([...value,r.value.id]);setQuery('');}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusyChange?.(false);}};
  return <fieldset className="tag-selection"><legend>标签 <small>可多选 · 已选 {value.length}</small></legend><div className="row"><Input aria-label="查找或新建标签" value={query} maxLength={60} placeholder="查找或输入新标签" onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!visible.length)void create();}}}/>{query.trim()&&!choices.some(t=>t.name===query.trim())&&<button type="button" className="btn small" disabled={busy||value.length>=40} onClick={()=>void create()}>新增“{query.trim()}”</button>}</div><div className="tag-selection-options">{visible.map(t=><label key={t.id} className={`tag-choice ${value.includes(t.id)?'selected':''}`}><CheckField checked={value.includes(t.id)} disabled={!value.includes(t.id)&&value.length>=40} onCheckedChange={checked=>onChange(checked?[...value,t.id]:value.filter(id=>id!==t.id))}/><i style={{background:t.color}}/>{t.name}</label>)}</div>{error&&<p role="alert" className="error-banner">{error}</p>}</fieldset>;
}

export function CategoryField({kind,worldId,library,value,onChange,onChanged,onBusyChange}:{onBusyChange?:(busy:boolean)=>void;kind:CatalogKind;worldId:string;library:LibrarySnapshot;value:string|null;onChange:(id:string|null)=>void;onChanged:()=>Promise<void>}){
  const [adding,setAdding]=useState(false),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[extra,setExtra]=useState<{id:string;name:string;active:boolean}[]>([]);
  const config=libraryConfig(library,worldId),group=config.groups[kind],choices=[...group.categories,...extra.filter(c=>!group.categories.some(v=>v.id===c.id))];
  const create=async()=>{if(busy)return;setBusy(true);setError('');try{const c={id:crypto.randomUUID(),name:name.trim(),active:true},r=await window.studio!.saveLibraryConfig({...config,expectedVersion:config.version,groups:{...config.groups,[kind]:{...group,categories:[...group.categories,c]}}});if(!r.ok)throw Error(r.error.message);setExtra([...extra,c]);onChange(c.id);setName('');setAdding(false);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="editor-field"><div className="between"><span>{categoryLabels[kind]}</span><button type="button" className="text-link" onClick={()=>setAdding(!adding)}>{adding?'取消新增':'新增类别'}</button></div><SelectField aria-label={categoryLabels[kind]} value={value??''} onValueChange={v=>onChange(v||null)}><option value="">未分类</option>{choices.filter(c=>c.active||c.id===value).map(c=><option key={c.id} value={c.id}>{c.name}{!c.active?'（已停用）':''}</option>)}</SelectField>{adding&&<div className="row"><Input aria-label="新类别名称" autoFocus value={name} maxLength={200} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void create();}}}/><button type="button" className="btn small" disabled={busy||!name.trim()} onClick={()=>void create()}>添加类别</button></div>}{error&&<p role="alert" className="error-banner">{error}</p>}</div>;
}

export function InlineAttributes({worldId,templates,value,onChange}:{worldId:string;templates:AttributeTemplate[];value:CharacterAttributes;onChange:(v:CharacterAttributes)=>void}){
  const [creating,setCreating]=useState(false),[extra,setExtra]=useState<AttributeTemplate[]>([]);
  const choices=[...templates,...extra.filter(t=>!templates.some(v=>v.id===t.id))];
  return <><AttributeFields templates={choices} value={value} onChange={onChange}/><button type="button" className="btn small" onClick={()=>setCreating(true)}><Icon name="plus"/>新建数值模板</button>{creating&&<AttributeManager createOnly worldId={worldId} templates={choices} setting={undefined} characters={[]} onChanged={async()=>{}} onCreated={t=>{setExtra([...extra,t]);onChange({...value,templateId:t.id,versions:{...value.versions,[t.id]:t.version}});setCreating(false);}} onClose={()=>setCreating(false)}/>}</>;
}
