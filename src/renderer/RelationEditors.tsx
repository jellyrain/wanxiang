import { CheckField, Input, SelectField, Textarea } from './Fields.tsx';
import React, { useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { Character, CharacterRelation, RelationType, RelationInput, RelationTypeInput } from '../shared/types.ts';
import { JourneyDialog } from './JourneyEditors.tsx';
import { Icon } from './Icon.tsx';

export function RelationEditor({worldId,characters,types,relation,sourceId,targetId,onClose,onSaved}:{worldId:string;characters:Character[];types:RelationType[];relation:CharacterRelation|null;sourceId?:string;targetId?:string;onClose:()=>void;onSaved:(id:string)=>Promise<void>}) {
  const [draft,setDraft]=useState<RelationInput>(()=>{
    const type=types.find(t=>t.id===relation?.typeId)??types.find(t=>t.active);
    return {id:relation?.id,worldId,sourceId:relation?.sourceId??sourceId??'',targetId:relation?.targetId??targetId??'',sourceStageId:relation?.sourceStageId??null,targetStageId:relation?.targetStageId??null,typeId:type?.id??'',expectedTypeVersion:type?.version??0,label:relation?.label??'',description:relation?.description??'',direction:relation?.direction??'mutual',status:relation?.status??'pending',expectedVersion:relation?.version??0};
  });
  const initial=useRef(JSON.stringify(draft)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=(value:Partial<RelationInput>)=>setDraft(d=>({...d,...value}));
  const source=characters.find(c=>c.id===draft.sourceId),target=characters.find(c=>c.id===draft.targetId);
  const endpoint=(side:'source'|'target')=>{
    const id=side==='source'?draft.sourceId:draft.targetId,stageId=side==='source'?draft.sourceStageId:draft.targetStageId,c=characters.find(c=>c.id===id);
    return <div className="relation-endpoint"><h3>{side==='source'?'起点人物':'终点人物'}</h3><label className="editor-field"><span>{side==='source'?'起点':'终点'}</span><SelectField required value={id} onValueChange={nextValue=>update(side==='source'?{sourceId:nextValue,sourceStageId:null}:{targetId:nextValue,targetStageId:null})}><option value="">选择人物</option>{characters.filter(c=>!c.archived||c.id===id).map(c=><option key={c.id} value={c.id}>{c.name}{c.archived?'（已归档）':''}</option>)}</SelectField></label>
      <label className="editor-field"><span>{side==='source'?'起点':'终点'}人物阶段</span><SelectField value={stageId??''} disabled={!c} onValueChange={nextValue=>update(side==='source'?{sourceStageId:nextValue||null}:{targetStageId:nextValue||null})}><option value="">通用关系 · 不限定阶段</option>{c?.stages.filter(s=>!s.archived||s.id===stageId).map(s=><option key={s.id} value={s.id}>{s.name}{s.archived?'（已归档）':''}</option>)}</SelectField></label></div>;
  };
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const r=await window.studio!.saveRelation(draft);if(!r.ok)throw new Error(r.error.message);await onSaved(r.value.id);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <JourneyDialog scopeLabel="关系档案" savedHint="保存在当前世界的人物关系中" title={relation?'编辑人物关系':'建立人物关系'} description="人物保持独立，关系可以关联双方各自的阶段。" dirty={initial.current!==JSON.stringify(draft)} busy={busy} error={error} onClose={onClose} onSubmit={save}>
    <div className="editor-two">{endpoint('source')}{endpoint('target')}</div>
    <div className="editor-two"><label className="editor-field"><span>关系类型</span><SelectField required value={draft.typeId} onValueChange={nextValue=>update({typeId:nextValue,expectedTypeVersion:types.find(t=>t.id===nextValue)!.version})}>{types.filter(t=>t.active||t.id===draft.typeId).map(t=><option key={t.id} value={t.id}>{t.name}{t.active?'':'（已停用）'}</option>)}</SelectField></label><label className="editor-field"><span>关系方向</span><SelectField value={draft.direction} onValueChange={nextValue=>update({direction:nextValue as RelationInput['direction']})}><option value="mutual">双向 · 双方共同的关系</option><option value="forward">单向 · 起点指向终点</option></SelectField></label></div>
    <div className="relation-direction-preview">{source?.name??'起点人物'} <span>{draft.direction==='mutual'?'↔':'→'}</span> {target?.name??'终点人物'}</div>
    <label className="editor-field"><span>关系名称（选填）</span><Input maxLength={100} value={draft.label} placeholder="留空时显示关系类型名称" onChange={e=>update({label:e.target.value})}/></label>
    <label className="editor-field"><span>关系说明 / 发展与分歧</span><Textarea rows={5} maxLength={30000} value={draft.description} onChange={e=>update({description:e.target.value})}/></label>
    <label className="editor-field"><span>设定状态</span><SelectField value={draft.status} onValueChange={nextValue=>update({status:nextValue as RelationInput['status']})}><option value="pending">待定 · 仍在讨论</option><option value="confirmed">已确认</option></SelectField></label>
    <p className="attribute-hint">未限定阶段的关系会在各阶段显示。</p>
  </JourneyDialog>;
}

function TypeEditor({worldId,type,onClose,onSaved}:{worldId:string;type:RelationType|null;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [draft,setDraft]=useState<RelationTypeInput>(()=>({id:type?.id,worldId,expectedVersion:type?.version??0,name:type?.name??'',color:type?.color??'#bda374',active:type?.active??true}));
  const initial=useRef(JSON.stringify(draft)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const r=await window.studio!.saveRelationType(draft);if(!r.ok)throw new Error(r.error.message);await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <JourneyDialog scopeLabel="关系类型库" savedHint="保存在当前世界的关系类型库中" title={type?'编辑关系类型':'新建关系类型'} description="同一世界共享类型。名称和颜色更新后，图谱同步显示。" dirty={initial.current!==JSON.stringify(draft)} busy={busy} error={error} onClose={onClose} onSubmit={save}>
    <label className="editor-field"><span>类型名称</span><Input required maxLength={60} value={draft.name} placeholder="例如：师徒、亲属、同盟、宿敌" onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label className="editor-field"><span>连线颜色</span><Input className="relation-color-input" type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label>
    <label className="journey-check"><CheckField  checked={draft.active} onCheckedChange={nextChecked=>setDraft({...draft,active:nextChecked})}/>允许新关系使用此类型</label>
    <p className="attribute-hint">停用后已有关系仍保留，可以随时恢复类型。</p>
  </JourneyDialog>;
}
export function RelationTypeManager({worldId,types,relations,onChanged,onClose}:{worldId:string;types:RelationType[];relations:CharacterRelation[];onChanged:()=>Promise<void>;onClose:()=>void}) {
  const [editing,setEditing]=useState<RelationType|null|undefined>(undefined);
  if(editing!==undefined)return <TypeEditor worldId={worldId} type={editing} onClose={()=>setEditing(undefined)} onSaved={onChanged}/>;
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="editor-dialog relation-type-dialog"><div className="editor-heading"><div><Dialog.Title>定义人物之间的联系</Dialog.Title><Dialog.Description>配置当前世界的关系类型与颜色。</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭关系类型配置"><Icon name="close"/></Dialog.Close></div>
    <div className="journey-editor-body"><div className="between journey-section-head"><h3>{types.length} 种类型</h3><button className="btn primary small" onClick={()=>setEditing(null)}><Icon name="plus"/>新建关系类型</button></div><div className="relation-type-list">{types.map(t=><button className="relation-type-row" key={t.id} onClick={()=>setEditing(t)}><i style={{background:t.color}}/><strong>{t.name}</strong><small>{relations.filter(r=>r.typeId===t.id).length} 条关系{t.active?'':' · 已停用'}</small><Icon name="pen"/></button>)}</div>{!types.length&&<div className="journey-empty"><h3>先创建关系类型</h3><p>先添加一种关系类型。</p></div>}</div>
    <div className="editor-footer"><small>停用类型会保留已有关系</small><Dialog.Close className="btn">完成</Dialog.Close></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
