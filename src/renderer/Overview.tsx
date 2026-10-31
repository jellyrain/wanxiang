import {Markdown} from './Markdown.tsx';
import React, { useEffect, useMemo, useState } from 'react';
import type { LibrarySnapshot, Work, WorkDashboard, StudioPage } from '../shared/types.ts';
import { overviewData, blankDashboard, dashboardInput, workPhases, type OverviewTarget } from '../shared/overview.ts';
import { chapterStatuses } from '../shared/chapters.ts';
import { profileOf, resolveForms } from '../shared/journey.ts';
import { OverviewEditor } from './OverviewEditor.tsx';
import { CharacterCard } from './CharacterCard.tsx';
import { CharacterImage } from './CharacterImage.tsx';
import { MediaImage } from './AssetPicker.tsx';
import { CheckField } from './Fields.tsx';
import { Icon } from './Icon.tsx';

const recordIcons={character:'users',entry:'world',map:'pin',timeline:'history',chapter:'book',media:'image',relations:'network'};
type Props={work:Work;library:LibrarySnapshot;onChanged:()=>Promise<void>;onDirtyChange:(dirty:boolean)=>void;onOpen:(target:OverviewTarget)=>void;onPage:(page:StudioPage)=>void;onNewCharacter:()=>void};
export function Overview({work,library,onChanged,onDirtyChange,onOpen,onPage,onNewCharacter}:Props) {
  const dashboard=library.dashboards?.find(d=>d.workId===work.id)??blankDashboard(work),data=useMemo(()=>overviewData(library,work),[library,work]);
  const [editing,setEditing]=useState<WorkDashboard|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[showTasks,setShowTasks]=useState(false),[showPending,setShowPending]=useState(false),[showRecent,setShowRecent]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{onDirtyChange(Boolean(editing)||busy);return()=>onDirtyChange(false);},[editing,busy,onDirtyChange]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
  const edit=()=>setEditing(structuredClone(dashboard));
  const check=async(id:string,done:boolean)=>{if(busy)return;setBusy(true);setError('');try{const r=await window.studio!.saveDashboard({...dashboardInput(dashboard),tasks:dashboard.tasks.map(t=>t.id===id?{...t,done}:t)});if(!r.ok)throw Error(r.error.message);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const featured=data.characters[0],form=featured?resolveForms(profileOf(featured),featured.forms,library.attributeTemplates).find(f=>f.id===featured.defaultFormId):undefined;
  const cover=library.media?.find(m=>m.id===dashboard.coverId);
  const metrics:{icon:string;label:string;value:number;page:StudioPage}[]=[{icon:'users',label:'人物',value:data.characters.length,page:'角色图鉴'},{icon:'world',label:'世界设定',value:data.entries.length,page:'世界档案'},{icon:'pin',label:'地图地点',value:data.locations,page:'地图探索'},{icon:'network',label:'人物关系',value:data.relations.length,page:'关系图谱'},{icon:'history',label:'历史事件',value:data.events.length,page:'历史年表'},{icon:'image',label:'图片素材',value:data.media.length,page:'素材画廊'}];
  const tasks=showTasks?dashboard.tasks:dashboard.tasks.slice(0,4),pending=showPending?data.pending:data.pending.slice(0,3),recent=data.recent.slice(0,showRecent?6:3);
  return <section className="overview-module">
    <div className="page-head"><div><h1>创作概览</h1></div><div className="page-actions"><button className="btn" disabled={busy} onClick={edit}><Icon name="pen"/>简介与计划</button><button className="btn" onClick={()=>data.resume?onOpen({kind:'chapter',id:data.resume.id}):onPage('剧情与章节')}><Icon name="book"/>{data.resume?'继续写作':'前往写作'}</button></div></div>
    {error&&<div className="error-banner" role="alert">{error}</div>}
    <div className="overview-scroll">
      <div className="overview-opening">
        <section className={`overview-hero ${dashboard.coverId?'has-cover':'character-cover'}`}>
          <div className={`overview-hero-art ${dashboard.coverId&&dashboard.coverFlip?'mirrored':''}`}>
            {dashboard.coverId?<MediaImage id={dashboard.coverId} name={`${work.name}封面`}/>:featured?<CharacterImage character={{name:featured.name,portraitId:form?.portraitId??featured.portraitId,portraitWidth:form?.portraitWidth??featured.portraitWidth}}/>:<div className="overview-hero-placeholder"><Icon name="book"/></div>}
          </div>
          <div className="overview-hero-copy"><div className="overview-hero-labels"><span>{dashboard.genre||'创作档案'}</span><span>{workPhases[dashboard.phase]}</span></div><h2>{work.name}</h2><Markdown className="preserve-lines">{dashboard.description}</Markdown><div className="overview-hero-badges"><span>{work.worldName}</span>{data.pending.length>0&&<span>{data.pending.length} 项资料待确认</span>}</div><button className="btn primary" onClick={()=>onPage('世界档案')}>展开世界档案 <Icon name="arrow"/></button></div>
          <button className="overview-cover-caption" disabled={busy} onClick={edit} aria-label="编辑概览封面"><Icon name="image"/>{dashboard.coverId?cover?.name||'作品封面':'更换概览封面'}</button>
        </section>
        <section className="overview-activity" aria-label="最近的创作脉络">
          <header><h3>最近的创作脉络</h3><Icon name="history"/></header>
          <div className="overview-activity-list">{recent.length?recent.map(r=><button key={`${r.kind}:${r.id}`} onClick={()=>onOpen(r)}><Icon name={recordIcons[r.kind]}/><div><strong>{r.title}</strong><span>{r.detail}</span><time>{new Date(r.updatedAt).toLocaleDateString('zh-CN',{month:'long',day:'numeric'})} 更新</time></div><Icon name="arrow"/></button>):<p className="overview-muted">暂无最近编辑</p>}{data.recent.length>3&&<button className="overview-more" onClick={()=>setShowRecent(!showRecent)}>{showRecent?'收起更新':'更多最近更新'}<Icon name="down"/></button>}</div>
          <footer><button className="overview-phase" disabled={busy} onClick={edit}><span><Icon name="pen"/>当前创作阶段</span><span className="tag gold">{workPhases[dashboard.phase]}</span></button>{dashboard.memo&&<p title={dashboard.memo}>{dashboard.memo}</p>}</footer>
        </section>
      </div>

      <div className="overview-section-heading"><h3>故事中的人物 </h3><div><button className="text-link" onClick={onNewCharacter}><Icon name="plus"/>新建角色</button><button className="text-link" onClick={()=>onPage('角色图鉴')}>进入角色图鉴 <Icon name="arrow"/></button></div></div>
      {data.characters.length?<div className="cast-grid overview-cast">{data.characters.slice(0,4).map((c,index)=><CharacterCard key={c.id} character={c} index={index} templates={library.attributeTemplates} onOpen={()=>onOpen({kind:'character',id:c.id})}/>)}</div>:<button className="new-character overview-first-character" onClick={onNewCharacter}><Icon name="plus"/>新建第一个角色</button>}

      <div className="overview-section-heading"><h3>世界资料</h3></div>
      <div className="overview-metrics">{metrics.map(m=><button key={m.page} onClick={()=>onPage(m.page)}><Icon name={m.icon}/><span>{m.label}</span><strong>{m.value}</strong><Icon name="arrow"/></button>)}</div>

      <div className="overview-section-heading"><h3>创作计划</h3></div>
      <div className="overview-workspace">
        <section className="overview-panel"><header><h3>写作进度</h3><button className="text-link" disabled={busy} onClick={edit}>设置目标 <Icon name="arrow"/></button></header><div className="overview-writing-stats"><div><strong>{data.wordCount.toLocaleString()}</strong><span>正文字符</span></div><div><strong>{data.chapters.length}</strong><span>章节</span></div><div><strong>{data.finished}</strong><span>已定稿</span></div></div><p className="overview-count-note">仅当前作品 · 含标点，不计空白</p>{dashboard.targetCharacters!==null?<div className="overview-goal"><div><span>目标 {dashboard.targetCharacters.toLocaleString()} 字符</span><strong>{Math.round(data.wordCount/dashboard.targetCharacters*100)}%</strong></div><progress max={dashboard.targetCharacters} value={Math.min(data.wordCount,dashboard.targetCharacters)}/></div>:<p className="overview-muted">尚未设置篇幅目标。</p>}<div className="overview-chapter-states">{Object.entries(chapterStatuses).map(([id,name])=><span key={id}><i className={`chapter-dot ${id}`}/>{name}<b>{data.chapters.filter(c=>c.status===id).length}</b></span>)}</div><button className="overview-resume" onClick={()=>data.resume?onOpen({kind:'chapter',id:data.resume.id}):onPage('剧情与章节')}><Icon name="pen"/><span><small>{data.resume?'最近编辑的章节':'开始写作'}</small><strong>{data.resume?.name??'写下第一章'}</strong></span><Icon name="arrow"/></button></section>
        <section className="overview-panel overview-tasks"><header><h3>创作待办 <small>{dashboard.tasks.filter(t=>t.done).length}/{dashboard.tasks.length}</small></h3><button className="text-link" disabled={busy} onClick={edit}>编辑计划 <Icon name="arrow"/></button></header>{dashboard.memo&&<p className="overview-memo preserve-lines" title={dashboard.memo}>{dashboard.memo}</p>}{tasks.length?<div className="overview-task-list">{tasks.map(t=><label key={t.id} className={t.done?'done':''}><CheckField aria-label={`完成待办 ${t.title}`} disabled={busy} checked={t.done} onCheckedChange={done=>void check(t.id,done)}/><span>{t.title}</span></label>)}</div>:<p className="overview-muted">暂无待办</p>}{dashboard.tasks.length>4&&<button className="text-link" onClick={()=>setShowTasks(!showTasks)}>{showTasks?'收起待办':`查看全部 ${dashboard.tasks.length} 项`}</button>}</section>
        <section className="overview-panel"><header><h3>待确认资料 <small>{data.pending.length}</small></h3><Icon name="info"/></header>{pending.length?<div className="overview-records">{pending.map(r=><button key={`${r.kind}:${r.id}:${r.eventId??''}`} onClick={()=>onOpen(r)}><Icon name={recordIcons[r.kind]}/><div><small>{r.detail}</small><strong>{r.title}</strong></div><Icon name="arrow"/></button>)}</div>:<p className="overview-muted">暂无待确认资料</p>}{data.pending.length>3&&<button className="text-link" onClick={()=>setShowPending(!showPending)}>{showPending?'收起资料':`查看全部 ${data.pending.length} 项`}</button>}</section>
      </div>
    </div>
    {editing&&<OverviewEditor dashboard={editing} onClose={()=>setEditing(null)} onSaved={async()=>{await onChanged();setNotice('简介与创作计划已保存');}}/>}{notice&&<div className="save-notice" role="status">{notice}</div>}
  </section>;
}
