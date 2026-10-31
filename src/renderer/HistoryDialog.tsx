import React,{useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import type {HistoryDetail,HistoryKind,HistoryPage,HistoryPreview,LibrarySnapshot,Result} from '../shared/types.ts';
import {HISTORY_FIELDS,HISTORY_KINDS,historyEntities} from '../shared/history.ts';
import {Input,SelectField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {assetUrl} from './runtime.ts';

function unwrap<T>(result:Result<T>):T{if(!result.ok)throw Error(result.error.message);return result.value;}
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const enumLabels:Record<string,Record<string,string>>={visibility:{public:'公开',secret:'秘密'},portraitMode:{inherit:'共用基础图片',custom:'独立图片',none:'不展示图片'},attributeMode:{inherit:'共用基础属性',custom:'独立属性'},direction:{forward:'单向',mutual:'双向'},phase:{worldbuilding:'世界观构建',outlining:'大纲规划',writing:'正文创作',revising:'修订',completed:'已完成'},status:{draft:'草稿',pending:'待定',adopted:'已采用',confirmed:'已确认',planned:'规划中',revising:'修订中',finished:'已完成'}};
Object.assign(HISTORY_FIELDS,{attributeSchemas:'阶段属性模板',dimensions:'属性维度',min:'最小值',max:'最大值',unit:'单位',enabled:'启用'});
function readable(value:unknown,names:Map<string,string>,depth=0,field=''):string {
  if(value===null||value===undefined||value==='')return '（空）';
  if(typeof value==='boolean')return value?'是':'否';
  if(typeof value==='string')return enumLabels[field]?.[value]??names.get(value)??value;
  if(Array.isArray(value))return value.length?value.map((v,index)=>`${index+1}. ${readable(v,names,depth+1)}`).join('\n\n'):'（无）';
  if(typeof value==='object')return Object.entries(value).map(([key,v])=>`${'  '.repeat(Math.min(depth,4))}${HISTORY_FIELDS[key]??names.get(key)??key}：${readable(v,names,depth+1,key)}`).join('\n');
  return String(value);
}
function DiffValue({field,value,names}:{field:string;value:unknown;names:Map<string,string>}){
  return <>{['portraitId','imageId','backgroundId','coverId'].includes(field)&&typeof value==='string'&&<img className="history-image" src={assetUrl(value)} alt="版本中的图片"/>}<pre>{readable(value,names,0,field)}</pre></>;
}
export function HistoryDialog({library,onClose,onChanged}:{library:LibrarySnapshot;onClose:()=>void;onChanged:()=>Promise<void>}){
  const [kind,setKind]=useState<HistoryKind>('character'),[entityId,setEntityId]=useState(''),[query,setQuery]=useState('');
  const [page,setPage]=useState<HistoryPage|null>(null),[detail,setDetail]=useState<HistoryDetail|null>(null),[preview,setPreview]=useState<HistoryPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const request=useRef(0),entities=historyEntities(library,kind),selected=entities.find(e=>e.id===entityId);
  const names=new Map<string,string>();
  for(const type of Object.keys(HISTORY_KINDS) as HistoryKind[])for(const e of historyEntities(library,type))names.set(e.id,e.name);
  for(const tag of library.tags)names.set(tag.id,tag.name);
  for(const c of library.characters){for(const item of [...c.identities,...c.forms,...c.stages])names.set(item.id,item.name);}
  for(const template of library.attributeTemplates){names.set(template.id,template.name);for(const d of template.dimensions)names.set(d.id,d.name);}
  for(const map of library.maps)for(const item of [...map.locations,...map.stages])names.set(item.id,item.name);
  for(const outline of library.outlines)for(const volume of outline.volumes)names.set(volume.id,volume.name);
  for(const catalog of library.mediaCatalogs)for(const label of [...catalog.tags,...catalog.categories])names.set(label.id,label.name);
  names.set('base','基础形态');
  useEffect(()=>{if(!entities.some(e=>e.id===entityId))setEntityId(entities[0]?.id??'');},[library,kind,entityId]);
  useEffect(()=>{
    const serial=++request.current;setPage(null);setDetail(null);setPreview(null);setError('');setNotice('');
    if(!entityId){setBusy(false);return;}
    setBusy(true);
    void (async()=>{try{
      const next=unwrap(await window.studio!.listHistory({kind,entityId}));
      const record=next.records.find(r=>r.version!==next.currentVersion)??next.records[0];
      const nextDetail=record?unwrap(await window.studio!.getHistory({kind,entityId,version:record.version})):null;
      if(serial===request.current){setPage(next);setDetail(nextDetail);}
    }catch(e){if(serial===request.current)setError((e as Error).message);}finally{if(serial===request.current)setBusy(false);}})();
    return()=>{request.current++;};
  },[kind,entityId]);
  const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);setPreview(null);}finally{setBusy(false);}};
  const choose=(version:number)=>perform(async()=>{setPreview(null);setDetail(unwrap(await window.studio!.getHistory({kind,entityId,version})));});
  const refresh=()=>perform(async()=>{setPreview(null);await onChanged();const next=unwrap(await window.studio!.listHistory({kind,entityId}));setPage(next);const version=detail?.selection.version??next.records[0]?.version;setDetail(version?unwrap(await window.studio!.getHistory({kind,entityId,version})):null);});
  const restore=()=>perform(async()=>{
    if(!preview)return;
    const result=unwrap(await window.studio!.restoreHistory({token:preview.token}));setPreview(null);
    await onChanged();setPage(unwrap(await window.studio!.listHistory({kind,entityId})));
    setDetail(unwrap(await window.studio!.getHistory({kind,entityId,version:result.version})));
    setNotice(`已生成版本 ${result.version}，原有历史全部保留。`);
  });
  const differences=preview?.differences??detail?.differences??[];
  const filtered=entities.filter(e=>`${e.name} ${e.scope}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())||e.id===entityId);
  return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="history-dialog" onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
    <header className="history-heading"><div><Dialog.Title>修改历史与回退</Dialog.Title><Dialog.Description>选择历史版本，预览后回退。</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭修改历史" disabled={busy}><Icon name="close"/></Dialog.Close></header>
    <div className="history-filters"><label><span>资料类型</span><SelectField aria-label="历史资料类型" value={kind} onValueChange={v=>{setKind(v as HistoryKind);setEntityId('');setQuery('');}} disabled={busy||Boolean(preview)}>{Object.entries(HISTORY_KINDS).map(([id,name])=><option key={id} value={id}>{name}</option>)}</SelectField></label><label><span>查找资料</span><Input aria-label="查找历史资料" placeholder="名称或所属作品、世界" value={query} onChange={e=>setQuery(e.target.value)} disabled={busy||Boolean(preview)}/></label><label className="history-entity"><span>选择资料 · {entities.length} 项</span><SelectField aria-label="历史资料" value={entityId} onValueChange={setEntityId} disabled={busy||Boolean(preview)||!entities.length}><option value="">暂无资料</option>{filtered.map(e=><option value={e.id} key={e.id}>{e.name} · {e.scope}</option>)}</SelectField></label><button className="btn" onClick={()=>void refresh()} disabled={busy||!entityId||Boolean(preview)}><Icon name="redo"/>刷新</button></div>
    {error&&<div className="history-message error-banner" role="alert">{error}</div>}{notice&&<div className="history-message history-success" role="status">{notice}</div>}
    <div className="history-body"><aside className="history-versions"><div className="history-list-title">保存版本 <span>{page?`当前 v${page.currentVersion}`:''}</span></div>{page?.records.map(record=><button disabled={busy||Boolean(preview)} aria-pressed={detail?.selection.version===record.version} className={`history-version ${detail?.selection.version===record.version?'active':''}`} key={record.version} onClick={()=>void choose(record.version)}><strong>版本 {record.version}{record.version===page.currentVersion&&<span>当前</span>}</strong><time>{time(record.createdAt)}</time><small>{record.action}</small></button>)}{page?.hasMore&&<button className="btn small" disabled={busy||Boolean(preview)} onClick={()=>void perform(async()=>{const next=unwrap(await window.studio!.listHistory({kind,entityId,beforeVersion:page.records.at(-1)!.version}));setPage({...next,records:[...page.records,...next.records]});})}>加载更早版本</button>}{!page?.records.length&&<p className="history-empty">{busy?'正在读取…':'还没有保存过的历史版本。资料保存后会出现在这里。'}</p>}</aside>
      <div className="history-comparison"><div className="history-comparison-title"><div><strong>{selected?.name??'选择一份资料'}</strong><p>{preview?`回退预览 · 以版本 ${preview.selection.version} 为依据` :detail?`当前 v${detail.currentVersion} 与历史 v${detail.selection.version} 对比`:'人物、世界与作品资料的保存记录'}</p></div>{detail&&<span className="tag">{differences.length} 项内容差异</span>}</div>
        {preview&&<div className="history-preview-note"><strong>请核对下面的实际变化</strong>{preview.notes.map(note=><p key={note}>{note}</p>)}{preview.affected.length>0&&<details><summary>另有 {preview.affected.length} 份关联资料会更新版本</summary><ul>{preview.affected.map(e=><li key={`${e.kind}:${e.entityId}`}>{HISTORY_KINDS[e.kind]} · {e.name}</li>)}</ul></details>}</div>}
        {differences.length>0?<><div className="history-column-head"><span>当前内容</span><span>{preview?'回退后的内容':'所选历史内容'}</span></div>{differences.map(diff=><section className="history-difference" key={diff.field}><h3>{HISTORY_FIELDS[diff.field]??diff.field}</h3><div><article><DiffValue field={diff.field} value={diff.before} names={names}/></article><article><DiffValue field={diff.field} value={diff.after} names={names}/></article></div></section>)}</>:<div className="history-empty"><Icon name="history"/><p>{busy?'正在读取版本…':detail?'可恢复内容与当前版本相同。':'选择左侧版本，查看内容差异。'}</p></div>}
      </div></div>
    <footer className="history-footer"><small>{preview?'预览有效期 10 分钟；资料有新修改时需重新预览。':'标签库、属性模板、图谱布局暂未独立记录历史。这里不会恢复整个资料库。'}</small><div>{preview?<><button className="btn" disabled={busy} onClick={()=>setPreview(null)}>取消回退</button><button className="btn primary" disabled={busy} onClick={()=>void restore()}>{busy?'正在处理…':'确认回退，生成新版本'}</button></>:<button className="btn primary" disabled={busy||!detail||detail.selection.version===detail.currentVersion} onClick={()=>void perform(async()=>{setPreview(unwrap(await window.studio!.previewHistoryRestore(detail!.selection)));})}>{busy?'正在读取…':'预览回退到此版本'}</button>}</div></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
