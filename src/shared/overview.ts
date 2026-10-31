import type { Work, WorkDashboard, WorkDashboardInput, LibrarySnapshot } from './types.ts';
import { textCount } from './chapters.ts';
export const workPhases={worldbuilding:'设定构建中',outlining:'大纲整理中',writing:'正文创作中',revising:'全书修订中',completed:'已完结'} as const;
export type OverviewTarget={kind:'character'|'entry'|'map'|'timeline'|'chapter'|'media'|'relations';id:string;eventId?:string};
export type OverviewRecord=OverviewTarget&{title:string;detail:string;updatedAt:string};
export function blankDashboard(work:Pick<Work,'id'|'worldId'>):WorkDashboard {
  return {workId:work.id,worldId:work.worldId,description:'',genre:'',phase:'worldbuilding',coverId:null,coverFlip:false,targetCharacters:null,memo:'',tasks:[],version:0,updatedAt:''};
}
export function dashboardInput(d:WorkDashboard):WorkDashboardInput {
  const {workId,description,genre,phase,coverId,coverFlip=false,targetCharacters,memo,tasks,version}=d;
  return structuredClone({workId,description,genre,phase,coverId,coverFlip,targetCharacters,memo,tasks,expectedVersion:version});
}
export function overviewData(library:LibrarySnapshot,work:Work) {
  const characters=library.characters.filter(c=>c.worldId===work.worldId&&!c.archived),entries=library.worldEntries.filter(e=>e.worldId===work.worldId&&!e.archived),maps=library.maps.filter(m=>m.worldId===work.worldId&&!m.archived),relations=library.relations.filter(r=>r.worldId===work.worldId&&!r.archived),timelines=library.timelines.filter(t=>t.worldId===work.worldId&&!t.archived),chapters=library.chapters.filter(c=>c.workId===work.id&&!c.archived),media=(library.media??[]).filter(m=>m.worldId===work.worldId&&!m.archived);
  const events=timelines.flatMap(t=>t.events.filter(e=>!e.archived).map(e=>({timeline:t,event:e})));
  const wordCount=chapters.reduce((n,c)=>n+textCount(c.body),0),finished=chapters.filter(c=>c.status==='finished').length;
  const recent:OverviewRecord[]=[
    ...characters.map(c=>({kind:'character' as const,id:c.id,title:c.name,detail:'人物档案',updatedAt:c.updatedAt})),
    ...entries.map(e=>({kind:'entry' as const,id:e.id,title:e.name,detail:'世界档案',updatedAt:e.updatedAt})),
    ...maps.map(m=>({kind:'map' as const,id:m.id,title:m.name,detail:'地图探索',updatedAt:m.updatedAt})),
    ...timelines.map(t=>({kind:'timeline' as const,id:t.id,title:t.name,detail:'历史年表',updatedAt:t.updatedAt})),
    ...chapters.map(c=>({kind:'chapter' as const,id:c.id,title:c.name,detail:'剧情与章节',updatedAt:c.updatedAt})),
    ...media.map(m=>({kind:'media' as const,id:m.id,title:m.name,detail:'素材画廊',updatedAt:m.updatedAt||m.importedAt})),
    ...relations.map(r=>({kind:'relations' as const,id:r.id,title:r.label||library.relationTypes.find(t=>t.id===r.typeId)?.name||'人物关系',detail:'关系图谱',updatedAt:r.updatedAt}))
  ].filter(r=>Number.isFinite(Date.parse(r.updatedAt))).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
  const pending:OverviewRecord[]=[
    ...characters.filter(c=>c.pending.trim()).map(c=>({kind:'character' as const,id:c.id,title:c.name,detail:'人物仍有待定内容',updatedAt:c.updatedAt})),
    ...entries.filter(e=>e.status==='pending'||e.pending.trim()).map(e=>({kind:'entry' as const,id:e.id,title:e.name,detail:'设定待确认',updatedAt:e.updatedAt})),
    ...relations.filter(r=>r.status==='pending').map(r=>({kind:'relations' as const,id:r.id,title:r.label||'人物关系',detail:'关系待确认',updatedAt:r.updatedAt})),
    ...events.filter(({event:e})=>e.status==='pending').map(({timeline:t,event:e})=>({kind:'timeline' as const,id:t.id,eventId:e.id,title:e.name,detail:'事件待确认',updatedAt:t.updatedAt}))
  ];
  const sortedChapters=[...chapters].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
  return {characters,entries,maps,relations,events,chapters,media,wordCount,finished,locations:maps.reduce((n,m)=>n+m.locations.filter(l=>!l.archived).length,0),recent,pending,resume:sortedChapters[0]??null};
}
