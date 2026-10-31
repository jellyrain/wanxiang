import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import Database from 'better-sqlite3';
import { LibraryStore } from '../src/core/store.ts';
import { timelineInput,orderedEvents,moveTimelineEvent,eventPeriod } from '../src/shared/timeline.ts';
import { mapInput,locationDiscovered } from '../src/shared/maps.ts';

function fixture(t){const directory=mkdtempSync(join(tmpdir(),'oc-timeline-')),path=join(directory,'library.sqlite'),db=new Database(path),store=new LibraryStore(db,directory);db.exec("INSERT INTO worlds VALUES('world-a','甲世界'),('world-b','乙世界')");t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-timeline-'))throw Error('Unexpected cleanup target');rmSync(target,{recursive:true,force:true});});return {store,db,path,directory};}
const input=(patch={})=>({worldId:'world-a',expectedVersion:0,name:'测试年表',description:'历史说明',eras:[{id:'ancient',name:'上古',description:'前史'},{id:'present',name:'当世',description:''}],events:[],...patch});
const event=(id,patch={})=>({id,eraId:'ancient',name:id,period:'一千年前',endPeriod:'',summary:'事件摘要',body:'第一段。\n\n第二段。',status:'pending',participants:[],entryIds:[],places:[],mapProgress:[],archived:false,...patch});
function person(store,worldId='world-a'){return store.saveCharacter({worldId,expectedVersion:0,name:'测试人物',caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null});}
function stage(store,p,patch={}){return store.saveCharacterStage({characterId:p.id,expectedVersion:p.version,name:'早期',period:'故事开始',summary:'原阶段内容',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false,...patch});}
function entry(store,worldId='world-a'){const c=store.world.saveCategory({worldId,name:'测试分类',color:'#abcdef',description:'',active:true,expectedVersion:0});return store.world.saveEntry({worldId,categoryId:c.id,expectedCategoryVersion:c.version,expectedVersion:0,name:'历史设定',aliases:'',summary:'',body:'',pending:'',source:'',status:'draft',facts:[],imageId:null,links:[]});}
function map(store,worldId='world-a'){return store.maps.save({worldId,expectedVersion:0,name:'测试地图',description:'',backgroundId:null,stages:[{id:'start',name:'起始'},{id:'later',name:'后续'}],terrain:[],locations:[{id:'port',name:'渡口',kind:'城镇',description:'',x:600,y:500,unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false}]});}
const rejects=code=>e=>e.code===code;

test('年表正文、任意时间、时代顺序及所有关联重启后完整保留',t=>{
  const {store,path,directory}=fixture(t),p=person(store),s=stage(store,p),e=entry(store),m=map(store);
  const history=store.timeline.save(input({events:[event('a',{period:'永宁元年',endPeriod:'永宁三年',participants:[{characterId:p.id,stageId:s.id}],entryIds:[e.id],places:[{mapId:m.id,locationId:'port'}],mapProgress:[{mapId:m.id,stageId:'later'}]})]}));
  store.close();const reopened=new LibraryStore(new Database(path),directory);try{assert.deepEqual(reopened.timeline.get(history.id),history);assert.deepEqual(reopened.snapshot().timelines,[history]);assert.equal(eventPeriod(history.events[0]),'永宁元年 — 永宁三年');assert.equal(eventPeriod(event('b',{period:''})),'时间待定');}finally{reopened.close();}
});
test('时代与事件按作者顺序排列，不按时间文字排序，归档事件可跳过',t=>{
  const {store}=fixture(t);let h=store.timeline.save(input({events:[event('a',{period:'第十年'}),event('hidden',{archived:true}),event('b',{period:'第二年'}),event('c',{eraId:'present',period:'元年'})]}));
  assert.deepEqual(orderedEvents(h).map(e=>e.id),['a','hidden','b','c']);
  const moved=moveTimelineEvent(h.events,'b',-1);assert.deepEqual(moved.map(e=>e.id),['b','hidden','a','c']);assert.deepEqual(moveTimelineEvent(moved,'b',-1),moved);assert.deepEqual(moveTimelineEvent(moved,'hidden',1),moved);
  h=store.timeline.save({...timelineInput(h),events:moved,eras:[h.eras[1],{...h.eras[0],name:'远古时代'}]});assert.deepEqual(orderedEvents(h).map(e=>e.id),['c','b','hidden','a']);assert.equal(h.events[0].eraId,'ancient');
});
test('事件引用人物阶段不会改写原阶段快照，阶段必须属于对应人物',t=>{
  const {store}=fixture(t),p=person(store),s=stage(store,p),q=person(store),before=store.getCharacter(p.id);
  const h=store.timeline.save(input({events:[event('a',{participants:[{characterId:p.id,stageId:s.id}]})]}));store.timeline.save({...timelineInput(h),events:[{...h.events[0],body:'完全不同的事件说明'}]});assert.deepEqual(store.getCharacter(p.id),before);
  assert.throws(()=>store.timeline.save(input({events:[event('b',{participants:[{characterId:q.id,stageId:s.id}]})]})),rejects('VALIDATION'));
});
test('年表关联地图进度按固定编号保留，被引用的节点不能删除',t=>{
  const {store}=fixture(t);let m=map(store),h=store.timeline.save(input({events:[event('a',{mapProgress:[{mapId:m.id,stageId:'later'}]})]}));
  m=store.maps.save({...mapInput(m),name:'地图改名',stages:[m.stages[0],{id:'later',name:'节点改名'}]});assert.equal(store.timeline.get(h.id).events[0].mapProgress[0].stageId,'later');assert.equal(locationDiscovered(m.stages,m.locations[0],'later'),true);
  assert.throws(()=>store.maps.save({...mapInput(m),stages:[m.stages[0]]}),rejects('VALIDATION'));h=store.timeline.archive(h.id,h.version,true);assert.throws(()=>store.maps.save({...mapInput(m),stages:[m.stages[0]]}),rejects('VALIDATION'));
  h=store.timeline.archive(h.id,h.version,false);store.timeline.save({...timelineInput(h),events:[{...h.events[0],mapProgress:[]}]});assert.equal(store.maps.save({...mapInput(m),stages:[m.stages[0]]}).stages.length,1);
});
test('年表拒绝跨世界人物、设定、地点、进度及不存在的关联编号',t=>{
  const {store}=fixture(t),p=person(store,'world-b'),e=entry(store,'world-b'),m=map(store,'world-b'),own=map(store);
  for(const patch of [{participants:[{characterId:p.id,stageId:null}]},{entryIds:[e.id]},{places:[{mapId:m.id,locationId:'port'}]},{mapProgress:[{mapId:m.id,stageId:'start'}]},{places:[{mapId:own.id,locationId:'missing'}]},{mapProgress:[{mapId:own.id,stageId:'missing'}]}])assert.throws(()=>store.timeline.save(input({events:[event('a',patch)]})),rejects('VALIDATION'));
});
test('归档关联仍可保留，不能向新事件添加归档人物、阶段、地点、地图或设定',t=>{
  const {store}=fixture(t);let p=person(store),s=stage(store,p),e=entry(store),m=map(store);p=store.getCharacter(p.id);
  const refs={participants:[{characterId:p.id,stageId:s.id}],entryIds:[e.id],places:[{mapId:m.id,locationId:'port'}],mapProgress:[{mapId:m.id,stageId:'later'}]};let h=store.timeline.save(input({events:[event('a',refs)]}));
  stage(store,p,{id:s.id,archived:true});p=store.getCharacter(p.id);store.archiveCharacter(p.id,p.version,true);store.world.archiveEntry(e.id,e.version,true);m=store.maps.save({...mapInput(m),locations:m.locations.map(l=>({...l,archived:true}))});store.maps.archive(m.id,m.version,true);
  h=store.timeline.save({...timelineInput(h),description:'保留已归档的引用'});assert.deepEqual(h.events[0].participants,refs.participants);
  for(const [key,value] of Object.entries(refs))assert.throws(()=>store.timeline.save(input({events:[event('new',{[key]:value})]})),rejects('VALIDATION'));
});
test('年表与事件归档可恢复，拒绝过期写入、直接移除旧事件或迁移世界',t=>{
  const {store}=fixture(t);const h=store.timeline.save(input({events:[event('a')]}));let saved=store.timeline.save({...timelineInput(h),events:[{...h.events[0],archived:true}]});assert.throws(()=>store.timeline.save(timelineInput(h)),rejects('CONFLICT'));assert.throws(()=>store.timeline.save({...timelineInput(saved),events:[]}),rejects('VALIDATION'));assert.throws(()=>store.timeline.save({...timelineInput(saved),worldId:'world-b'}),rejects('VALIDATION'));
  saved=store.timeline.archive(saved.id,saved.version,true);assert.throws(()=>store.timeline.save(timelineInput(saved)),rejects('VALIDATION'));assert.throws(()=>store.timeline.archive(saved.id,1,false),rejects('CONFLICT'));saved=store.timeline.archive(saved.id,saved.version,false);assert.equal(saved.events[0].archived,true);saved=store.timeline.save({...timelineInput(saved),events:[{...saved.events[0],archived:false}]});assert.deepEqual(saved.events,h.events);
});
test('年表校验时代引用、重复关联、非法编号及数量，空日期和多段正文可保留',t=>{
  const {store}=fixture(t),p=person(store),m=map(store);
  for(const patch of [{expectedVersion:-1},{worldId:'missing'},{eras:[]},{eras:[{id:'x',name:'同名',description:''},{id:'y',name:'同名',description:''}]},{events:[event('a',{eraId:'missing'})]},{events:[event('__proto__')]},{events:[event('a'),event('a')]},{events:[event('a',{participants:[{characterId:p.id,stageId:null},{characterId:p.id,stageId:null}]})]},{events:[event('a',{mapProgress:[{mapId:m.id,stageId:'start'},{mapId:m.id,stageId:'later'}]})]},{events:[event('a',{status:'anything'})]},{events:[event('a',{period:'a'.repeat(151)})]},{events:Array.from({length:1001},(_,i)=>event('e'+i))}])assert.throws(()=>store.timeline.save(input(patch)),rejects('VALIDATION'));
  const h=store.timeline.save(input({events:[event('a',{period:'',summary:'0'})]}));assert.equal(h.events[0].period,'');assert.equal(h.events[0].summary,'0');assert.equal(h.events[0].body,'第一段。\n\n第二段。');
});
test('年表历史写入失败时事件、关联、顺序和版本一并回滚',t=>{
  const {store,db}=fixture(t),h=store.timeline.save(input({events:[event('a')]}));const count=db.prepare('SELECT count(*) AS n FROM timeline_history').get().n;
  db.exec("CREATE TRIGGER reject_timeline_history BEFORE INSERT ON timeline_history BEGIN SELECT RAISE(ABORT,'timeline history failure'); END");assert.throws(()=>store.timeline.save({...timelineInput(h),events:[event('a',{name:'新名字'}),event('b')]}),/timeline history failure/);assert.throws(()=>store.timeline.archive(h.id,h.version,true),/timeline history failure/);assert.deepEqual(store.timeline.get(h.id),h);assert.equal(db.prepare('SELECT count(*) AS n FROM timeline_history').get().n,count);
});
test('旧库升级只新增空年表模块，人物、设定、地图保持原样',t=>{
  const {store,db,path,directory}=fixture(t),p=person(store),e=entry(store),m=map(store);db.exec('DROP TABLE timeline_history; DROP TABLE world_timelines');store.close();const reopened=new LibraryStore(new Database(path),directory);try{assert.deepEqual(reopened.getCharacter(p.id),p);assert.deepEqual(reopened.world.getEntry(e.id),e);assert.deepEqual(reopened.maps.get(m.id),m);assert.deepEqual(reopened.snapshot().timelines,[]);}finally{reopened.close();}
});
