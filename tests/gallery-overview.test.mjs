import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import Database from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {mediaInput,mediaCatalogInput,mediaUses,mediaSearchText} from '../src/shared/gallery.ts';
import {dashboardInput,overviewData} from '../src/shared/overview.ts';
import {blankChapter} from '../src/shared/chapters.ts';

const bytes=readFileSync(new URL('../resources/seed/gu.png',import.meta.url));
const rejects=code=>e=>e.code===code;
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'oc-gallery-')),path=join(directory,'library.sqlite'),db=new Database(path),store=new LibraryStore(db,directory);
  db.exec("INSERT INTO worlds VALUES('a','甲世界'),('b','乙世界'); INSERT INTO works VALUES('book-a','a','第一部'),('book-b','a','同世界第二部'),('book-c','b','独立作品')");
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-gallery-'))throw Error('Unexpected cleanup target');rmSync(target,{recursive:true,force:true});});
  return {store,db,path,directory};
}
const image=(store,world='a',info)=>store.importImage(world,bytes,'人物参考.png',info);
const label=(id,name=id)=>({id,name,color:'#abcdef',active:true});
const person=(store,portraitId)=>store.saveCharacter({worldId:'a',expectedVersion:0,name:'人物',caption:'',status:'',quote:'',intro:'',body:'',pending:'尚待确认',facts:[],tagIds:[],portraitId});
const catalog=store=>store.gallery.saveCatalog({worldId:'a',expectedVersion:0,categories:[label('portrait','人物立绘')],tags:[label('ink','水墨')]});

test('旧图片直接进入素材库，浏览与新模块迁移不改写原资产和人物',t=>{
  const {store,db,path,directory}=fixture(t),a=image(store),p=person(store,a.id),oldAssets=db.prepare('SELECT * FROM assets').all();
  const m=store.gallery.get(a.id);assert.equal(m.version,0);assert.equal(m.width,null);assert.equal(m.name,'人物参考');assert.equal(m.importedAt,'');
  store.gallery.snapshot();store.gallery.catalog('a');store.dashboard.get('book-a');store.snapshot();
  assert.equal(db.prepare('SELECT count(*) n FROM media_metadata').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM work_dashboards').get().n,0);
  store.close();const reopenedDb=new Database(path),reopened=new LibraryStore(reopenedDb,directory);try{assert.deepEqual(reopenedDb.prepare('SELECT * FROM assets').all(),oldAssets);assert.deepEqual(reopened.getCharacter(p.id),p);assert.deepEqual(reopened.gallery.get(a.id),m);}finally{reopened.close();}
});

test('素材分类、标签、来源、提示词、收藏与尺寸重启后完整保留',t=>{
  const {store,path,directory}=fixture(t);catalog(store);const a=image(store,'a',{width:512,height:1024});
  const saved=store.gallery.save({...mediaInput(store.gallery.get(a.id)),name:'主角参考',description:'构图\n服饰',source:'作者提供',prompt:'水墨\n长发',categoryId:'portrait',tagIds:['ink'],favorite:true});
  let d=store.dashboard.save({...dashboardInput(store.dashboard.get('book-a')),description:'作品简介',genre:'测试类型',phase:'writing',coverId:a.id,coverFlip:true,targetCharacters:50000,memo:'下次继续',tasks:[{id:'next',title:'核对开篇',done:false}]});
  const legacyInput=dashboardInput(d);delete legacyInput.coverFlip;d=store.dashboard.save({...legacyInput,memo:'旧接口保存仍保留镜像'});assert.equal(d.coverFlip,true);
  assert.equal(saved.byteSize,bytes.length);assert.equal(saved.width,512);store.close();const reopened=new LibraryStore(new Database(path),directory);try{assert.deepEqual(reopened.gallery.get(a.id),saved);assert.deepEqual(reopened.dashboard.get('book-a'),d);}finally{reopened.close();}
});

test('重复导入按世界去重，不覆盖元数据、原图与导入时间',t=>{
  const {store,db}=fixture(t),a=image(store,'a',{width:512,height:1024});const saved=store.gallery.save({...mediaInput(store.gallery.get(a.id)),name:'已命名',favorite:true});
  const reused=store.importImage('a',bytes,'不同文件名.png',{width:512,height:1024});assert.equal(reused.id,a.id);assert.deepEqual(store.gallery.get(a.id),saved);
  const other=image(store,'b',{width:512,height:1024});assert.notEqual(other.id,a.id);assert.equal(db.prepare('SELECT count(*) n FROM assets').get().n,2);
});

test('停用分类标签保留旧关联，拒绝新关联、跨世界分类与直接移除',t=>{
  const {store}=fixture(t);let c=catalog(store);const a=image(store),b=store.importImage('a',readFileSync(new URL('../resources/seed/mo.png',import.meta.url)),'另一图.png');
  let m=store.gallery.save({...mediaInput(store.gallery.get(a.id)),categoryId:'portrait',tagIds:['ink']});
  c=store.gallery.saveCatalog({...mediaCatalogInput(c),categories:[{...c.categories[0],name:'人物肖像',active:false}],tags:[{...c.tags[0],active:false}]});
  m=store.gallery.save({...mediaInput(m),description:'停用后仍可补充资料'});assert.equal(m.categoryId,'portrait');assert.match(mediaSearchText(m,c),/人物肖像/);
  for(const patch of [{categoryId:'portrait'},{tagIds:['ink']}])assert.throws(()=>store.gallery.save({...mediaInput(store.gallery.get(b.id)),...patch}),rejects('VALIDATION'));
  assert.throws(()=>store.gallery.saveCatalog({...mediaCatalogInput(c),tags:[]}),rejects('VALIDATION'));
  const foreign=image(store,'b');assert.throws(()=>store.gallery.save({...mediaInput(store.gallery.get(foreign.id)),categoryId:'portrait'}),rejects('VALIDATION'));
  assert.throws(()=>store.gallery.saveCatalog({...mediaCatalogInput(c),expectedVersion:0}),rejects('CONFLICT'));
});

test('素材归档不删除原图或人物阶段引用，恢复后可继续编辑',t=>{
  const {store,directory}=fixture(t),a=image(store);let p=person(store,a.id);store.saveCharacterStage({characterId:p.id,expectedVersion:p.version,name:'早期',period:'',summary:'',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false});p=store.getCharacter(p.id);
  let m=store.gallery.archive(a.id,0,true);assert.deepEqual(store.getCharacter(p.id),p);assert.ok(existsSync(join(directory,'media',a.fileName)));
  assert.equal(mediaUses(store.snapshot(),'a').get(a.id).length,2);assert.throws(()=>store.gallery.save(mediaInput(m)),rejects('VALIDATION'));
  m=store.gallery.archive(a.id,m.version,false);assert.equal(store.gallery.save({...mediaInput(m),description:'恢复'}).description,'恢复');
  assert.throws(()=>store.gallery.archive(a.id,0,true),rejects('CONFLICT'));
});

test('素材、分类、作品计划历史写入失败时事务完整回滚',t=>{
  const {store,db}=fixture(t),a=image(store),before=store.gallery.get(a.id),d=store.dashboard.get('book-a');
  for(const table of ['media_history','media_catalog_history','dashboard_history'])db.exec(`CREATE TRIGGER fail_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'forced history failure'); END`);
  assert.throws(()=>store.gallery.save({...mediaInput(before),name:'不能留下'}),/forced history failure/);assert.deepEqual(store.gallery.get(a.id),before);
  assert.throws(()=>catalog(store),/forced history failure/);assert.equal(store.gallery.catalog('a').version,0);
  assert.throws(()=>store.dashboard.save({...dashboardInput(d),memo:'不能留下'}),/forced history failure/);assert.deepEqual(store.dashboard.get('book-a'),d);
  assert.throws(()=>image(store,'b',{width:0,height:10}),rejects('VALIDATION'));assert.equal(db.prepare("SELECT count(*) n FROM assets WHERE world_id='b'").get().n,0);
});

test('素材输入边界与版本冲突保护已有内容',t=>{
  const {store}=fixture(t),a=image(store),m=store.gallery.get(a.id);
  for(const patch of [{name:' '},{tagIds:['same','same']},{favorite:1},{categoryId:'missing'},{prompt:'x'.repeat(30001)},{expectedVersion:-1}])assert.throws(()=>store.gallery.save({...mediaInput(m),...patch}),rejects('VALIDATION'));
  const saved=store.gallery.save({...mediaInput(m),name:'新版本'});assert.throws(()=>store.gallery.save(mediaInput(m)),rejects('CONFLICT'));assert.deepEqual(store.gallery.get(a.id),saved);
  assert.throws(()=>store.gallery.saveCatalog({worldId:'a',expectedVersion:0,categories:[label('one','重复'),label('two','重复')],tags:[]}),rejects('VALIDATION'));
});

test('作品计划各自独立，封面不能跨世界，任务目标校验与冲突保护',t=>{
  const {store}=fixture(t),d=store.dashboard.get('book-a'),a=image(store,'b');
  for(const patch of [{coverId:a.id},{coverFlip:'true'},{targetCharacters:0},{targetCharacters:1.5},{targetCharacters:100000001},{phase:'unknown'},{tasks:[{id:'a',title:' ',done:false}]},{tasks:[{id:'a',title:'一',done:false},{id:'a',title:'二',done:true}]}])assert.throws(()=>store.dashboard.save({...dashboardInput(d),...patch}),rejects('VALIDATION'));
  const saved=store.dashboard.save({...dashboardInput(d),tasks:[{id:'a',title:'任务',done:true}]});assert.equal(store.dashboard.get('book-b').version,0);assert.equal(store.dashboard.get('book-c').tasks.length,0);
  assert.throws(()=>store.dashboard.save(dashboardInput(d)),rejects('CONFLICT'));assert.deepEqual(store.dashboard.get('book-a'),saved);
});

test('素材使用清单涵盖停用形态、冻结阶段、归档地点和多作品封面',t=>{
  const {store}=fixture(t),a=image(store),p=person(store,a.id),s=store.snapshot(),id=a.id;
  s.characters[0]={...p,archived:true,forms:[{id:'f',name:'墨',active:false,portraitMode:'custom',portraitId:id}],stages:[{id:'s',name:'旧时',archived:true,snapshot:{forms:[{id:'base',name:'基础',portraitId:id}],profile:{portraitId:id}}}]};
  s.worldEntries=[{id:'entry',worldId:'a',name:'设定',imageId:id,archived:true}];s.maps=[{id:'map',worldId:'a',name:'地图',backgroundId:id,archived:false,locations:[{id:'location',name:'地点',imageId:id,archived:true}]}];
  s.dashboards=[{...store.dashboard.get('book-a'),coverId:id},{...store.dashboard.get('book-b'),coverId:id}];
  const before=structuredClone(s),uses=mediaUses(s,'a').get(id);assert.equal(uses.length,8);assert.equal(uses.filter(u=>u.archived).length,5);assert.ok(uses.some(u=>u.stageId==='s'));assert.ok(uses.some(u=>u.locationId==='location'));assert.equal(mediaUses(s,'b').size,0);assert.deepEqual(s,before);
});

test('概览按世界汇总资料，按作品统计正文，排除归档并准确列出待定项',t=>{
  const {store}=fixture(t);person(store,null);image(store);image(store,'b');
  for(const [workId,name,body,status] of [['book-a','本书一','中 文，\nA😀','finished'],['book-a','本书二','再写','draft'],['book-b','别书','不该计入','draft']])store.chapters.save({...blankChapter(store.chapters.getOutline(workId)),name,body,status});
  const s=store.snapshot(),stamp='2026-10-25T12:00:00Z';s.chapters[0].updatedAt=stamp;s.chapters[1].updatedAt='2026-10-24T12:00:00Z';
  s.worldEntries=[{id:'e',worldId:'a',name:'待定设定',status:'pending',pending:'',archived:false,updatedAt:stamp},{id:'x',worldId:'a',archived:true,status:'pending',pending:''}];
  s.maps=[{id:'m',worldId:'a',name:'地图',archived:false,updatedAt:stamp,locations:[{archived:false},{archived:true}]},{id:'off',worldId:'a',archived:true,locations:[{archived:false}]}];
  s.timelines=[{id:'t',worldId:'a',name:'历史',archived:false,updatedAt:stamp,events:[{id:'event',name:'待定事件',status:'pending',archived:false},{id:'off',status:'pending',archived:true}]},{id:'off',worldId:'a',archived:true,events:[{status:'pending',archived:false}]}];
  const before=structuredClone(s),data=overviewData(s,s.works[0]);assert.equal(data.wordCount,7);assert.equal(data.finished,1);assert.equal(data.chapters.length,2);assert.equal(data.media.length,1);assert.equal(data.locations,1);assert.equal(data.events.length,1);assert.equal(data.pending.length,3);assert.equal(data.resume.name,'本书一');assert.ok(data.recent.every(r=>Number.isFinite(Date.parse(r.updatedAt))));assert.ok(data.pending.some(r=>r.eventId==='event'));assert.deepEqual(s,before);
  s.chapters[0].archived=true;assert.equal(overviewData(s,s.works[0]).wordCount,2);
});
