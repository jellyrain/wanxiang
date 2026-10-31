import {DeletionDialog} from './DeletionDialog.tsx';
import {Markdown} from './Markdown.tsx';
import React, { useEffect, useRef, useState } from 'react';
import { AlertDialog, Tabs } from 'radix-ui';
import type { LibrarySnapshot, Work, World, NewWorkInput, Result } from '../shared/types.ts';
import { blankDashboard, workPhases } from '../shared/overview.ts';
import { Input, Textarea, SelectField } from './Fields.tsx';
import { JourneyDialog } from './JourneyEditors.tsx';
import { OverviewEditor } from './OverviewEditor.tsx';
import { MediaImage } from './AssetPicker.tsx';
import { Icon } from './Icon.tsx';

function unwrap<T>(r:Result<T>):T {if(!r.ok)throw Error(r.error.message);return r.value;}
type Editor={kind:'new';worldId?:string}|{kind:'name';work:Work}|{kind:'world';world:World|null}|{kind:'overview'};
type Props={work?:Work;library:LibrarySnapshot;onChanged:()=>Promise<void>;onOpenWork:(id:string)=>Promise<void>;onDirtyChange:(dirty:boolean)=>void};

export function WorkSettings({work,library,onChanged,onOpenWork,onDirtyChange}:Props) {
  const [deleteTarget,setDeleteTarget]=useState<Work|null>(null);
  const [editor,setEditor]=useState<Editor|null>(null),[archiveTarget,setArchiveTarget]=useState<Work|null>(null);
  const [tab,setTab]=useState('works'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const world=library.worlds.find(w=>w.id===work?.worldId)!,dashboard=library.dashboards.find(d=>d.workId===work?.id)??(work?blankDashboard(work):null);
  const active=library.works.filter(w=>!w.archived),archived=library.works.filter(w=>w.archived),peers=library.works.filter(w=>w.worldId===work?.worldId);
  const filter=(name:string)=>name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  useEffect(()=>{onDirtyChange(Boolean(editor)||Boolean(deleteTarget)||busy);return()=>onDirtyChange(false);},[editor,deleteTarget,busy,onDirtyChange]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
  const saved=async()=>{await onChanged();setNotice('作品信息已保存');};
  const archive=async(target:Work,next:boolean)=>{
    setBusy(true);setError('');try{unwrap(await window.studio!.archiveWork(target.id,target.version,next));setArchiveTarget(null);await onChanged();setNotice(next?'作品已归档，正文与资料完整保留':'作品已恢复，可以重新打开');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const open=async(id:string)=>{setBusy(true);setError('');try{await onOpenWork(id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const workCard=(item:Work)=>{
    const plan=library.dashboards.find(d=>d.workId===item.id),chapters=library.chapters.filter(c=>c.workId===item.id&&!c.archived);
    return <article className={`work-book-card ${item.id===work?.id?'current':''}`} key={item.id}>
      <div className="work-book-image">{plan?.coverId?<MediaImage id={plan.coverId} name={`${item.name}封面`} className={plan.coverFlip?'mirrored':''}/>:<div className="work-book-placeholder"><Icon name="book"/></div>}<span className="work-book-status">{item.archived?'已归档':item.id===work?.id?'当前作品':workPhases[plan?.phase??'worldbuilding']}</span></div>
      <div className="work-book-copy"><small title={item.worldName}>{item.worldName}</small><h3 title={item.name}>{item.name}</h3><p>{plan?.description||'尚未填写作品简介。'}</p><div className="work-book-meta"><span>{chapters.length} 章</span><span>{library.characters.filter(c=>c.worldId===item.worldId&&!c.archived).length} 位世界人物</span></div><div className="work-book-actions">{item.archived?<button className="btn small" disabled={busy} onClick={()=>void archive(item,false)}><Icon name="undo"/>恢复作品</button>:<><button className="text-link" disabled={busy} onClick={()=>void open(item.id)}>打开作品 <Icon name="arrow"/></button><button className="icon-button" disabled={busy} aria-label={`修改${item.name}名称`} title="修改名称" onClick={()=>setEditor({kind:'name',work:item})}><Icon name="pen"/></button><button className="icon-button" aria-label={`归档${item.name}`} title={active.length===1?'请保留至少一部使用中的作品':'归档作品，保留全部内容'} disabled={busy||active.length===1} onClick={()=>{setError('');setArchiveTarget(item);}}><Icon name="archive"/></button></>}<button className="text-link" disabled={busy} aria-label={`删除作品 ${item.name}`} onClick={()=>setDeleteTarget(item)}>删除</button></div></div>
    </article>;
  };
  return <section className="work-settings">
    <div className="page-head"><div><h1>作品设置</h1></div><button className="btn primary" disabled={busy} onClick={()=>setEditor({kind:'new'})}><Icon name="plus"/>新建作品</button></div>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    <div className="work-settings-scroll">
      {work&&world&&dashboard&&<div className="work-context-grid">
        <section className="work-context"><header><span><Icon name="book"/>当前作品</span><button className="text-link" onClick={()=>setEditor({kind:'name',work})}>修改名称 <Icon name="pen"/></button></header><h2>{work.name}</h2><div className="chip-row"><span className="tag gold">{workPhases[dashboard.phase]}</span>{dashboard.genre&&<span className="tag">{dashboard.genre}</span>}</div><Markdown>{dashboard.description||'未填写简介'}</Markdown><button className="btn small" onClick={()=>setEditor({kind:'overview'})}><Icon name="pen"/>编辑简介与计划</button></section>
        <section className="work-context"><header><span><Icon name="world"/>所属世界</span><button className="text-link" onClick={()=>setEditor({kind:'world',world})}>编辑世界 <Icon name="pen"/></button></header><h2>{world.name}</h2><Markdown>{world.description||'未填写简介'}</Markdown><div className="work-sharing"><strong>{peers.length} 部作品使用这个世界</strong><span>世界资料共用，章节与计划独立。</span></div></section>
      </div>}
      <Tabs.Root value={tab} onValueChange={setTab}>
        <div className="work-library-toolbar"><Tabs.List className="world-editor-tabs" aria-label="作品管理视图"><Tabs.Trigger value="works">我的作品 <small>{active.length}</small></Tabs.Trigger><Tabs.Trigger value="worlds">世界目录 <small>{library.worlds.length}</small></Tabs.Trigger><Tabs.Trigger value="archived">已归档 <small>{archived.length}</small></Tabs.Trigger></Tabs.List><Input aria-label="搜索作品与世界" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索作品或世界名称"/></div>
        <Tabs.Content value="works"><div className="work-book-grid">{active.filter(w=>filter(w.name+' '+w.worldName)).map(workCard)}</div>{!active.some(w=>filter(w.name+' '+w.worldName))&&<div className="work-empty"><Icon name="search"/><p>{query?'没有找到匹配的作品。':'书架是空的，点击“新建作品”开始。'}</p></div>}</Tabs.Content>
        <Tabs.Content value="archived"><div className="work-book-grid">{archived.filter(w=>filter(w.name+' '+w.worldName)).map(workCard)}</div>{!archived.some(w=>filter(w.name+' '+w.worldName))&&<div className="work-empty"><Icon name="archive"/><p>{query?'没有匹配的归档作品。':'还没有归档作品。'}</p></div>}</Tabs.Content>
        <Tabs.Content value="worlds"><div className="work-section-note"><span></span><button className="btn small" onClick={()=>setEditor({kind:'world',world:null})}><Icon name="plus"/>新建世界</button></div><div className="work-world-grid">{library.worlds.filter(w=>filter(w.name+' '+library.works.filter(b=>b.worldId===w.id).map(b=>b.name).join(' '))).map(w=>{
          const books=library.works.filter(b=>b.worldId===w.id);
          return <article className="work-world-card" key={w.id}><header><Icon name="world"/><span>{books.length} 部作品</span></header><h3>{w.name}</h3><p>{w.description||'世界简介尚未填写。'}</p><div className="work-world-books">{books.slice(0,4).map(b=><span key={b.id} className="tag" title={b.name}>{b.name}{b.archived?' · 已归档':''}</span>)}{books.length>4&&<small>另有 {books.length-4} 部</small>}{!books.length&&<small>可以先建立世界，再开始第一部作品。</small>}</div><footer><button className="text-link" onClick={()=>setEditor({kind:'world',world:w})}>编辑世界 <Icon name="pen"/></button><button className="text-link" onClick={()=>setEditor({kind:'new',worldId:w.id})}>在此新建作品 <Icon name="plus"/></button></footer></article>;
        })}</div>{!library.worlds.some(w=>filter(w.name+' '+library.works.filter(b=>b.worldId===w.id).map(b=>b.name).join(' ')))&&<div className="work-empty">没有匹配的世界。</div>}</Tabs.Content>
      </Tabs.Root>
    </div>
    {editor?.kind==='new'&&<NewWorkEditor worlds={library.worlds} selectedWorldId={editor.worldId??world?.id??library.worlds[0]?.id??''} shared={Boolean(editor.worldId)} onClose={()=>setEditor(null)} onCreated={async created=>{setEditor(null);await onChanged();await open(created.id);}}/>}
    {editor?.kind==='name'&&<WorkNameEditor work={editor.work} onClose={()=>setEditor(null)} onSaved={saved}/>}
    {editor?.kind==='world'&&<WorldEditor world={editor.world} onClose={()=>setEditor(null)} onSaved={saved}/>}
    {editor?.kind==='overview'&&dashboard&&<OverviewEditor dashboard={dashboard} onClose={()=>setEditor(null)} onSaved={saved}/>}
    <AlertDialog.Root open={Boolean(archiveTarget)} onOpenChange={value=>{if(!value&&!busy)setArchiveTarget(null);}}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay"/><AlertDialog.Content className="confirm-dialog"><AlertDialog.Title>归档《{archiveTarget?.name}》？</AlertDialog.Title><AlertDialog.Description>作品将从常用书架收起，章节、计划和共用的世界资料完整保留。可在“已归档”中恢复。{archiveTarget?.id===work?.id?'归档后会打开另一部使用中的作品。':''}</AlertDialog.Description>{error&&<p className="editor-error" role="alert">{error}</p>}<div className="dialog-buttons"><AlertDialog.Cancel className="btn" disabled={busy}>取消</AlertDialog.Cancel><button className="btn primary" disabled={busy} onClick={()=>archiveTarget&&void archive(archiveTarget,true)}>{busy?'正在归档…':'归档作品'}</button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    {deleteTarget&&<DeletionDialog library={library} initialTarget={{kind:'work',id:deleteTarget.id}} onChanged={onChanged} onClose={()=>setDeleteTarget(null)}/>}
    {notice&&<div className="save-notice" role="status">{notice}</div>}
  </section>;
}

export function NewWorkEditor({worlds,selectedWorldId,shared,onClose,onCreated}:{worlds:World[];selectedWorldId:string;shared:boolean;onClose:()=>void;onCreated:(work:Work)=>Promise<void>}) {
  const [name,setName]=useState(''),[kind,setKind]=useState<'new'|'existing'>(shared?'existing':'new'),[worldId,setWorldId]=useState(selectedWorldId),[worldName,setWorldName]=useState(''),[description,setDescription]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const initial=useRef(JSON.stringify({name,kind,worldId,worldName,description}));
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const input:NewWorkInput={name,world:kind==='new'?{kind,name:worldName,description}:{kind,id:worldId}};const created=unwrap(await window.studio!.createWork(input));await onCreated(created);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <JourneyDialog title="开始一部新作品" description="先为故事取个名字，再选择它发生的世界。" scopeLabel="作品设置" savedHint="创建后打开新作品的概览" submitLabel="创建作品" dirty={initial.current!==JSON.stringify({name,kind,worldId,worldName,description})} busy={busy} error={error} onClose={onClose} onSubmit={save}>
    <label className="editor-field"><span>作品名称</span><Input required autoFocus maxLength={200} value={name} onChange={e=>setName(e.target.value)} placeholder="输入小说或故事的名称"/></label>
    <div className="work-world-choice" role="group" aria-label="选择作品世界"><button type="button" aria-pressed={kind==='new'} onClick={()=>setKind('new')}><Icon name="world"/><strong>独立的新世界</strong><span>独立的人物与设定</span></button><button type="button" aria-pressed={kind==='existing'} disabled={!worlds.length} onClick={()=>setKind('existing')}><Icon name="network"/><strong>使用已有世界</strong><span>共用人物与设定</span></button></div>
    {kind==='new'?<><label className="editor-field"><span>新世界名称</span><Input required maxLength={200} value={worldName} onChange={e=>setWorldName(e.target.value)} placeholder="例如：群岛世界"/></label><label className="editor-field"><span>世界简介（选填）</span><Textarea rows={3} maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="这个世界最值得记住的特点"/></label></>:<><label className="editor-field"><span>所属世界</span><SelectField required aria-label="选择已有世界" value={worldId} onValueChange={setWorldId}>{worlds.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</SelectField></label><p className="work-form-note">修改世界资料会同步影响共用它的作品。</p></>}
  </JourneyDialog>;
}

function WorkNameEditor({work,onClose,onSaved}:{work:Work;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [name,setName]=useState(work.name),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{unwrap(await window.studio!.saveWork({id:work.id,name,expectedVersion:work.version}));await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <JourneyDialog title="修改作品名称" description="新名称会同步到书架、概览与章节。" scopeLabel="作品设置" savedHint="作品内容与关联保留" dirty={name!==work.name} busy={busy} error={error} onClose={onClose} onSubmit={save}><label className="editor-field"><span>作品名称</span><Input required autoFocus maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><p className="work-form-note">所属世界：{work.worldName}</p></JourneyDialog>;
}

function WorldEditor({world,onClose,onSaved}:{world:World|null;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [name,setName]=useState(world?.name??''),[description,setDescription]=useState(world?.description??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{unwrap(await window.studio!.saveWorld({id:world?.id,name,description,expectedVersion:world?.version??0}));await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <JourneyDialog title={world?'编辑世界信息':'建立一个世界'} description={world?'名称与简介由使用这个世界的所有作品共用。':'可以先建立世界，稍后再添加作品。'} scopeLabel="作品设置" savedHint="世界中的人物与设定保留" dirty={name!==(world?.name??'')||description!==(world?.description??'')} busy={busy} error={error} onClose={onClose} onSubmit={save}><label className="editor-field"><span>世界名称</span><Input required autoFocus maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><label className="editor-field"><span>世界简介</span><Textarea rows={6} maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)}/></label></JourneyDialog>;
}
