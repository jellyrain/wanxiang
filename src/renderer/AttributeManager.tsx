import { Input, CheckField } from './Fields.tsx';
import React, { useEffect, useRef, useState } from 'react';
import { Dialog, AlertDialog } from 'radix-ui';
import type { AttributeTemplate, AttributeDefault, AttributeDimension, Character, CatalogRecord } from '../shared/types.ts';
import { Icon } from './Icon.tsx';

type DraftDimension=Omit<AttributeDimension,'min'|'max'> & {min:string;max:string};
type Draft={id?:string;name:string;expectedVersion:number;dimensions:DraftDimension[];makeDefault:boolean;expectedDefaultVersion:number};
const dimension=(name=''):DraftDimension=>({id:crypto.randomUUID(),name,min:'0',max:'100',unit:'',enabled:true});

export function AttributeManager({worldId,templates,setting,characters,catalogs=[],onChanged,onClose,createOnly=false,onCreated}:{createOnly?:boolean;onCreated?:(t:AttributeTemplate)=>void;worldId:string;templates:AttributeTemplate[];setting:AttributeDefault|undefined;characters:Character[];catalogs?:CatalogRecord[];onChanged:()=>Promise<void>;onClose:()=>void}) {
  const [draft,setDraft]=useState<Draft|null>(null), initial=useRef('');
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [discard,setDiscard]=useState(false), [closeAfterDiscard,setCloseAfterDiscard]=useState(false);
  const dirty=Boolean(draft && JSON.stringify(draft)!==initial.current);
  const open=(template?:AttributeTemplate,copy=false)=>{
    const next:Draft={id:copy ? undefined : template?.id,name:template ? template.name+(copy ? ' · 副本' : '') : '',expectedVersion:copy ? 0 : template?.version ?? 0,
      dimensions:template ? template.dimensions.map(d=>({...d,id:copy ? crypto.randomUUID() : d.id,min:String(d.min),max:String(d.max)})) : [dimension()],
      makeDefault:Boolean(template && !copy && setting?.templateId===template.id),expectedDefaultVersion:setting?.version ?? 0};
    setDraft(next);initial.current=JSON.stringify(next);setError('');setNotice('');
  };
  useEffect(()=>{if(createOnly)open();},[]);
  const close=(entire=true)=>{
    if(busy) return;
    if(dirty){setCloseAfterDiscard(entire);setDiscard(true);return;}
    if(entire) onClose(); else {setDraft(null);setError('');}
  };
  const update=(id:string,change:Partial<DraftDimension>)=>setDraft(current=>current ? {...current,dimensions:current.dimensions.map(d=>d.id===id ? {...d,...change} : d)} : current);
  const reorder=(index:number,offset:number)=>setDraft(current=>{
    if(!current || index+offset<0 || index+offset>=current.dimensions.length) return current;
    const dims=[...current.dimensions];[dims[index],dims[index+offset]]=[dims[index+offset],dims[index]];return {...current,dimensions:dims};
  });
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();event.stopPropagation();if(!draft) return;setError('');
    if(draft.dimensions.some(d=>d.min.trim()==='' || d.max.trim()==='')) {setError('请填写每个维度的最小值和最大值。');return;}
    setBusy(true);
    try{
      const result=await window.studio!.saveAttributeTemplate({...draft,worldId,dimensions:draft.dimensions.map(d=>({...d,min:Number(d.min),max:Number(d.max)}))});
      if(!result.ok) throw new Error(result.error.message);
      await onChanged();onCreated?.(result.value);setDraft(null);setNotice('模板已保存，已有资料数值保留。');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const used=(id:string)=>characters.filter(c=>c.attributes.templateId===id || Object.hasOwn(c.attributes.values,id) || c.forms.some(f=>f.attributeMode==='custom'&&(f.attributes.templateId===id||Object.hasOwn(f.attributes.values,id)))).length+catalogs.filter(c=>c.attributes.templateId===id||Object.hasOwn(c.attributes.values,id)).length;
  const existingIds=new Set(templates.find(t=>t.id===draft?.id)?.dimensions.map(d=>d.id));
  return <><Dialog.Root open onOpenChange={open=>{if(!open)close();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/>
    <Dialog.Content className="editor-dialog attribute-manager" onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{e.preventDefault();close();}}>
      <div className="editor-heading"><div><Dialog.Title>{draft ? '配置属性模板' : '让维度适合你的故事'}</Dialog.Title><Dialog.Description>{draft ? '名称、数量、顺序、范围与单位，都由你定义。' : '先建立模板，再为资料填写数值。模板由同一世界的作品共享。'}</Dialog.Description></div><button className="icon-button" aria-label="关闭属性模板" disabled={busy} onClick={()=>close()}><Icon name="close"/></button></div>
      {draft ? <form id="attribute-template-form" className="attribute-template-form" onSubmit={save} inert={busy}>
        <div className="template-top"><label className="editor-field"><span>模板名称</span><Input value={draft.name} maxLength={60} required placeholder="例如：修行资质、都市能力、人物性格" onChange={e=>setDraft({...draft,name:e.target.value})}/></label></div>
        <div className="between template-section-title"><div><h3>属性维度 <span className="tag gold">{draft.dimensions.filter(d=>d.enabled).length} 维</span></h3><p>三至十维显示雷达图，其余数量使用属性条。</p></div><button className="btn small" type="button" disabled={draft.dimensions.length>=60} onClick={()=>setDraft({...draft,dimensions:[...draft.dimensions,dimension()]})}><Icon name="plus"/>添加维度</button></div>
        {!draft.id && draft.dimensions.length===1 && !draft.dimensions[0].name && <button className="text-link template-example" type="button" onClick={()=>setDraft({...draft,name:draft.name || '通用属性 · 示例',dimensions:['力量','敏捷','洞察','意志'].map(name=>dimension(name))})}>从四维示例开始</button>}
        <div className="template-dimensions">{draft.dimensions.map((d,i)=><div key={d.id} className={`template-dimension ${d.enabled ? '' : 'disabled-dimension'}`}><span className="dimension-number">{String(i+1).padStart(2,'0')}</span>
          <label className="editor-field"><span>维度名称</span><Input aria-label={`维度 ${i+1} 名称`} required maxLength={40} value={d.name} onChange={e=>update(d.id,{name:e.target.value})}/></label>
          <label className="editor-field"><span>最小值</span><Input aria-label={`维度 ${i+1} 最小值`} type="number" step="any" required value={d.min} onChange={e=>update(d.id,{min:e.target.value})}/></label>
          <label className="editor-field"><span>最大值</span><Input aria-label={`维度 ${i+1} 最大值`} type="number" step="any" required value={d.max} onChange={e=>update(d.id,{max:e.target.value})}/></label>
          <label className="editor-field"><span>单位（选填）</span><Input aria-label={`维度 ${i+1} 单位`} maxLength={15} value={d.unit} onChange={e=>update(d.id,{unit:e.target.value})}/></label>
          <div className="dimension-actions"><button type="button" className="icon-button" aria-label={`上移维度 ${i+1}`} disabled={i===0} onClick={()=>reorder(i,-1)}>↑</button><button type="button" className="icon-button" aria-label={`下移维度 ${i+1}`} disabled={i===draft.dimensions.length-1} onClick={()=>reorder(i,1)}>↓</button><button type="button" className="btn small" onClick={()=>update(d.id,{enabled:!d.enabled})} aria-label={`${d.enabled ? '停用' : '恢复'}维度 ${d.name || i+1}`}>{d.enabled ? '停用' : '恢复'}</button>{!existingIds.has(d.id) && <button type="button" className="icon-button" aria-label={`移除新维度 ${i+1}`} onClick={()=>setDraft({...draft,dimensions:draft.dimensions.filter(item=>item.id!==d.id)})}><Icon name="close"/></button>}</div>
        </div>)}</div>
        <div className="note-box">改名、调整顺序或停用维度都会保留原值；缩小范围时标记超界，不自动改写数值。已保存的维度可停用、恢复。</div>
      </form> : <div className="attribute-template-list" inert={busy}>
        <div className="between template-list-actions"><span className="muted">{templates.length} 套模板</span><button className="btn primary small" onClick={()=>open()}><Icon name="plus"/>新建属性模板</button></div>
        {templates.length ? <div className="template-cards">{templates.map(t=><article className="template-card" key={t.id}><div className="between"><h3>{t.name}</h3><span className={`tag ${setting?.templateId===t.id ? 'gold' : ''}`}>{setting?.templateId===t.id ? '默认模板' : `${t.dimensions.filter(d=>d.enabled).length} 维`}</span></div><p>{t.dimensions.filter(d=>d.enabled).map(d=>d.name).join(' · ')}</p><small>{t.dimensions.filter(d=>d.enabled).length} 个启用维度 · {used(t.id)} 份资料使用</small><div className="template-card-actions"><button className="btn small" onClick={()=>open(t)}>编辑维度</button><button className="btn small" onClick={()=>open(t,true)}>复制模板</button></div></article>)}</div>
          : <div className="attribute-empty"><Icon name="radar"/><h3>从你的第一套属性开始</h3><p>为维度设置范围与单位。</p></div>}
        <p className="attribute-hint">默认模板在“资料配置”中按人物、物品、功法、地点分别设置。</p>
      </div>}
      {error && <div className="editor-error" role="alert">{error}</div>}{notice && <div className="tag-notice" role="status">{notice}</div>}
      <div className="editor-footer"><small>{busy ? '正在保存…' : dirty ? '有尚未保存的修改' : draft ? '模板与资料数值分别保存' : '保存在当前世界的资料库'}</small>{draft ? <>{!createOnly&&<button className="btn" disabled={busy} onClick={()=>close(false)}>返回模板库</button>}<button className="btn primary" type="submit" form="attribute-template-form" disabled={busy}>保存模板</button></> : <button className="btn" disabled={busy} onClick={()=>close()}>完成</button>}</div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <AlertDialog.Root open={discard} onOpenChange={setDiscard}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay nested-overlay"/><AlertDialog.Content className="confirm-dialog nested-dialog"><AlertDialog.Title>模板修改尚未保存</AlertDialog.Title><AlertDialog.Description>继续编辑，或放弃这次尚未保存的修改。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn primary">继续编辑</AlertDialog.Cancel><AlertDialog.Action className="btn" onClick={()=>{if(closeAfterDiscard)onClose();else{setDraft(null);setError('');}}}>放弃修改</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </>;
}
