import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { LibraryStore } from '../src/core/store.ts';

function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'oc-world-test-')),path=join(directory,'library.sqlite'),db=new BetterSqlite3(path),store=new LibraryStore(db,directory);
  db.exec("INSERT INTO worlds VALUES('world-a','甲世界'),('world-b','乙世界'); INSERT INTO works VALUES('work-a','world-a','同一世界的作品一'),('work-b','world-a','同一世界的作品二')");
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-world-test-'))throw new Error('Unexpected cleanup path');rmSync(target,{recursive:true,force:true});});
  return {directory,path,db,store};
}
function category(store,extra={}){return store.world.saveCategory({worldId:'world-a',name:'世界规则',color:'#bda374',description:'这个世界如何运转',active:true,expectedVersion:0,...extra});}
function input(c,extra={}){return {worldId:c.worldId,categoryId:c.id,expectedCategoryVersion:c.version,name:'测试设定',aliases:'别名',summary:'内容摘要',body:'第一段\n\n第二段',pending:'待确认',source:'讨论记录',status:'draft',facts:[{id:'field-a',label:'范围',value:''},{id:'field-b',label:'数量',value:'0'}],imageId:null,links:[],expectedVersion:0,...extra};}
function edit(e,c,extra={}){return {...e,expectedVersion:e.version,expectedCategoryVersion:c.version,...extra};}
function person(store,extra={}){return store.saveCharacter({worldId:'world-a',expectedVersion:0,name:'测试人物',caption:'',status:'草稿',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null,...extra});}
const code=expected=>e=>e.code===expected;

test('世界条目完整保存、重开恢复，多部作品共享同一世界资料',t=>{
  const {store,path,directory}=fixture(t),c=category(store),p=person(store),target=store.world.saveEntry(input(c,{name:'被引用的规则'}));
  const image=store.importImage('world-a',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'),'测试.png');
  const entry=store.world.saveEntry(input(c,{status:'adopted',imageId:image.id,links:[{kind:'character',targetId:p.id,label:'使用者'},{kind:'entry',targetId:target.id,label:'依据'}]}));
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try{assert.deepEqual(reopened.world.getEntry(entry.id),entry);assert.equal(entry.facts[0].value,'');assert.equal(entry.facts[1].value,'0');assert.equal(reopened.snapshot().works.filter(w=>w.worldId===entry.worldId).length,2);assert.equal(reopened.snapshot().worldCategories.length,1);}finally{reopened.close();}
});

test('分类重命名同步条目版本，旧编辑与旧分类版本不能覆盖新资料',t=>{
  const {store,db}=fixture(t),c=category(store),e=store.world.saveEntry(input(c));
  const renamed=category(store,{...c,name:'规则与秩序',color:'#AABBCC',expectedVersion:c.version});
  assert.equal(renamed.color,'#aabbcc');assert.equal(store.world.getEntry(e.id).version,e.version+1);
  assert.throws(()=>store.world.saveEntry(edit(e,renamed)),code('CONFLICT'));
  assert.throws(()=>store.world.saveEntry(edit(store.world.getEntry(e.id),c)),code('CONFLICT'));
  const revision=JSON.parse(db.prepare("SELECT snapshot_json FROM world_history WHERE entity_id=? AND version=1").get(e.id).snapshot_json);
  assert.equal(revision.category.name,'世界规则');
  assert.throws(()=>category(store,{name:'规则与秩序'}),code('VALIDATION'));
  assert.throws(()=>category(store,{...c,expectedVersion:c.version}),code('CONFLICT'));
});

test('分类停用保留编辑与恢复能力，阻止新建及迁入；分类可再次启用',t=>{
  const {store}=fixture(t),c=category(store),other=category(store,{name:'地点'}),e=store.world.saveEntry(input(c)),another=store.world.saveEntry(input(other));
  const disabled=category(store,{...c,active:false,expectedVersion:c.version});
  assert.throws(()=>store.world.saveEntry(input(disabled)),code('VALIDATION'));
  assert.throws(()=>store.world.saveEntry(edit(another,disabled,{categoryId:c.id})),code('VALIDATION'));
  const updated=store.world.saveEntry(edit(store.world.getEntry(e.id),disabled,{summary:'停用后仍可完善'}));
  const archived=store.world.archiveEntry(updated.id,updated.version,true);
  assert.equal(store.world.archiveEntry(archived.id,archived.version,false).archived,false);
  const enabled=category(store,{...disabled,active:true,expectedVersion:disabled.version});
  assert.equal(store.world.saveEntry(input(enabled)).categoryId,c.id);
});

test('拒绝跨世界分类、人物、条目和图片，不允许修改资料所属世界',t=>{
  const {store}=fixture(t),a=category(store),b=category(store,{worldId:'world-b'}),foreign=person(store,{worldId:'world-b'}),foreignEntry=store.world.saveEntry(input(b)),entry=store.world.saveEntry(input(a));
  assert.throws(()=>store.world.saveEntry(input(a,{categoryId:b.id})),code('VALIDATION'));
  assert.throws(()=>store.world.saveEntry(edit(entry,b,{worldId:'world-b',categoryId:b.id})),code('VALIDATION'));
  assert.throws(()=>category(store,{...a,worldId:'world-b',expectedVersion:a.version}),code('VALIDATION'));
  for(const link of [{kind:'character',targetId:foreign.id,label:''},{kind:'entry',targetId:foreignEntry.id,label:''}])assert.throws(()=>store.world.saveEntry(input(a,{links:[link]})),code('VALIDATION'));
  assert.throws(()=>store.world.saveEntry(input(a,{imageId:'missing-image'})),code('VALIDATION'));
  const asset=store.importImage('world-b',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'),'b.png');
  assert.throws(()=>store.world.saveEntry(input(a,{imageId:asset.id})),code('VALIDATION'));
});

test('引用保留稳定编号与历史名称，归档不会破坏已有联系，新关联须先恢复目标',t=>{
  const {store,db}=fixture(t),c=category(store),p=person(store),a=store.world.saveEntry(input(c,{name:'甲条目'})),link={kind:'entry',targetId:a.id,label:'引用'},actor={kind:'character',targetId:p.id,label:'相关人物'};
  const b=store.world.saveEntry(input(c,{name:'乙条目',links:[link,actor]}));
  const renamed=store.world.saveEntry(edit(a,c,{name:'甲的新名字'}));
  const archived=store.world.archiveEntry(renamed.id,renamed.version,true);store.archiveCharacter(p.id,p.version,true);
  assert.deepEqual(store.world.getEntry(b.id).links,[link,actor]);
  assert.equal(store.world.saveEntry(edit(b,c,{summary:'保留归档关联'})).links.length,2);
  assert.throws(()=>store.world.saveEntry(input(c,{links:[link]})),code('VALIDATION'));
  assert.throws(()=>store.world.saveEntry(input(c,{links:[actor]})),code('VALIDATION'));
  const old=JSON.parse(db.prepare('SELECT snapshot_json FROM world_history WHERE entity_id=? AND version=1').get(b.id).snapshot_json);
  assert.equal(old.references[0].name,'甲条目');
  assert.throws(()=>store.world.saveEntry(edit(archived,c)),code('VALIDATION'));
  assert.throws(()=>store.world.archiveEntry(archived.id,1,false),code('CONFLICT'));
  const restored=store.world.archiveEntry(archived.id,archived.version,false);
  assert.equal(restored.name,'甲的新名字');assert.equal(store.world.saveEntry(input(c,{links:[link]})).links.length,1);
});

test('拒绝无效、重复、自关联、伪造版本与过长字段，允许互相引用',t=>{
  const {store}=fixture(t),c=category(store),a=store.world.saveEntry(input(c)),b=store.world.saveEntry(input(c,{links:[{kind:'entry',targetId:a.id,label:''}]}));
  const link={kind:'entry',targetId:b.id,label:''};assert.equal(store.world.saveEntry(edit(a,c,{links:[link]})).links.length,1);
  const current=store.world.getEntry(a.id);
  assert.throws(()=>store.world.saveEntry(edit(current,c,{links:[{...link,targetId:a.id}]})),code('VALIDATION'));
  assert.throws(()=>store.world.saveEntry(input(c,{links:[link,link]})),code('VALIDATION'));
  for(const extra of [{name:'  '},{expectedVersion:-1},{expectedCategoryVersion:NaN},{status:'fake'},{links:[null]},{links:[{...link,kind:'script'}]},{facts:[{id:'__proto__',label:'X',value:''}]},{facts:[{id:'a',label:'',value:''}]},{body:'X'.repeat(100001)}])assert.throws(()=>store.world.saveEntry(input(c,extra)),code('VALIDATION'));
  assert.throws(()=>store.world.archiveEntry(current.id,current.version,'true'),code('VALIDATION'));
});

test('历史保存失败时条目、分类及关联条目版本整体回滚',t=>{
  const {store,db}=fixture(t),c=category(store),e=store.world.saveEntry(input(c));
  const before=store.world.snapshot(),count=db.prepare('SELECT count(*) AS n FROM world_history').get().n;
  db.exec("CREATE TRIGGER reject_world_history BEFORE INSERT ON world_history WHEN NEW.entity_kind='entry' BEGIN SELECT RAISE(ABORT,'history failure'); END");
  assert.throws(()=>store.world.saveEntry(edit(e,c,{name:'不应写入'})),/history failure/);
  assert.throws(()=>category(store,{...c,name:'不应写入',expectedVersion:c.version}),/history failure/);
  assert.throws(()=>store.world.archiveEntry(e.id,e.version,true),/history failure/);
  assert.deepEqual(store.world.snapshot(),before);assert.equal(db.prepare('SELECT count(*) AS n FROM world_history').get().n,count);
});

test('升级旧库只添加空世界档案，不改写既有人物与关系',t=>{
  const {store,db,path,directory}=fixture(t),p=person(store),q=person(store,{name:'第二人'}),type=store.graph.saveType({worldId:'world-a',name:'朋友',color:'#bda374',active:true,expectedVersion:0});
  const relation=store.graph.saveRelation({worldId:'world-a',sourceId:p.id,targetId:q.id,sourceStageId:null,targetStageId:null,typeId:type.id,expectedTypeVersion:type.version,label:'',description:'原有记录',direction:'mutual',status:'pending',expectedVersion:0});
  db.exec('DROP TABLE world_history; DROP TABLE world_entries; DROP TABLE world_categories');store.close();
  const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try{assert.deepEqual(reopened.getCharacter(p.id),p);assert.deepEqual(reopened.snapshot().relations,[relation]);assert.deepEqual(reopened.world.snapshot(),{worldCategories:[],worldEntries:[]});}finally{reopened.close();}
});
