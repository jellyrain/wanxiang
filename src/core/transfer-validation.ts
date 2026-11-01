import {ContentError,type LibraryStore,type Database} from './store.ts';
import {quote,type BackupRow} from './backup-journal.ts';

const invalid=(message='资料包中的内容或关联无效。'):never=>{throw new ContentError('VALIDATION',message);};
/** Validate on an in-memory reconstruction. All normal writes below are rolled
 * back individually so validation cannot bump versions seen by later checks. */
export function validateTransferSnapshot(store:LibraryStore,db:Database,rows:{table:string;row:BackupRow}[]) {
  for(const {table,row} of rows){
    for(const [column,value] of Object.entries(row))if(column.endsWith('_json')&&typeof value==='string'){
      const v=JSON.parse(value);
      if(!v||typeof v!=='object')invalid();
      if(!Array.isArray(v)&&column!=='source_json'){
        const matches:Record<string,unknown>={worldId:row.world_id,workId:row.work_id,id:typeof row.id==='string'?row.id:row.asset_id};
        for(const [field,expected] of Object.entries(matches))if(expected!==undefined&&v[field]!==undefined&&v[field]!==expected)invalid('资料包的编号与内容不一致。');
      }
    }
  }
  const original=store.snapshot();
  // Archived targets remain archived in the imported package; the temporary
  // validation view makes them editable to exercise the regular save rules.
  db.exec('UPDATE characters SET archived=0; UPDATE work_settings SET archived=0;');
  for(const [table,column] of [['catalog_items','record_json'],['catalog_techniques','record_json'],['catalog_places','record_json'],['world_entries','entry_json'],['world_maps','map_json'],['world_timelines','timeline_json'],['chapters','chapter_json'],['character_relations','relation_json']])
    db.exec(`UPDATE ${quote(table)} SET ${quote(column)}=json_set(${quote(column)},'$.archived',json('false'))`);
  const snapshot=store.snapshot();
  const check=(fn:()=>unknown)=>{db.exec('SAVEPOINT transfer_validation');try{fn();}finally{db.exec('ROLLBACK TO transfer_validation; RELEASE transfer_validation');}};
  const world=(id:string)=>snapshot.worlds.some(w=>w.id===id)||invalid('资料包缺少所属世界。');
  const image=(id:string|null,worldId:string)=>!id||snapshot.media.some(m=>m.id===id&&m.worldId===worldId)||invalid('资料包的图片引用无效。');
  for(const r of [...snapshot.items,...snapshot.techniques,...snapshot.places])check(()=>store.catalogs.save(r.kind,{...r,expectedVersion:r.version}));
  for(const c of snapshot.libraryConfigs)check(()=>store.config.save({...c,expectedVersion:c.version}));
  for(const w of snapshot.worlds)check(()=>store.workspace.saveWorld({...w,expectedVersion:w.version}));
  for(const w of snapshot.works)check(()=>store.workspace.saveWork({...w,expectedVersion:w.version}));
  for(const t of snapshot.tags)check(()=>store.saveTag({...t,expectedVersion:t.version}));
  for(const t of snapshot.attributeTemplates)check(()=>store.saveAttributeTemplate({...t,expectedVersion:t.version,expectedDefaultVersion:snapshot.attributeDefaults.find(d=>d.worldId===t.worldId)?.version??0,makeDefault:false}));
  for(const c of snapshot.characters){
    check(()=>store.saveCharacter({...c,expectedVersion:c.version,tagIds:c.tags.map(t=>t.id)}));
    check(()=>store.saveCharacterVariants({characterId:c.id,expectedVersion:c.version,identities:c.identities,forms:c.forms,defaultFormId:c.defaultFormId}));
    if(!Array.isArray(c.stages)||c.stages.length>100)invalid();
    for(const s of c.stages){
      if(typeof s.name!=='string'||typeof s.period!=='string'||typeof s.summary!=='string'||!s.snapshot||!Array.isArray(s.snapshot.forms)||!Array.isArray(s.snapshot.identities)||!s.snapshot.profile||!Array.isArray(s.snapshot.profile.tags)||!Array.isArray(s.snapshot.profile.facts))invalid('人物阶段内容不完整。');
      image(s.snapshot.profile.portraitId,c.worldId);image(s.snapshot.profile.designImageId??null,c.worldId);
      for(const form of s.snapshot.forms){image(form.portraitId,c.worldId);if(!Array.isArray(form.attributeSchemas))invalid('阶段属性定义不完整。');}
    }
  }
  for(const t of snapshot.relationTypes)check(()=>store.graph.saveType({...t,expectedVersion:t.version}));
  for(const r of snapshot.relations)check(()=>store.graph.saveRelation({...r,expectedVersion:r.version,expectedTypeVersion:snapshot.relationTypes.find(t=>t.id===r.typeId)?.version??-1}));
  for(const c of snapshot.worldCategories)check(()=>store.world.saveCategory({...c,expectedVersion:c.version}));
  for(const e of snapshot.worldEntries)check(()=>store.world.saveEntry({...e,expectedVersion:e.version,expectedCategoryVersion:snapshot.worldCategories.find(c=>c.id===e.categoryId)?.version??-1}));
  for(const m of snapshot.maps)check(()=>store.maps.save({...m,expectedVersion:m.version}));
  for(const t of snapshot.timelines)check(()=>store.timeline.save({...t,expectedVersion:t.version}));
  for(const c of snapshot.mediaCatalogs)check(()=>store.gallery.saveCatalog({...c,expectedVersion:c.version}));
  for(const m of snapshot.media){
    world(m.worldId);if(!['image/png','image/jpeg','image/webp'].includes(m.mime))invalid('图片格式无效。');
    // Metadata saves allow retained archived media; restore only in validation.
    check(()=>{if(m.archived)store.gallery.archive(m.id,m.version,false);const current=store.gallery.get(m.id);store.gallery.save({...current,expectedVersion:current.version});});
  }
  for(const d of snapshot.dashboards)check(()=>store.dashboard.save({...d,expectedVersion:d.version}));
  for(const o of snapshot.outlines){world(o.worldId);if(store.workspace.getWork(o.workId).worldId!==o.worldId)invalid();check(()=>store.chapters.saveOutline({...o,expectedVersion:o.version}));}
  for(const c of snapshot.chapters){if(store.workspace.getWork(c.workId).worldId!==c.worldId)invalid();check(()=>store.chapters.save({...c,expectedVersion:c.version,expectedOutlineVersion:store.chapters.getOutline(c.workId).version}));}
  for(const g of snapshot.graphLayouts)check(()=>store.graph.saveLayout({...g,expectedVersion:g.version}));
  // Every work with chapters must have a complete, explicit directory.
  for(const w of snapshot.works){const o=store.chapters.getOutline(w.id),cs=snapshot.chapters.filter(c=>c.workId===w.id);if(o.chapterIds.length!==cs.length||cs.some(c=>!o.chapterIds.includes(c.id)))invalid('资料包章节目录不完整。');}
  const entities=new Set<string>([...original.items,...original.techniques,...original.places,...original.worlds,...original.works,...original.characters,...original.worldEntries,...original.worldCategories,...original.maps,...original.timelines,...original.chapters,...original.media,...original.relations,...original.relationTypes].map(e=>e.id));
  for(const {table,row} of rows)if(table.endsWith('_history')||table==='revisions'){
    if(!entities.has(String(row.entity_id??row.character_id)))invalid('资料包的历史记录缺少所属资料。');
    const v=JSON.parse(String(row.snapshot_json));if(!v||typeof v!=='object'||Array.isArray(v)||!Number.isSafeInteger(row.version)||Number(row.version)<1)invalid('资料包历史记录无效。');
  }
}
