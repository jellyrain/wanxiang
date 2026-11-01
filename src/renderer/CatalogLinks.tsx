import React,{useEffect,useRef,useState} from 'react';
import type {CatalogKind,CatalogRecord,CatalogLinkInput,CatalogLinkTarget,LibrarySnapshot} from '../shared/types.ts';
import {catalogIcons,catalogNames,hasCatalogLink,holdingStates,practiceStates} from '../shared/catalogs.ts';
import {Input,SelectField,Textarea} from './Fields.tsx';
import {JourneyDialog} from './JourneyEditors.tsx';
import {Icon} from './Icon.tsx';

type Props={records:CatalogRecord[];target:CatalogLinkTarget;disabled?:boolean;onChanged:()=>Promise<void>;onOpen:(kind:CatalogKind,id:string)=>void};
export function CatalogLinks({records,target,disabled=false,onChanged,onOpen}:Props){
  const [editing,setEditing]=useState<{kind:CatalogKind;record?:CatalogRecord;target:CatalogLinkTarget;records:CatalogRecord[]}|null>(null);
  useEffect(()=>{if(!editing)return;const stop=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',stop);return()=>window.removeEventListener('beforeunload',stop);},[editing]);
  const rows=records.filter(r=>hasCatalogLink(r,target)),kinds:CatalogKind[]=target.kind==='mapLocation'?['place']:['item','technique','place'];
  const open=(kind:CatalogKind,record?:CatalogRecord)=>setEditing(structuredClone({kind,record,target,records}));
  return <div className="catalog-owner-links">
    <div className="row wrap catalog-link-actions">{kinds.map(kind=><button key={kind} className="btn small" disabled={disabled} onClick={()=>open(kind)}><Icon name={catalogIcons[kind]}/>关联{catalogNames[kind]}</button>)}</div>
    <div className="catalog-character-links">{rows.map(r=>{
      const holding=target.kind==='character'&&r.kind==='item'?r.holders.find(h=>h.characterId===target.id):undefined;
      const practice=target.kind==='character'&&r.kind==='technique'?r.practitioners.find(p=>p.characterId===target.id):undefined;
      const detail=holding&&r.kind==='item'?`数量 ${holding.quantity} · ${holdingStates[holding.state]}`:practice?`${practiceStates[practice.state]} · ${practice.progress||'进度未填写'}`:catalogNames[r.kind];
      return <div key={r.kind+':'+r.id} className="panel catalog-linked-record"><button className="catalog-linked-open" onClick={()=>onOpen(r.kind,r.id)}><Icon name={catalogIcons[r.kind]}/><span><strong>{r.name}{r.archived?'（已归档）':''}</strong><small>{detail}</small>{(holding?.notes||practice?.notes)&&<small>{holding?.notes||practice?.notes}</small>}</span></button><button className="text-link" disabled={disabled||r.archived} title={r.archived?'请先恢复资料，再编辑关联':undefined} onClick={()=>open(r.kind,r)}>编辑关联</button></div>;
    })}{!rows.length&&<p className="muted">尚无关联资料。</p>}</div>
    {editing&&<CatalogLinkEditor {...editing} onClose={()=>setEditing(null)} onSaved={async()=>{await onChanged();setEditing(null);}}/>}
  </div>;
}

export function CharacterCatalogLinks({library,characterId,onChanged,onOpen}:{library:LibrarySnapshot;characterId:string;onChanged:()=>Promise<void>;onOpen:Props['onOpen']}){
  const character=library.characters.find(c=>c.id===characterId)!;
  return <CatalogLinks records={[...library.items,...library.techniques,...library.places].filter(r=>r.worldId===character.worldId)} target={{kind:'character',id:character.id,expectedVersion:character.version}} disabled={character.archived} onChanged={onChanged} onOpen={onOpen}/>;
}

function CatalogLinkEditor({kind,record,records,target,onClose,onSaved}:{kind:CatalogKind;record?:CatalogRecord;records:CatalogRecord[];target:CatalogLinkTarget;onClose:()=>void;onSaved:()=>Promise<void>}){
  const holding=target.kind==='character'&&record?.kind==='item'?record.holders.find(h=>h.characterId===target.id):undefined;
  const practice=target.kind==='character'&&record?.kind==='technique'?record.practitioners.find(p=>p.characterId===target.id):undefined;
  const [draft,setDraft]=useState({catalogId:record?.id??'',linked:true,quantity:holding?.quantity??1,holdingState:holding?.state??'stored',progress:practice?.progress??'',practiceState:practice?.state??'learning',notes:holding?.notes??practice?.notes??''});
  const initial=useRef(JSON.stringify(draft)),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const choices=records.filter(r=>r.kind===kind&&!r.archived&&(!hasCatalogLink(r,target)||r.id===record?.id));
  const save=async(event:React.SyntheticEvent,linked=true)=>{event.preventDefault();event.stopPropagation();const selected=choices.find(r=>r.id===draft.catalogId);if(!selected){setError(`请选择${catalogNames[kind]}。`);return;}
    const input:CatalogLinkInput={target,kind,catalogId:selected.id,expectedVersion:selected.version,linked};
    if(target.kind==='character'&&kind==='item')input.holding={quantity:draft.quantity,state:draft.holdingState,notes:draft.notes};
    if(target.kind==='character'&&kind==='technique')input.practice={progress:draft.progress,state:draft.practiceState,notes:draft.notes};
    setBusy(true);setError('');try{const result=await window.studio!.saveCatalogLink(input);if(!result.ok)throw Error(result.error.message);await onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <JourneyDialog title={`${record?'编辑':'添加'}${catalogNames[kind]}关联`} description={target.kind==='character'?'选择此角色使用的资料，记录当前状态。':target.kind==='mapLocation'?'为这个地图标记选择地点库资料。':'选择此世界条目关联的资料。'} scopeLabel="资料关联" savedHint="保存当前来源与资料的关联" submitLabel="保存关联" dirty={initial.current!==JSON.stringify(draft)} busy={busy} error={error} onClose={onClose} onSubmit={e=>void save(e)}>
    {record?<p><strong>{record.name}</strong></p>:<><label className="editor-field"><span>搜索{catalogNames[kind]}</span><Input aria-label="搜索关联资料" autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="名称、别名或摘要"/></label><div className="association-choices" role="group" aria-label={`选择关联${catalogNames[kind]}`}>{choices.filter(r=>r.id===draft.catalogId||[r.name,r.aliases,r.summary].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(r=><button type="button" className={draft.catalogId===r.id?'selected':''} key={r.id} aria-pressed={draft.catalogId===r.id} onClick={()=>setDraft({...draft,catalogId:r.id})}><strong>{r.name}</strong><small>{r.summary||r.aliases}</small>{draft.catalogId===r.id&&<Icon name="check"/>}</button>)}</div></>}
    {!choices.length&&<p className="attribute-hint">没有可添加的{catalogNames[kind]}，请先在对应资料库创建资料。</p>}

    {draft.linked&&target.kind==='character'&&kind!=='place'&&<>
      <div className="editor-two">{kind==='item'?<label className="editor-field"><span>数量</span><Input aria-label="持有数量" type="number" required min={0} max={1000000000} step={1} value={draft.quantity} onChange={e=>setDraft({...draft,quantity:Number(e.target.value)})}/></label>:<label className="editor-field"><span>进度 / 层级</span><Input aria-label="修习进度" value={draft.progress} maxLength={1000} onChange={e=>setDraft({...draft,progress:e.target.value})}/></label>}
      <label className="editor-field"><span>状态</span><SelectField aria-label="关联状态" value={kind==='item'?draft.holdingState:draft.practiceState} onValueChange={value=>setDraft({...draft,...(kind==='item'?{holdingState:value as typeof draft.holdingState}:{practiceState:value as typeof draft.practiceState})})}>{Object.entries(kind==='item'?holdingStates:practiceStates).map(([value,label])=><option key={value} value={value}>{label}</option>)}</SelectField></label></div>
      <label className="editor-field"><span>备注</span><Textarea aria-label="关联备注" rows={3} value={draft.notes} maxLength={10000} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
    </>}
    {record&&<button type="button" className="btn danger" onClick={e=>void save(e,false)}>解除关联</button>}
  </JourneyDialog>;
}
