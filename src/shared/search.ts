import type {LibrarySnapshot} from './types.ts';
export const searchKinds={character:'角色',item:'物品',technique:'功法',place:'地点',entry:'世界档案',chapter:'章节',map:'地图',timeline:'年表',media:'素材',relation:'关系',work:'作品',world:'世界'} as const;
export interface SearchHit {kind:keyof typeof searchKinds;id:string;childId?:string;name:string;worldId:string;workId?:string;context:string;excerpt:string;archived:boolean;text:string}
function prose(value:unknown,key=''):string {
  if(/(^id$|Ids?$|At$|color|mime|fileName|sourceName)/i.test(key))return '';
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(v=>prose(v)).join('\n');
  if(value&&typeof value==='object')return Object.entries(value).map(([k,v])=>prose(v,k)).filter(Boolean).join('\n');
  return '';
}
export function searchLibrary(s:LibrarySnapshot,query:string,kind='',includeArchived=false):SearchHit[]{
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return [];
  const hits:SearchHit[]=[];
  const add=(type:SearchHit['kind'],r:{id:string;name:string;worldId:string;workId?:string;archived?:boolean},body:unknown=r,extra:Partial<SearchHit>={})=>{
    const work=s.works.find(w=>w.id===r.workId),archived=Boolean(r.archived||work?.archived);
    if(kind&&type!==kind||!includeArchived&&archived)return;
    const text=[r.name,prose(body)].join('\n'),lower=text.toLocaleLowerCase();if(!terms.every(t=>lower.includes(t)))return;
    const index=Math.max(0,lower.indexOf(terms[0])-25);
    hits.push({kind:type,id:r.id,name:r.name,worldId:r.worldId,workId:r.workId,context:[s.worlds.find(w=>w.id===r.worldId)?.name,work?.name].filter(Boolean).join(' / '),excerpt:text.slice(index,index+180).replace(/\s+/g,' '),archived,text,...extra});
  };
  for(const c of s.characters)add('character',c,{...c,tags:c.tags.map(t=>t.name)});
  for(const r of [...s.items,...s.techniques,...s.places])add(r.kind,r,{...r,tags:s.tags.filter(t=>r.tagIds.includes(t.id)).map(t=>t.name)});
  for(const e of s.worldEntries)add('entry',e);
  for(const c of s.chapters)add('chapter',c);
  for(const m of s.maps){add('map',m,{name:m.name,description:m.description});for(const l of m.locations)add('map',{...l,worldId:m.worldId,archived:m.archived||l.archived},l,{id:m.id,childId:l.id,context:(s.worlds.find(w=>w.id===m.worldId)?.name??'')+' / '+m.name});}
  for(const t of s.timelines){add('timeline',t,{name:t.name,description:t.description});for(const e of t.events)add('timeline',{...e,worldId:t.worldId,archived:t.archived||e.archived},e,{id:t.id,childId:e.id,context:(s.worlds.find(w=>w.id===t.worldId)?.name??'')+' / '+t.name});}
  for(const a of s.media)add('media',a);
  for(const r of s.relations){const name=r.label||s.relationTypes.find(t=>t.id===r.typeId)?.name||'人物关系';add('relation',{...r,name},{...r,name,people:[r.sourceId,r.targetId].map(id=>s.characters.find(c=>c.id===id)?.name)});}
  for(const w of s.works)add('work',{...w,workId:w.id},{...w,dashboard:s.dashboards.find(d=>d.workId===w.id),outline:s.outlines.find(o=>o.workId===w.id)});
  for(const w of s.worlds)add('world',{...w,worldId:w.id});
  return hits.sort((a,b)=>Number(b.name.toLocaleLowerCase().includes(terms[0]))-Number(a.name.toLocaleLowerCase().includes(terms[0]))||a.name.localeCompare(b.name,'zh-CN'));
}
