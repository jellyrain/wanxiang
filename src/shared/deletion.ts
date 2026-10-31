import type { LibrarySnapshot } from './types.ts';

export const deletionKinds={item:'物品',technique:'功法',place:'地点',work:'作品',world:'世界',character:'人物',identity:'人物身份',form:'人物形态',stage:'人物阶段',relation:'人物关系',relationType:'关系类型',worldEntry:'世界条目',worldCategory:'世界分类',map:'地图',location:'地图地点',mapStage:'地图节点',timeline:'年表',event:'年表事件',era:'年代',chapter:'章节',volume:'分卷',media:'素材',mediaCategory:'素材分类',mediaTag:'素材标签',tag:'人物标签',attributeTemplate:'属性模板'} as const;
export type DeletionKind=keyof typeof deletionKinds;
export interface DeletionTarget {kind:DeletionKind;id:string;parentId?:string}
export interface DeletionItem extends DeletionTarget {name:string;worldId:string;workId?:string;scope:string}
export interface DeletionPreview {token:string;expiresAt:string;target:DeletionItem;included:DeletionItem[];blockers:string[];notes:string[]}
export const deletionKey=(t:DeletionTarget)=>JSON.stringify([t.kind,t.parentId??'',t.id]);
export function deletionItems(s:LibrarySnapshot):DeletionItem[]{
  const items:DeletionItem[]=[];
  const add=(kind:DeletionKind,rows:{id:string;name?:string;label?:string;worldId:string;workId?:string}[])=>rows.forEach(v=>items.push({kind,id:v.id,name:v.name||v.label||deletionKinds[kind],worldId:v.worldId,workId:v.workId,scope:s.works.find(w=>w.id===v.workId)?.name??s.worlds.find(w=>w.id===v.worldId)?.name??''}));
  add('world',s.worlds.map(w=>({...w,worldId:w.id})));add('work',s.works.map(w=>({...w,workId:w.id})));
  add('item',s.items??[]);add('technique',s.techniques??[]);add('place',s.places??[]);add('character',s.characters);add('relation',s.relations);add('relationType',s.relationTypes);add('worldEntry',s.worldEntries);add('worldCategory',s.worldCategories);add('map',s.maps);add('timeline',s.timelines);add('chapter',s.chapters);add('media',s.media);add('tag',s.tags);add('attributeTemplate',s.attributeTemplates);
  const nested=(kind:DeletionKind,rows:{id:string;name:string}[],parent:{id:string;name:string;worldId:string;workId?:string})=>rows.forEach(v=>items.push({kind,id:v.id,name:v.name,parentId:parent.id,worldId:parent.worldId,workId:parent.workId,scope:parent.name}));
  for(const c of s.characters){nested('identity',c.identities,c);nested('form',c.forms.filter(f=>f.id!=='base'),c);nested('stage',c.stages,c);}
  for(const m of s.maps){nested('location',m.locations,m);nested('mapStage',m.stages,m);}
  for(const t of s.timelines){nested('event',t.events,t);nested('era',t.eras,t);}
  for(const o of s.outlines)nested('volume',o.volumes,{...o,id:o.workId,name:s.works.find(w=>w.id===o.workId)?.name??'作品'});
  for(const c of s.mediaCatalogs){const p={id:c.worldId,worldId:c.worldId,name:s.worlds.find(w=>w.id===c.worldId)?.name??'世界'};nested('mediaCategory',c.categories,p);nested('mediaTag',c.tags,p);}
  return items;
}

/** Explicit typed references: prose containing an ID is never treated as a link. */
export function deletionBlockers(s:LibrarySnapshot,t:DeletionItem,included:DeletionItem[]):string[]{
  const gone=new Set(included.map(deletionKey)),out=new Set<string>();
  const hit=(owner:DeletionTarget,label:string,yes:boolean)=>{if(yes&&!gone.has(deletionKey(owner)))out.add(label);};
  const is=(kind:DeletionKind,id:string|null|undefined,parentId?:string)=>t.kind===kind&&t.id===id&&(!parentId||t.parentId===parentId);
  const participants=(p:{characterId:string;stageId:string|null}[])=>p.some(v=>is('character',v.characterId)||is('stage',v.stageId,v.characterId));
  const progress=(p:{mapId:string;stageId:string}[])=>p.some(v=>is('map',v.mapId)||is('mapStage',v.stageId,v.mapId));
  const attrs=(a:{templateId:string|null;values:Record<string,unknown>})=>is('attributeTemplate',a.templateId)||(t.kind==='attributeTemplate'&&Object.hasOwn(a.values,t.id));
  for(const r of [...s.items??[],...s.techniques??[],...s.places??[]])hit({kind:r.kind,id:r.id},r.name,is('media',r.imageId)||is('media',r.designImageId)||r.tagIds.some(id=>is('tag',id))||attrs(r.attributes)||r.entryIds.some(v=>is('worldEntry',v))||(r.kind==='item'?r.holders.some(h=>is('character',h.characterId)):r.kind==='technique'?r.practitioners.some(p=>is('character',p.characterId)):r.characterIds.some(v=>is('character',v))||r.positions.some(p=>is('map',p.mapId)||is('location',p.locationId,p.mapId))));
  for(const c of s.characters){
    hit({kind:'character',id:c.id},`人物：${c.name}`,is('media',c.designImageId)||is('media',c.portraitId)||c.tags.some(v=>is('tag',v.id))||attrs(c.attributes)||c.forms.some(f=>is('media',f.portraitId)||attrs(f.attributes)));
    for(const st of c.stages)hit({kind:'stage',id:st.id,parentId:c.id},`人物阶段：${c.name} / ${st.name}`,is('media',st.snapshot.profile.designImageId)||is('media',st.snapshot.profile.portraitId)||st.snapshot.forms.some(f=>is('media',f.portraitId)));
  }
  for(const r of s.relations)hit({kind:'relation',id:r.id},`人物关系：${r.label||r.id}`,is('character',r.sourceId)||is('character',r.targetId)||is('stage',r.sourceStageId,r.sourceId)||is('stage',r.targetStageId,r.targetId)||is('relationType',r.typeId));
  for(const e of s.worldEntries)hit({kind:'worldEntry',id:e.id},`世界条目：${e.name}`,is('worldCategory',e.categoryId)||is('media',e.imageId)||e.links.some(l=>is(l.kind==='entry'?'worldEntry':'character',l.targetId)));
  for(const m of s.maps){
    hit({kind:'map',id:m.id},`地图：${m.name}`,is('media',m.backgroundId));
    for(const l of m.locations)hit({kind:'location',id:l.id,parentId:m.id},`地点：${m.name} / ${l.name}`,is('mapStage',l.unlockStageId,m.id)||is('media',l.imageId)||l.entryIds.some(id=>is('worldEntry',id))||l.characterIds.some(id=>is('character',id)));
  }
  for(const tl of s.timelines)for(const e of tl.events)hit({kind:'event',id:e.id,parentId:tl.id},`年表事件：${tl.name} / ${e.name}`,participants(e.participants)||progress(e.mapProgress)||is('era',e.eraId,tl.id)||e.entryIds.some(id=>is('worldEntry',id))||e.places.some(p=>is('map',p.mapId)||is('location',p.locationId,p.mapId)));
  for(const c of s.chapters)hit({kind:'chapter',id:c.id},`章节：${c.name}`,participants(c.participants)||progress(c.mapProgress)||is('volume',c.volumeId,c.workId)||c.entryIds.some(id=>is('worldEntry',id))||c.events.some(e=>is('timeline',e.timelineId)||is('event',e.eventId,e.timelineId)));
  for(const a of s.media)hit({kind:'media',id:a.id},`素材：${a.name}`,is('mediaCategory',a.categoryId,a.worldId)||a.tagIds.some(id=>is('mediaTag',id,a.worldId)));
  for(const d of s.dashboards)hit({kind:'work',id:d.workId},`作品封面：${s.works.find(w=>w.id===d.workId)?.name}`,is('media',d.coverId));
  if(t.kind==='mapStage'&&s.maps.find(m=>m.id===t.parentId)!.stages.length===1)out.add('地图至少需要保留一个剧情节点。');
  if(t.kind==='era'&&s.timelines.find(v=>v.id===t.parentId)!.eras.length===1)out.add('年表至少需要保留一个年代。');
  return [...out];
}
