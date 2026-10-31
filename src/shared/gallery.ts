import type { LibrarySnapshot, MediaAsset, MediaInput, MediaCatalog, MediaCatalogInput } from './types.ts';
export type MediaUse={assetId:string;kind:'character'|'entry'|'map'|'cover'|'item'|'technique'|'place';targetId:string;title:string;detail:string;archived:boolean;stageId?:string;locationId?:string};
export function mediaInput(media:MediaAsset):MediaInput {
  const {id,version,name,description,source,prompt,categoryId,tagIds,favorite}=media;
  return structuredClone({id,expectedVersion:version,name,description,source,prompt,categoryId,tagIds,favorite});
}
export function emptyMediaCatalog(worldId:string):MediaCatalog {return {worldId,categories:[],tags:[],version:0,updatedAt:''};}
export function mediaCatalogInput(c:MediaCatalog):MediaCatalogInput {return structuredClone({worldId:c.worldId,categories:c.categories,tags:c.tags,expectedVersion:c.version});}
export function mediaUses(library:LibrarySnapshot,worldId:string):Map<string,MediaUse[]> {
  const uses=new Map<string,MediaUse[]>(),known=new Set((library.media??[]).filter(a=>a.worldId===worldId).map(a=>a.id));
  const add=(assetId:string|null,use:Omit<MediaUse,'assetId'>)=>{if(!assetId||!known.has(assetId))return;const list=uses.get(assetId)??[];list.push({assetId,...use});uses.set(assetId,list);};
  for(const r of [...library.items??[],...library.techniques??[],...library.places??[]].filter(r=>r.worldId===worldId))add(r.imageId,{kind:r.kind,targetId:r.id,title:r.name,detail:r.kind==='item'?'物品图片':r.kind==='technique'?'功法图片':'地点图片',archived:r.archived});
  for(const r of [...library.items,...library.techniques,...library.places].filter(r=>r.worldId===worldId))add(r.designImageId,{kind:r.kind,targetId:r.id,title:r.name,detail:'设定图',archived:r.archived});
  for(const c of library.characters.filter(c=>c.worldId===worldId)) {
    add(c.designImageId,{kind:'character',targetId:c.id,title:c.name,detail:'人物设定图',archived:c.archived});
    add(c.portraitId,{kind:'character',targetId:c.id,title:c.name,detail:'基础档案图片',archived:c.archived});
    for(const f of c.forms)if(f.portraitMode==='custom')add(f.portraitId,{kind:'character',targetId:c.id,title:c.name,detail:`形态 · ${f.name}${f.active?'':'（已停用）'}`,archived:c.archived});
    for(const s of c.stages){
      add(s.snapshot.profile.designImageId??null,{kind:'character',targetId:c.id,title:c.name,detail:`阶段 · ${s.name} · 设定图`,archived:c.archived||s.archived,stageId:s.id});
      const images=new Map<string,string[]>();
      for(const f of s.snapshot.forms){if(f.portraitId)images.set(f.portraitId,[...(images.get(f.portraitId)??[]),f.name]);}
      if(s.snapshot.profile.portraitId&&!images.has(s.snapshot.profile.portraitId))images.set(s.snapshot.profile.portraitId,['基础档案']);
      for(const [id,names] of images)add(id,{kind:'character',targetId:c.id,title:c.name,detail:`阶段 · ${s.name} · ${names.join('、')}`,archived:c.archived||s.archived,stageId:s.id});
    }
  }
  for(const e of library.worldEntries.filter(e=>e.worldId===worldId))add(e.imageId,{kind:'entry',targetId:e.id,title:e.name,detail:'世界档案图片',archived:e.archived});
  for(const m of library.maps.filter(m=>m.worldId===worldId)){
    add(m.backgroundId,{kind:'map',targetId:m.id,title:m.name,detail:'地图底图',archived:m.archived});
    for(const l of m.locations)add(l.imageId,{kind:'map',targetId:m.id,title:l.name,detail:`地点 · ${m.name}`,archived:m.archived||l.archived,locationId:l.id});
  }
  for(const d of library.dashboards??[])if(d.worldId===worldId)add(d.coverId,{kind:'cover',targetId:d.workId,title:library.works.find(w=>w.id===d.workId)?.name??'作品',detail:'作品概览封面',archived:false});
  return uses;
}
export function mediaSearchText(media:MediaAsset,catalog:MediaCatalog,uses:MediaUse[]=[]):string {
  return [media.name,media.sourceName,media.description,media.source,media.prompt,catalog.categories.find(c=>c.id===media.categoryId)?.name,...catalog.tags.filter(t=>media.tagIds.includes(t.id)).map(t=>t.name),...uses.flatMap(u=>[u.title,u.detail])].join('\n').toLowerCase();
}
export function formatBytes(bytes:number|null):string {if(bytes===null)return '原图';return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;}
