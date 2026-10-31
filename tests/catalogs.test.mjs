import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import DB from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {blankCatalog} from '../src/shared/catalogs.ts';
import {contentCommands} from '../src/core/commands.ts';
import {BackupService} from '../src/core/backups.ts';
import {digest} from '../src/core/backup-journal.ts';
import {schemaFingerprint} from '../src/core/schema-format.ts';
import {openProtectedLibrary,listProtectionPoints,verifyProtectionPoint} from '../src/core/upgrade-protection.ts';
import {LIBRARY_SCHEMA,LIBRARY_FORMAT_VERSION} from '../src/core/library-version.ts';

const root=resolve('test-results/catalog-tests');mkdirSync(root,{recursive:true});
function fixture(t){
  const directory=mkdtempSync(join(root,'case-')),db=new DB(join(directory,'library.sqlite')),store=new LibraryStore(db,directory);
  const work=store.workspace.createWork({name:'测试作品',world:{kind:'new',name:'测试世界',description:''}});
  const character=store.saveCharacter({worldId:work.worldId,expectedVersion:0,name:'沈墨',caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null});
  const map=store.maps.save({worldId:work.worldId,name:'山门',description:'',backgroundId:null,stages:[{id:'start',name:'开篇'}],locations:[{id:'hall',name:'演武场',kind:'场地',description:'',unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false,x:10,y:20}],terrain:[],expectedVersion:0});
  t.after(()=>{if(db.open)store.close();});return {directory,db,store,work,character,map};
}
function populate(f){const {store:s,work:w,character:c,map:m}=f;
  const item=s.catalogs.save('item',{...blankCatalog('item',w.worldId),name:'墨剑',body:'# 纹路\n\n**灵墨**',holders:[{id:'holding',characterId:c.id,quantity:1,state:'equipped',notes:'随身'}]});
  const technique=s.catalogs.save('technique',{...blankCatalog('technique',w.worldId),name:'墨心诀',levels:'初成 / 大成',practitioners:[{id:'practice',characterId:c.id,progress:'第二层',state:'learning',notes:''}]});
  const place=s.catalogs.save('place',{...blankCatalog('place',w.worldId),name:'演武场',placeType:'场地',characterIds:[c.id],positions:[{mapId:m.id,locationId:'hall'}]});
  return {item,technique,place};
}
test('三类独立资料经 AI 命令保存、修改、重开；世界档案不增加条目',t=>{
  const f=fixture(t),{store:s}=f,records=populate(f),commands=contentCommands(s);
  assert.equal(s.snapshot().worldEntries.length,0);
  for(const [kind,r] of Object.entries(records)){const cap=kind[0].toUpperCase()+kind.slice(1);const saved=commands.invoke('save'+cap,[{...r,expectedVersion:r.version,summary:'修订摘要'}],s.snapshot().generation);assert.equal(saved.version,2);const archived=commands.invoke('archive'+cap,[r.id,2,true],s.snapshot().generation);assert.equal(archived.archived,true);assert.throws(()=>commands.invoke('save'+cap,[{...r,expectedVersion:3}],s.snapshot().generation),{code:'VALIDATION'});commands.invoke('archive'+cap,[r.id,3,false],s.snapshot().generation);}
  const before=s.snapshot();s.close();const db=new DB(join(f.directory,'library.sqlite'));try{const reopened=new LibraryStore(db,f.directory);assert.deepEqual(reopened.snapshot(),before);}finally{db.close();}
});
test('版本冲突、错误类型、跨世界引用、负数量和重复人物均不产生半份保存',t=>{
  const f=fixture(t),r=populate(f).item,s=f.store,before=s.snapshot(),sequence=s.journal.sequence();
  const w=s.workspace.createWork({name:'另一部',world:{kind:'new',name:'异界',description:''}}),c=s.saveCharacter({...f.character,id:undefined,worldId:w.worldId,tagIds:[],expectedVersion:0});
  const edits=[{expectedVersion:0},{kind:'place'},{holders:[{...r.holders[0],quantity:-1}]},{holders:[{...r.holders[0],characterId:c.id}]},{holders:[r.holders[0],{...r.holders[0],id:'another'}]},{imageId:'missing'},{entryIds:['missing']}];
  const current=s.journal.sequence();
  for(const change of edits){assert.throws(()=>s.catalogs.save('item',{...r,expectedVersion:r.version,...change}),e=>['CONFLICT','VALIDATION'].includes(e.code));assert.deepEqual(s.catalogs.get('item',r.id),r);assert.equal(s.journal.sequence(),current);}
  assert.ok(current>sequence);assert.equal(before.items.length,1);
  assert.throws(()=>s.catalogs.save('place',{...blankCatalog('place',f.work.worldId),name:'悬空地点',positions:[{mapId:f.map.id,locationId:'missing'}]}),{code:'VALIDATION'});
});
test('保留已归档关联可继续编辑，新增归档关联被拒绝',t=>{
  const f=fixture(t),{item}=populate(f),s=f.store;
  s.archiveCharacter(f.character.id,f.character.version,true);
  assert.equal(s.catalogs.save('item',{...item,expectedVersion:item.version,summary:'保留持有人'}).version,2);
  assert.throws(()=>s.catalogs.save('item',{...blankCatalog('item',f.work.worldId),name:'新物品',holders:item.holders}),{code:'VALIDATION'});
});
test('历史预览不写入，确认生成新版本并恢复持有、修习和地图关联',t=>{
  const f=fixture(t),records=populate(f),s=f.store;
  for(const [kind,r] of Object.entries(records)){
    const next=s.catalogs.save(kind,{...r,expectedVersion:1,body:'修改后',...(kind==='item'?{holders:[]}:kind==='technique'?{practitioners:[]}:{positions:[],characterIds:[]})});
    const seq=s.journal.sequence(),preview=s.history.preview({kind,entityId:r.id,version:1});assert.equal(s.journal.sequence(),seq);assert.equal(s.catalogs.get(kind,r.id).version,next.version);
    const restored=s.history.restore({token:preview.token});assert.equal(restored.version,3);assert.equal(s.catalogs.get(kind,r.id).body,r.body);assert.equal(s.history.list({kind,entityId:r.id}).records.length,3);
  }
});
test('删除保护人物与地图引用，物品删除含历史，世界删除包含三类资料',t=>{
  const f=fixture(t),{item}=populate(f),s=f.store;
  assert.equal(s.deletion.preview({kind:'character',id:f.character.id}).blockers.length,3);
  assert.ok(s.deletion.preview({kind:'location',id:'hall',parentId:f.map.id}).blockers.includes('演武场'));
  const p=s.deletion.preview({kind:'item',id:item.id});s.deletion.confirm({token:p.token,name:item.name});assert.equal(s.snapshot().items.length,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM catalog_history WHERE entity_id=?').get(item.id).n,0);
  const world=s.deletion.preview({kind:'world',id:f.work.worldId});assert.equal(world.blockers.length,0);assert.ok(world.included.some(r=>r.kind==='place'));s.deletion.confirm({token:world.token,name:world.target.name});assert.equal(s.snapshot().places.length,0);assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('资料包导入独立副本重绑人物、地图、地点 ID，历史仍可回退',t=>{
  const f=fixture(t),original=populate(f),s=f.store;
  s.catalogs.save('item',{...original.item,expectedVersion:1,name:'新墨剑'});
  const file=s.transfer.export({scope:'work',id:f.work.id,format:'package'}),preview=s.transfer.preview(file),imported=s.transfer.confirm({token:preview.token}),worldId=imported.worldIds[0],snapshot=s.snapshot();
  const item=snapshot.items.find(r=>r.worldId===worldId),c=snapshot.characters.find(c=>c.worldId===worldId),p=snapshot.places.find(p=>p.worldId===worldId),m=snapshot.maps.find(m=>m.worldId===worldId);
  assert.notEqual(item.id,original.item.id);assert.equal(item.holders[0].characterId,c.id);assert.equal(p.positions[0].mapId,m.id);assert.equal(p.positions[0].locationId,m.locations[0].id);assert.notEqual(m.locations[0].id,'hall');
  const h=s.history.preview({kind:'item',entityId:item.id,version:1});s.history.restore({token:h.token});assert.equal(s.catalogs.get('item',item.id).name,'墨剑');
  const data=JSON.parse(file.content).data;data.rows.find(r=>r.table==='catalog_places').row.record_json=JSON.stringify({...original.place,positions:[{mapId:f.map.id,locationId:'missing'}]});assert.throws(()=>s.transfer.preview({name:file.name,content:JSON.stringify({data,sha256:digest(JSON.stringify(data))})}),{code:'VALIDATION'});
});
test('备份基准与增量恢复包含三类资料及关联',async t=>{
  const f=fixture(t),r=populate(f),s=f.store,b=new BackupService({store:s,directory:f.directory,openDatabase:p=>new DB(p)});t.after(()=>b.stop());
  await b.baseline(b.estimate());s.catalogs.save('item',{...r.item,expectedVersion:1,holders:[],name:'改名墨剑'});const point=await b.increment();const expected=s.snapshot();
  s.catalogs.save('place',{...r.place,expectedVersion:1,positions:[],name:'临时修改'});const preview=await b.previewRestore(point.point.id);await b.restore(preview.token);
  assert.deepEqual(s.snapshot().items,expected.items);assert.deepEqual(s.snapshot().techniques,expected.techniques);assert.deepEqual(s.snapshot().places,expected.places);
});
test('格式 1 在保护副本升级至当前格式，原资料与游标保留，旧资料包仍可导入',async t=>{
  const f=fixture(t),s=f.store,oldExport=JSON.parse(s.transfer.export({scope:'library',format:'package'}).content);
  for(const table of ['character_images','catalog_items','catalog_techniques','catalog_places','catalog_history'])f.db.exec('DROP TABLE '+table);
  const schema=schemaFingerprint(f.db);assert.equal(schema,'92d64e779c9dda2d93e5993b7f9d524d2c9faa1eabe5219fa26ab72cc2d9304c');f.db.pragma('user_version=1');
  const sequence=s.journal.sequence();s.close();const opened=await openProtectedLibrary(f.directory,'0.1.2');
  try{assert.equal(opened.db.pragma('user_version',{simple:true}),LIBRARY_FORMAT_VERSION);assert.equal(schemaFingerprint(opened.db),LIBRARY_SCHEMA);assert.equal(opened.store.journal.sequence(),sequence);assert.equal(opened.store.getCharacter(f.character.id).name,'沈墨');assert.deepEqual(opened.store.snapshot().items,[]);
    oldExport.data.schema=schema;const preview=opened.store.transfer.preview({name:'旧版.wanxiang',content:JSON.stringify({data:oldExport.data,sha256:digest(JSON.stringify(oldExport.data))})});opened.store.transfer.confirm({token:preview.token});assert.equal(opened.store.snapshot().characters.length,2);
  }finally{opened.store.close();}
  const points=listProtectionPoints(f.directory);assert.equal(points.length,1);assert.equal((await verifyProtectionPoint(f.directory,points[0].id)).libraryVersion,1);
});
test('旧格式备份可恢复，恢复后必须新建基准，不能接坏旧增量链',async t=>{
  const f=fixture(t),s=f.store,b=new BackupService({store:s,directory:f.directory,openDatabase:p=>new DB(p)});t.after(()=>b.stop());
  const baseline=await b.baseline(b.estimate()),path=join(b.status().settings.directory,'points',baseline.point.id,'manifest.json'),wrapper=JSON.parse(readFileSync(path,'utf8'));
  const m=wrapper.manifest??wrapper.data;
  // Same legacy rows and known released literal-SQL fingerprint; new catalog tables are empty.
  assert.ok(m);m.schema='b297bf3532c941a08477c0bafad9255ab2d9f59d59177c0a2a1ff38d17bbfdb2';wrapper.hash=digest(JSON.stringify(m));writeFileSync(path,JSON.stringify(wrapper));
  populate(f);const preview=await b.previewRestore(baseline.point.id);await b.restore(preview.token);assert.equal(s.snapshot().items.length,0);assert.equal(s.getCharacter(f.character.id).name,'沈墨');await assert.rejects(()=>b.increment(),{code:'SCHEMA_CHANGED'});assert.ok(b.status().repositoryError.includes('新'));
});
