import {ImageField} from './ImageField.tsx';
import {CharacterCatalogLinks} from './CatalogLinks.tsx';
import type {CatalogKind} from '../shared/types.ts';
const Catalogs=React.lazy(()=>import('./Catalogs.tsx').then(m=>({default:m.Catalogs})));
import {GlobalSearch} from './GlobalSearch.tsx';
import type {SearchHit} from '../shared/search.ts';
import {useAppearance,Background,AppearanceDialog} from './Appearance.tsx';
import {useLibrarySync} from './useLibrarySync.ts';
import { Textarea, Input, CheckField, SelectField } from './Fields.tsx';
import React, { useEffect, useRef, useState } from 'react';
import { Dialog, Tabs, AlertDialog } from 'radix-ui';
import type { Character, CharacterInput, LibrarySnapshot, Result, Tag, AttributeTemplate, StudioPage } from '../shared/types.ts';
import { Icon } from './Icon.tsx';
import {isDesktop} from './runtime.ts';
const GettingStarted=React.lazy(()=>import('./GettingStarted.tsx').then(m=>({default:m.GettingStarted}))); 
import { BRAND } from '../shared/brand.ts';
import { WindowTitleBar } from './WindowTitleBar.tsx';
import { CharacterImage } from './CharacterImage.tsx';
import { CharacterCard } from './CharacterCard.tsx';
import { TagManager, TagBadge } from './TagManager.tsx';
import { ThemePicker } from './ThemePicker.tsx';
import { LibraryImageButton, MediaImage } from './AssetPicker.tsx';
import { workPhases, type OverviewTarget } from '../shared/overview.ts';
import type { MediaUse } from '../shared/gallery.ts';
const ApplicationSettings=React.lazy(()=>import('./ApplicationSettings.tsx').then(m=>({default:m.ApplicationSettings})));
const WorkSettings=React.lazy(()=>import('./WorkSettings.tsx').then(m=>({default:m.WorkSettings})));
const Overview=React.lazy(()=>import('./Overview.tsx').then(m=>({default:m.Overview})));
const MediaGallery=React.lazy(()=>import('./MediaGallery.tsx').then(m=>({default:m.MediaGallery})));
const Chapters=React.lazy(()=>import('./Chapters.tsx').then(m=>({default:m.Chapters})));
const Timeline=React.lazy(()=>import('./Timeline.tsx').then(m=>({default:m.Timeline})));
const MapExplorer=React.lazy(()=>import('./MapExplorer.tsx').then(m=>({default:m.MapExplorer})));
const WorldArchive=React.lazy(()=>import('./WorldArchive.tsx').then(m=>({default:m.WorldArchive})));
const RelationshipGraph=React.lazy(()=>import('./RelationshipGraph.tsx').then(m=>({default:m.RelationshipGraph})));
import { CharacterDetail } from './CharacterDetail.tsx';
import { profileOf, resolveForms, characterSearchText } from '../shared/journey.ts';
import type { ThemeId } from '../shared/themes.ts';
import { AttributeManager } from './AttributeManager.tsx';
import { AttributeFields, blankAttributes } from './AttributeView.tsx';

function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }
function toInput(character: Character | null, worldId: string,templates:AttributeTemplate[],defaultTemplateId:string|null): CharacterInput {
  const defaultTemplate=templates.find(t=>t.id===defaultTemplateId);
  return character ? { designImageId:character.designImageId,id:character.id,worldId:character.worldId,expectedVersion:character.version,name:character.name,
    caption:character.caption,status:character.status,quote:character.quote,intro:character.intro,body:character.body,
    pending:character.pending,abilities:character.abilities,facts:character.facts.map(fact => ({ ...fact })),tagIds:character.tags.map(tag => tag.id),portraitId:character.portraitId,portraitWidth:character.portraitWidth,attributes:structuredClone(character.attributes) }
    : { designImageId:null,worldId,expectedVersion:0,name:'',caption:'',status:'草稿',quote:'',intro:'',body:'',pending:'',abilities:'',facts:[],tagIds:[],portraitId:null,portraitWidth:100,attributes:defaultTemplate ? {templateId:defaultTemplate.id,values:{},versions:{[defaultTemplate.id]:defaultTemplate.version}} : blankAttributes() };
}
const navigation = [
  ['book','创作概览'],['users','角色图鉴'],['world','世界档案'],['folder','物品库'],['book','功法库'],['pin','地点库'],['folder','地图探索'],
  ['network','关系图谱'],['history','历史年表'],['pen','剧情与章节'],['image','素材画廊'],['sliders','作品设置'],['settings','软件设置']
];

export function App() {
  const appearance=useAppearance();
  const [catalogFocus,setCatalogFocus]=useState<{kind:CatalogKind;id:string}|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchTarget,setSearchTarget]=useState<SearchHit|null>(null);
  const [characterStatus,setCharacterStatus]=useState('');
  const [appearanceOpen,setAppearanceOpen]=useState(false);
  const [library,setLibrary] = useState<LibrarySnapshot | null>(null);
  const [error,setError] = useState('');
  const [page,setPage]=useState<StudioPage>('创作概览');
  const [welcome,setWelcome]=useState<{fresh:boolean}|null>(null);
  const [draftDirty,setDraftDirty]=useState(false),[leaveDraft,setLeaveDraft]=useState(false);
  const pendingNavigation=useRef<(()=>void)|null>(null);
  const navigate=(action:()=>void)=>{if(draftDirty){pendingNavigation.current=action;setLeaveDraft(true);}else action();};
  useEffect(()=>{const prevent=(event:BeforeUnloadEvent)=>{if(draftDirty||document.querySelector('[role="dialog"],[role="alertdialog"]')){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[draftDirty]);
  const [mapFocus,setMapFocus]=useState<{mapId:string;stageId?:string;locationId?:string}|null>(null);
  const [timelineFocus,setTimelineFocus]=useState<{timelineId:string;eventId:string}|null>(null);
  const [activeWorkId,setActiveWorkId]=useState<string|null>(null),[switchingWork,setSwitchingWork]=useState(false);
  const [mediaFocus,setMediaFocus]=useState<string|null>(null);
  const [chapterFocus,setChapterFocus]=useState<string|null>(null);
  const [characterStage,setCharacterStage]=useState<string|null>(null);
  const [worldEntryId,setWorldEntryId]=useState<string|null>(null);
  const [graphFocus,setGraphFocus]=useState<{characterId:string;stageId:string|null;relationId?:string}|null>(null);
  const [selected,setSelected] = useState<string | null>(null);
  const [editing,setEditing] = useState<Character | null | undefined>(undefined);
  const [query,setQuery] = useState('');
  const [tag,setTag] = useState('');
  const [view,setView] = useState<'grid'|'list'>('grid');
  const [archived,setArchived] = useState(false);
  const [notice,setNotice] = useState('');
  const [tagsOpen,setTagsOpen] = useState(false);
  const [templatesOpen,setTemplatesOpen] = useState(false);
  const [editorTab,setEditorTab] = useState('basic');
  const [archiveTarget,setArchiveTarget] = useState<Character | null>(null);
  const [busy,setBusy] = useState(false);
  const {offline,restored}=useLibrarySync(searchOpen||Boolean(welcome)||draftDirty||editing!==undefined||busy||switchingWork||tagsOpen||templatesOpen,setLibrary,library?.generation);
  
  const refresh = async () => {
    if (!window.studio) { setError('资料连接尚未建立，请确认万象工坊正在运行。'); return; }
    try { setLibrary(unwrap(await window.studio.snapshot())); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { document.title = BRAND.name; void refresh(); },[]);
  useEffect(() => { if (library) document.documentElement.dataset.theme = library.theme; },[library?.theme]);
  useEffect(() => { if (tag && library && !library.tags.some(t => t.id === tag)) setTag(''); },[library,tag]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && editing === undefined && !tagsOpen && !templatesOpen) { event.preventDefault(); navigate(()=>setSearchOpen(true)); } };
    document.addEventListener('keydown',listener);
    return () => document.removeEventListener('keydown',listener);
  },[editing,tagsOpen,templatesOpen,draftDirty]);
  useEffect(() => { if (!notice) return; const timer=setTimeout(() => setNotice(''),4500); return () => clearTimeout(timer); },[notice]);
  useEffect(()=>{if(!library||!isDesktop)return;let alive=true;void window.studio!.getDesktopStatus().then(r=>{if(alive&&r.ok&&!r.value.onboardingComplete)setWelcome({fresh:true});});return()=>{alive=false;};},[library?.generation]);
  const activeWorks=library?.works.filter(w=>!w.archived)??[];
  const work=activeWorks.find(w=>w.id===activeWorkId)??activeWorks.find(w=>w.id===library?.activeWorkId)??activeWorks[0];
  useEffect(()=>{if(!work)return;setActiveWorkId(work.id);setQuery('');setTag('');setCharacterStatus('');setArchived(false);setSelected(null);setCharacterStage(null);setWorldEntryId(null);setGraphFocus(null);setMapFocus(null);setTimelineFocus(null);setChapterFocus(null);setMediaFocus(null);},[work?.id]);
  const switchWork=async(id:string)=>{
    if(switchingWork)return;setSwitchingWork(true);
    try{unwrap(await window.studio!.selectWork(id));const next=unwrap(await window.studio!.snapshot());setLibrary(next);setActiveWorkId(id);setPage('创作概览');setSelected(null);setError('');window.scrollTo(0,0);}finally{setSwitchingWork(false);}
  };
  const dashboard=library?.dashboards?.find(d=>d.workId===work?.id);
  const all = library?.characters.filter(c => c.worldId === work?.worldId) ?? [];
  const character = page==='角色图鉴' ? all.find(c => c.id === selected) : undefined;
  const worldEntries=library?.worldEntries?.filter(e=>e.worldId===work?.worldId)??[];
  const worldCategories=library?.worldCategories?.filter(c=>c.worldId===work?.worldId)??[];
  const openCatalog=(kind:CatalogKind,id:string)=>navigate(()=>{setCatalogFocus({kind,id});setPage(kind==='item'?'物品库':kind==='technique'?'功法库':'地点库');window.scrollTo(0,0);});
  const openWorldEntry=(id:string)=>navigate(()=>{setPage('世界档案');setWorldEntryId(id);window.scrollTo(0,0);});
  const relationTypes=library?.relationTypes.filter(t=>t.worldId===work?.worldId)??[];
  const relations=library?.relations.filter(r=>r.worldId===work?.worldId)??[];
  const group = all.filter(c => c.archived === archived);
  const tags = library?.tags.filter(t => t.worldId === work?.worldId) ?? [];
  const templates = library?.attributeTemplates.filter(t=>t.worldId===work?.worldId) ?? [];
  const attributeDefault = library?.attributeDefaults.find(s=>s.worldId===work?.worldId);
  const changeTheme = async (theme:ThemeId) => {
    const saved = unwrap(await window.studio!.setTheme(theme));
    setLibrary(current => current ? {...current,theme:saved} : current);
  };
  const visible = group.filter(c => (!characterStatus||c.status===characterStatus) && (!tag || c.tags.some(item => item.id === tag)) && characterSearchText(c).includes(query.trim().toLowerCase()));
  const cardPortrait=(c:Character)=>{const forms=resolveForms(profileOf(c),c.forms,templates);const form=forms.find(f=>f.id===c.defaultFormId)??forms[0];return {name:c.name,portraitId:form.portraitId,portraitWidth:form.portraitWidth};};
  const openCharacter = (id: string, stageId:string|null=null) => navigate(()=>{ setCharacterStage(stageId);setPage('角色图鉴'); setSelected(id); window.scrollTo(0,0); });
  const openTimeline=(timelineId:string,eventId:string)=>navigate(()=>{setTimelineFocus({timelineId,eventId});setPage('历史年表');});
  const openChapter=(id:string)=>navigate(()=>{setChapterFocus(id);setPage('剧情与章节');});
  const openMap=(mapId:string,stageId?:string,locationId?:string)=>navigate(()=>{setMapFocus({mapId,stageId,locationId});setPage('地图探索');});
  const openMedia=(id:string)=>navigate(()=>{setMediaFocus(id);setPage('素材画廊');});
  const openPage=(next:StudioPage)=>navigate(()=>{setPage(next);setSelected(null);setCharacterStage(null);setMapFocus(null);setTimelineFocus(null);setChapterFocus(null);setMediaFocus(null);setGraphFocus(null);setWorldEntryId(null);window.scrollTo(0,0);});
  const openOverviewTarget=(target:OverviewTarget)=>{switch(target.kind){case 'character':openCharacter(target.id);break;case 'entry':openWorldEntry(target.id);break;case 'map':openMap(target.id);break;case 'timeline':openTimeline(target.id,target.eventId??'');break;case 'chapter':openChapter(target.id);break;case 'media':openMedia(target.id);break;case 'relations':{const r=relations.find(r=>r.id===target.id);navigate(()=>{setGraphFocus(r?{characterId:r.sourceId,stageId:r.sourceStageId,relationId:r.id}:null);setPage('关系图谱');});break;}}};
  const openMediaUse=(use:MediaUse)=>{switch(use.kind){case 'item':case 'technique':case 'place':openCatalog(use.kind,use.targetId);break;case 'character':openCharacter(use.targetId,use.stageId??null);break;case 'entry':openWorldEntry(use.targetId);break;case 'map':openMap(use.targetId,undefined,use.locationId);break;case 'cover':navigate(()=>{setActiveWorkId(use.targetId);setPage('创作概览');});break;}};
  useEffect(()=>{if(!searchTarget||!library)return;const h=searchTarget;setSearchTarget(null);switch(h.kind){case 'character':openCharacter(h.id);break;case 'item':case 'technique':case 'place':openCatalog(h.kind,h.id);break;case 'entry':openWorldEntry(h.id);break;case 'chapter':openChapter(h.id);break;case 'map':openMap(h.id,undefined,h.childId);break;case 'timeline':openTimeline(h.id,h.childId??'');break;case 'media':openMedia(h.id);break;case 'relation':openOverviewTarget({kind:'relations',id:h.id});break;default:openPage('作品设置');}},[searchTarget,work?.id]);
  const editCharacter = (c:Character|null,tab='basic') => {setEditorTab(tab);setEditing(c);};
  const saved = async (c: Character) => { await refresh(); setEditing(undefined); setPage('角色图鉴');setSelected(c.id); setNotice('人物档案已保存'); };
  const archive = async (c: Character) => {
    setBusy(true);
    try { unwrap(await window.studio!.archiveCharacter(c.id,c.version,!c.archived)); await refresh(); setArchiveTarget(null); setSelected(null); setNotice(c.archived ? '人物已恢复' : '人物已归档，可从已归档列表恢复'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <><Background appearance={appearance}/>{library&&appearanceOpen&&<AppearanceDialog theme={library.theme} onTheme={changeTheme} appearance={appearance} onClose={()=>setAppearanceOpen(false)}/>} {library&&welcome&&<React.Suspense fallback={null}><GettingStarted library={library} fresh={welcome.fresh} onChanged={refresh} onOpenWork={switchWork} onClose={()=>setWelcome(null)}/></React.Suspense>}<WindowTitleBar context={work ? `${work.name} / ${character ? character.name : page}` : '创作档案'}/>{offline&&<div className="connection-offline" role="status">连接已中断，请保持万象工坊桌面软件运行。未保存的输入仍保留在当前页面。</div>}{restored&&<div className="connection-offline" role="alert">资料库已恢复。当前草稿仍在，请先复制需要保留的内容，再重新打开。<button className="btn small" onClick={()=>navigate(()=>window.location.reload())}>重新打开</button></div>}<div className={`app-shell ${['创作概览','关系图谱','地图探索','历史年表','剧情与章节','素材画廊','作品设置','软件设置'].includes(page)?'graph-shell':''}`}>
    {library&&searchOpen&&<GlobalSearch library={library} onClose={()=>setSearchOpen(false)} onOpen={async hit=>{const targetWork=library.works.find(w=>w.id===hit.workId)??library.works.find(w=>w.worldId===hit.worldId&&!w.archived);if(targetWork&&!targetWork.archived){if(targetWork.id!==work?.id)await switchWork(targetWork.id);setSearchTarget(hit);}else{setPage('作品设置');setNotice(targetWork?'所属作品已归档，请恢复作品后打开这份资料。':'这个世界暂无使用中的作品，可在作品设置中选择或新建作品。');}setSearchOpen(false);}}/>}
    <aside className="sidebar">
      <button className="brand brand-button" onClick={() => openPage('创作概览')} aria-label="返回创作概览">
        <img className="app-brand-icon" src={`./brand/${BRAND.iconFile}`} alt=""/>
        <div className="brand-text"><div className="brand-name">{BRAND.name}</div></div>
      </button>
      <button className="project-switch project-switch-button" aria-label="管理作品与世界" onClick={()=>openPage('作品设置')}>{dashboard?.coverId?<MediaImage id={dashboard.coverId} name="当前作品封面"/>:<span className="project-book-icon"><Icon name="book"/></span>}<div><strong>{work?.name ?? (library?'暂无作品':'载入资料…')}</strong><small>{dashboard?.genre?dashboard.genre+' · ':''}{workPhases[dashboard?.phase??'worldbuilding']}</small></div></button>
      {activeWorks.length>1&&<SelectField aria-label="切换作品" className="work-switch-select" disabled={switchingWork} value={work?.id??''} onValueChange={id=>navigate(()=>void switchWork(id).catch(e=>setError(e.message)))}>{activeWorks.map(w=><option key={w.id} value={w.id}>{w.name} · {w.worldName}</option>)}</SelectField>}
      <nav className="nav" aria-label="主导航"><div className="nav-group">创作档案</div>{navigation.map(([icon,label]) =>
        <button key={label} className={`nav-item ${label === page ? 'active' : ''}`} disabled={!['创作概览','角色图鉴','关系图谱','世界档案','物品库','功法库','地点库','地图探索','历史年表','剧情与章节','素材画廊','作品设置','软件设置'].includes(label)} title={['创作概览','角色图鉴','关系图谱','世界档案','物品库','功法库','地点库','地图探索','历史年表','剧情与章节','素材画廊','作品设置','软件设置'].includes(label) ? label : `${label} · 后续接入`} aria-label={label} aria-current={label === page ? 'page' : undefined} onClick={() => navigate(()=>{setPage(label as StudioPage);setCatalogFocus(null);setSelected(null);setCharacterStage(null);setMapFocus(null);setTimelineFocus(null);setChapterFocus(null);setMediaFocus(null);setGraphFocus(null);setWorldEntryId(null);window.scrollTo(0,0);})}><Icon name={icon}/><span className="nav-label">{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><i className="status-dot"/><span>本地资料库</span></div>

    </aside>
    <div className="main-shell"><header className="topbar">
      <div className="breadcrumbs"><span>我的书架</span><Icon name="arrow"/><span>{work?.name ?? '资料库'}</span><Icon name="arrow"/><span>{character ? '角色档案' : page}</span></div>
      <div className="top-actions"><button className="search-trigger desktop-search" aria-label="全局搜索" onClick={()=>navigate(()=>setSearchOpen(true))}><Icon name="search"/><span>全局搜索资料…</span><kbd>Ctrl K</kbd></button>{library && <ThemePicker onOpen={()=>setAppearanceOpen(true)}/>}</div>
    </header>
    <main id="main-content" className={['创作概览','关系图谱','地图探索','历史年表','剧情与章节','素材画廊','作品设置','软件设置'].includes(page)?'graph-main':undefined}>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="btn small" onClick={() => void refresh()}>重新读取</button></div>}
      {!library && !error && <div className="empty" role="status">正在打开你的世界…</div>}
      {library && (page==='软件设置' ? <React.Suspense fallback={<div className="empty">正在打开软件设置…</div>}><ApplicationSettings onShowAppearance={()=>setAppearanceOpen(true)} onShowWelcome={()=>navigate(()=>setWelcome({fresh:false}))} library={library} onChanged={refresh} onDirtyChange={setDraftDirty}/></React.Suspense> : (page==='作品设置'||!work) ? <React.Suspense fallback={<div className="empty">正在打开书架…</div>}><WorkSettings key={work?.id??'empty'} work={work} library={library} onChanged={refresh} onOpenWork={switchWork} onDirtyChange={setDraftDirty}/></React.Suspense> : page==='创作概览' ? <React.Suspense fallback={<div className="empty">正在打开概览…</div>}><Overview key={work.id} work={work} library={library} onChanged={refresh} onDirtyChange={setDraftDirty} onOpen={openOverviewTarget} onPage={openPage} onNewCharacter={()=>editCharacter(null)}/></React.Suspense> : page==='素材画廊' ? <React.Suspense fallback={<div className="empty">正在打开素材…</div>}><MediaGallery key={work.worldId} worldId={work.worldId} library={library} focus={mediaFocus} onChanged={refresh} onDirtyChange={setDraftDirty} onOpenUse={openMediaUse}/></React.Suspense> : page==='剧情与章节' ? <React.Suspense fallback={<div className="empty" role="status">正在打开章节…</div>}><Chapters key={work.id} work={work} outline={library.outlines?.find(o=>o.workId===work.id)} chapters={library.chapters?.filter(c=>c.workId===work.id)??[]} characters={all} entries={worldEntries} maps={library.maps?.filter(m=>m.worldId===work.worldId)??[]} timelines={library.timelines?.filter(t=>t.worldId===work.worldId)??[]} focus={chapterFocus} onChanged={refresh} onDirtyChange={setDraftDirty} onOpenCharacter={openCharacter} onOpenEntry={openWorldEntry} onOpenTimeline={openTimeline} onOpenMap={openMap}/></React.Suspense> : page==='历史年表' ? <React.Suspense fallback={<div className="empty" role="status">正在打开年表…</div>}><Timeline chapters={library.chapters?.filter(c=>c.workId===work.id)??[]} onOpenChapter={openChapter} worldId={work.worldId} timelines={library.timelines?.filter(t=>t.worldId===work.worldId)??[]} characters={all} entries={worldEntries} maps={library.maps?.filter(m=>m.worldId===work.worldId)??[]} focus={timelineFocus} onChanged={refresh} onDirtyChange={setDraftDirty} onOpenCharacter={openCharacter} onOpenEntry={openWorldEntry} onOpenMap={openMap}/></React.Suspense> : page==='地图探索' ? <React.Suspense fallback={<div className="empty" role="status">正在打开地图…</div>}><MapExplorer places={library.places} onOpenPlace={id=>openCatalog('place',id)} chapters={library.chapters??[]} focus={mapFocus} timelines={library.timelines??[]} key={work.worldId} worldId={work.worldId} maps={library.maps?.filter(m=>m.worldId===work.worldId)??[]} characters={all} entries={worldEntries} onChanged={refresh} onDirtyChange={setDraftDirty} onNavigate={navigate} onOpenCharacter={openCharacter} onOpenEntry={openWorldEntry}/></React.Suspense> : ['物品库','功法库','地点库'].includes(page) ? <React.Suspense fallback={<div className="empty">正在打开资料库…</div>}><Catalogs key={work.worldId+page} kind={page==='物品库'?'item':page==='功法库'?'technique':'place'} worldId={work.worldId} library={library} focus={catalogFocus?.id??null} onChanged={refresh} onDirtyChange={setDraftDirty} onOpenCharacter={openCharacter} onOpenEntry={openWorldEntry} onOpenMap={openMap}/></React.Suspense> : page==='世界档案' ? <React.Suspense fallback={<div className="empty" role="status">正在打开世界档案…</div>}><WorldArchive key={work.worldId} worldId={work.worldId} worldName={work.worldName} categories={worldCategories} entries={worldEntries} characters={all} selectedId={worldEntryId} onSelect={setWorldEntryId} onOpenCharacter={openCharacter} onChanged={refresh}/></React.Suspense> : page==='关系图谱' ? <React.Suspense fallback={<div className="empty" role="status">正在打开关系图谱…</div>}><RelationshipGraph key={work.worldId} worldId={work.worldId} characters={all} templates={templates} types={relationTypes} relations={relations} layout={library.graphLayouts.find(l=>l.worldId===work.worldId)} focusCharacterId={graphFocus?.characterId??null} focusStageId={graphFocus?.stageId} focusRelationId={graphFocus?.relationId} onOpenCharacter={openCharacter} onChanged={refresh}/></React.Suspense> : character ? <CharacterDetail catalogs={<CharacterCatalogLinks library={library} characterId={character.id} onOpen={openCatalog}/>} chapters={library.chapters?.filter(c=>c.workId===work.id)??[]} onOpenChapter={openChapter} initialStageId={characterStage} timelines={library.timelines??[]} onOpenTimeline={openTimeline} worldEntries={worldEntries} onOpenWorld={openWorldEntry} key={`${character.id}:${characterStage??''}`} character={character} templates={templates} relations={relations} relationTypes={relationTypes} characters={all} onRelations={(stageId,relationId)=>{setGraphFocus({characterId:character.id,stageId,relationId});setPage('关系图谱');window.scrollTo(0,0);}} busy={busy} onBack={()=>setSelected(null)} onEdit={tab=>editCharacter(character,tab)} onArchive={()=>setArchiveTarget(character)} onRestore={()=>void archive(character)} onTemplates={()=>setTemplatesOpen(true)} onRefresh={refresh}/> : <>
        <div className="page-head"><div><h1>角色图鉴</h1></div><div className="page-actions"><button className="btn" onClick={() => setTagsOpen(true)}><Icon name="tag"/>配置标签</button><button className="btn" onClick={()=>setTemplatesOpen(true)}><Icon name="radar"/>属性模板</button><button className="btn primary" onClick={() => editCharacter(null)}><Icon name="plus"/>新建角色</button></div></div>
        <div className="library-toolbar"><Input aria-label="搜索角色" placeholder="搜索姓名、化名和标签" value={query} onChange={e=>setQuery(e.target.value)}/><SelectField aria-label="角色状态筛选" value={characterStatus} onValueChange={setCharacterStatus}><option value="">全部状态</option>{[...new Set(all.map(c=>c.status).filter(Boolean))].map(v=><option key={v} value={v}>{v}</option>)}</SelectField><SelectField aria-label="角色标签筛选" value={tag} onValueChange={setTag}><option value="">全部标签</option>{tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</SelectField><SelectField aria-label="角色归档筛选" value={archived?'archived':'active'} onValueChange={v=>setArchived(v==='archived')}><option value="active">使用中</option><option value="archived">已归档</option></SelectField><small>{visible.length} 位角色</small><div className="segmented"><button className={view==='grid'?'active':''} aria-label="图鉴视图" onClick={()=>setView('grid')}><Icon name="grid"/></button><button className={view==='list'?'active':''} aria-label="列表视图" onClick={()=>setView('list')}><Icon name="list"/></button></div></div>
        {visible.length ? <div className={view === 'grid' ? 'cast-grid' : 'panel'}>{visible.map((c,i) => view === 'grid'
          ? <CharacterCard key={c.id} character={c} index={i} templates={templates} onOpen={()=>openCharacter(c.id)}/>
          : <button key={c.id} className="list-row" onClick={() => openCharacter(c.id)}><CharacterImage character={cardPortrait(c)}/><div><h3>{c.name}</h3><p>{c.caption}</p></div><div className="spacer"/><div className="chip-row">{c.tags.map(item => <TagBadge key={item.id} tag={item}/>)}</div><Icon name="arrow"/></button>)}</div>
          : <div className="panel empty"><Icon name="users"/><h3>{query || tag ? '没有匹配的人物' : archived ? '还没有归档人物' : '为故事留下第一个名字'}</h3><p>{query || tag ? '试试其他名称或标签。' : archived ? '归档人物仍保留完整资料，随时可以恢复。' : '从姓名、形象和一段简介开始。'}</p></div>}
        {!archived && <button className="new-character" onClick={() => editCharacter(null)}><Icon name="plus"/>为新的角色留一个位置</button>}
      </>)}
      
    </main></div>
    {editing !== undefined && work && <CharacterEditor character={editing} worldId={work.worldId} tags={tags} templates={templates} defaultTemplateId={attributeDefault?.templateId ?? null} initialTab={editorTab} onClose={() => setEditing(undefined)} onSaved={saved}/>}
    {tagsOpen && work && <TagManager worldId={work.worldId} worldName={work.worldName} tags={tags} characters={all} catalogs={library?[...library.items,...library.techniques,...library.places].filter(r=>r.worldId===work.worldId):[]} onChanged={refresh} onClose={() => setTagsOpen(false)}/>}
    {templatesOpen && work && <AttributeManager worldId={work.worldId} templates={templates} setting={attributeDefault} characters={all} catalogs={library?[...library.items,...library.techniques,...library.places].filter(r=>r.worldId===work.worldId):[]} onChanged={refresh} onClose={()=>setTemplatesOpen(false)}/>}
    <AlertDialog.Root open={Boolean(archiveTarget)} onOpenChange={open => { if (!open && !busy) setArchiveTarget(null); }}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay"/><AlertDialog.Content className="confirm-dialog"><AlertDialog.Title>归档{archiveTarget?.name}？</AlertDialog.Title><AlertDialog.Description>人物资料和立绘会保留，可以在“已归档”列表中恢复。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn" disabled={busy}>取消</AlertDialog.Cancel><button className="btn primary" disabled={busy} onClick={() => archiveTarget && void archive(archiveTarget)}>{busy ? '正在归档…' : '归档人物'}</button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    <AlertDialog.Root open={leaveDraft} onOpenChange={setLeaveDraft}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay"/><AlertDialog.Content className="confirm-dialog"><AlertDialog.Title>修改尚未保存</AlertDialog.Title><AlertDialog.Description>可以继续编辑并保存，或放弃未保存的修改再离开。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn primary">继续编辑</AlertDialog.Cancel><AlertDialog.Action className="btn" onClick={()=>{setDraftDirty(false);const action=pendingNavigation.current;pendingNavigation.current=null;action?.();}}>放弃修改并离开</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    {notice && <div className="save-notice" role="status"><Icon name="check"/>{notice}</div>}
  </div></>;
}

function CharacterEditor({ character,worldId,tags,templates,defaultTemplateId,initialTab,onClose,onSaved }: { character:Character|null;worldId:string;tags:Tag[];templates:AttributeTemplate[];defaultTemplateId:string|null;initialTab:string;onClose:()=>void;onSaved:(character:Character)=>Promise<void> }) {
  const [draft,setDraft] = useState(() => toInput(character,worldId,templates,defaultTemplateId));
  const initial = useRef(JSON.stringify(draft));
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [discard,setDiscard] = useState(false);
  const [tab,setTab] = useState(initialTab);
  const input = draft;
  const dirty = JSON.stringify(input) !== initial.current;
  const update = <K extends keyof CharacterInput>(key: K,value:CharacterInput[K]) => setDraft(current => ({ ...current,[key]:value }));
  const requestClose = () => { if (busy) return; if (dirty) setDiscard(true); else onClose(); };
  const submit = async (event:React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) { setTab('basic'); setError('请填写人物姓名。'); return; }
    setBusy(true); setError('');
    try { await onSaved(unwrap(await window.studio!.saveCharacter(input))); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const pick = async () => {
    setBusy(true); setError('');
    try { const asset=unwrap(await window.studio!.pickPortrait(worldId)); if (asset) setDraft(current => ({...current,portraitId:asset.id,portraitWidth:100})); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const field = (key:'name'|'caption'|'status'|'quote'|'intro'|'body'|'pending'|'abilities',label:string,multiline=false) => <label className="editor-field"><span>{label}</span>{multiline ? <Textarea value={draft[key] ?? ''} onChange={e => update(key,e.target.value)} rows={key === 'body' ? 12 : 4}/>
    : <Input value={draft[key]} onChange={e => update(key,e.target.value)} maxLength={key === 'name' ? 200 : key === 'status' ? 100 : key === 'quote' ? 1000 : 300}/>}</label>;
  return <><Dialog.Root open onOpenChange={open => { if (!open) requestClose(); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="editor-dialog" onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); requestClose(); }}>
    <div className="editor-heading"><div><Dialog.Title>{character ? '编辑档案' : '新建角色'}</Dialog.Title><Dialog.Description>记录这个人的名字、形象与故事。</Dialog.Description></div><button className="icon-button" type="button" aria-label="关闭编辑" onClick={requestClose} disabled={busy}><Icon name="close"/></button></div>
    <form onSubmit={submit} className="editor-form" inert={busy}><Tabs.Root value={tab} onValueChange={setTab} className="editor-layout"><Tabs.List className="editor-nav" aria-label="档案编辑分类"><div className="editor-profile"><CharacterImage character={draft}/><strong>{draft.name || '未命名角色'}</strong><small>{character ? '通用档案' : '新的故事，从这里开始'}</small></div><Tabs.Trigger value="basic">基础资料</Tabs.Trigger><Tabs.Trigger value="fields">自定义字段</Tabs.Trigger><Tabs.Trigger value="attributes">人物属性</Tabs.Trigger><Tabs.Trigger value="story">人物经历</Tabs.Trigger></Tabs.List>
      <div className="editor-panels"><Tabs.Content value="basic"><div className="editor-two">{field('name','姓名 *')}{field('caption','称号 / 副标题')}</div><div className="editor-two">{field('status','设定状态')}{field('quote','人物题记')}</div>
        <fieldset className="tag-selection"><legend>人物标签 <small>可多选 · 已选 {draft.tagIds.length}</small></legend><div className="tag-selection-options">{tags.map(tag => <label key={tag.id} className={`tag-choice ${draft.tagIds.includes(tag.id) ? 'selected' : ''}`}><CheckField  checked={draft.tagIds.includes(tag.id)} onCheckedChange={nextChecked=> update('tagIds',nextChecked ? [...draft.tagIds,tag.id] : draft.tagIds.filter(id => id !== tag.id))}/><i style={{background:tag.color}}/>{tag.name}</label>)}</div><small>请先在“配置标签”中添加标签。</small></fieldset>{field('intro','人物简介',true)}
        <div className="portrait-picker"><div><span>人物特写</span><small>建议使用单人特写；已有拼图可取左侧画面。</small></div><div className="row"><button className="btn small" type="button" disabled={busy} onClick={() => void pick()}><Icon name="image"/>{draft.portraitId ? '更换图片' : '选择图片'}</button><LibraryImageButton worldId={worldId} disabled={busy} onChoose={asset=>setDraft(current=>({...current,portraitId:asset.id,portraitWidth:100}))}/>{draft.portraitId && <button className="btn ghost small" type="button" disabled={busy} onClick={() => update('portraitId',null)}>移除关联</button>}</div></div>
        {draft.portraitId && <div className="portrait-framing"><div className="framing-preview"><CharacterImage character={draft}/></div><div><div className="row"><button type="button" className={`btn small ${(draft.portraitWidth ?? 100) === 100 ? 'primary' : ''}`} onClick={() => update('portraitWidth',100)}>单人图片</button><button type="button" className={`btn small ${(draft.portraitWidth ?? 100) < 100 ? 'primary' : ''}`} onClick={() => update('portraitWidth',29.5)}>左侧特写</button></div><label className="framing-slider">取景宽度 <span>{draft.portraitWidth ?? 100}%</span><Input type="range" aria-label="特写取景宽度" min={15} max={100} step={0.5} value={draft.portraitWidth ?? 100} onChange={e => update('portraitWidth',Number(e.target.value))}/></label><small>调整显示范围，原始图片保留。</small></div></div>}
        <ImageField onBusyChange={setBusy} worldId={worldId} label="人物设定图" value={draft.designImageId??null} onChange={id=>update('designImageId',id)}/>
      </Tabs.Content><Tabs.Content value="fields"><div className="between field-section-head"><div><h3>自定义字段</h3><p>按需要添加身份、性格、出身等文字字段。</p></div><button className="btn small" type="button" onClick={() => update('facts',[...draft.facts,{ id:crypto.randomUUID(),label:'',value:'' }])}><Icon name="plus"/>添加字段</button></div>
        {draft.facts.map((fact,index) => <div className="fact-editor-row" key={fact.id}><label className="editor-field"><span>字段名称 {index+1}</span><Input value={fact.label} maxLength={100} onChange={e => update('facts',draft.facts.map(item => item.id === fact.id ? { ...item,label:e.target.value } : item))}/></label><label className="editor-field"><span>内容</span><Textarea rows={2} value={fact.value} onChange={e => update('facts',draft.facts.map(item => item.id === fact.id ? { ...item,value:e.target.value } : item))}/></label><button className="icon-button" type="button" aria-label={`移除字段 ${fact.label || index+1}`} onClick={() => update('facts',draft.facts.filter(item => item.id !== fact.id))}><Icon name="close"/></button></div>)}
        {!draft.facts.length && <div className="empty"><p>还没有自定义字段，点击“添加字段”开始。</p></div>}
      </Tabs.Content><Tabs.Content value="attributes"><AttributeFields templates={templates} value={draft.attributes ?? blankAttributes()} onChange={value=>update('attributes',value)}/></Tabs.Content><Tabs.Content value="story">{field('body','人物底色与经历',true)}{field('abilities','基础能力',true)}{field('pending','待讨论 / 未确定的内容',true)}</Tabs.Content></div>
    </Tabs.Root>{error && <div className="editor-error" role="alert">{error}</div>}<div className="editor-footer"><small>{busy ? '正在处理…' : dirty ? '有尚未保存的修改' : ''}</small><button className="btn" type="button" onClick={requestClose} disabled={busy}>取消</button><button className="btn primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存档案'}</button></div></form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
    <AlertDialog.Root open={discard} onOpenChange={setDiscard}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay nested-overlay"/><AlertDialog.Content className="confirm-dialog nested-dialog"><AlertDialog.Title>保留正在编辑的内容？</AlertDialog.Title><AlertDialog.Description>当前修改尚未保存。关闭编辑会放弃这些修改。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn primary">继续编辑</AlertDialog.Cancel><AlertDialog.Action className="btn" onClick={onClose}>放弃修改</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </>;
}
