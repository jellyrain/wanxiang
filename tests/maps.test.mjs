import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { LibraryStore } from '../src/core/store.ts';
import { filterMapLocations, locationDiscovered, mapInput } from '../src/shared/maps.ts';

function fixture(t){const directory=mkdtempSync(join(tmpdir(),'oc-map-test-')),path=join(directory,'library.sqlite'),db=new BetterSqlite3(path),store=new LibraryStore(db,directory);db.exec("INSERT INTO worlds VALUES('world-a','甲世界'),('world-b','乙世界')");t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-map-test-'))throw Error('Unexpected cleanup path');rmSync(target,{recursive:true,force:true});});return {store,db,path,directory};}
function input(extra={}){return {worldId:'world-a',expectedVersion:0,name:'测试地图',description:'测试说明',backgroundId:null,stages:[{id:'start',name:'启程'},{id:'later',name:'深入'}],locations:[],terrain:[],...extra};}
function location(id,extra={}){return {id,name:id,kind:'城镇',description:'地点说明',x:0,y:900,unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false,...extra};}
function person(store,worldId='world-a'){return store.saveCharacter({worldId,expectedVersion:0,name:'地图人物',caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null});}
function entry(store,worldId='world-a'){const c=store.world.saveCategory({worldId,name:'地点',color:'#abcdef',description:'',active:true,expectedVersion:0});return store.world.saveEntry({worldId,categoryId:c.id,expectedCategoryVersion:c.version,expectedVersion:0,name:'地点资料',aliases:'',summary:'',body:'',pending:'',source:'',status:'draft',facts:[],imageId:null,links:[]});}
const rejected=code=>e=>e.code===code;
const stroke={id:'land-1',kind:'land',points:[{x:0,y:0},{x:1600,y:0},{x:800,y:900}]};

test('地图地形、地点、剧情节点、图片和关联重启完整保留',t=>{
  const {store,path,directory}=fixture(t),p=person(store),e=entry(store);const image=store.importImage('world-a',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'),'map.png');
  const original=store.maps.save(input({backgroundId:image.id,terrain:[stroke],locations:[location('port',{imageId:image.id,characterIds:[p.id],entryIds:[e.id],favorite:true})]}));
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);try{assert.deepEqual(reopened.maps.get(original.id),original);assert.deepEqual(reopened.snapshot().maps,[original]);}finally{reopened.close();}
});
test('探索进度依据节点编号和顺序，节点改名不改变地点归属',t=>{
  const {store}=fixture(t),l=location('secret',{unlockStageId:'later'}),m=store.maps.save(input({locations:[l]}));
  assert.equal(locationDiscovered(m.stages,l,'start'),false);assert.equal(locationDiscovered(m.stages,l,'later'),true);assert.equal(locationDiscovered(m.stages,l,'missing'),false);
  const renamed=store.maps.save({...mapInput(m),stages:[{id:'start',name:'第一卷'},{id:'later',name:'第二卷'}]});assert.equal(locationDiscovered(renamed.stages,l,'later'),true);
  assert.throws(()=>store.maps.save({...mapInput(renamed),stages:[renamed.stages[0]]}),rejected('VALIDATION'));
  const reordered=store.maps.save({...mapInput(renamed),stages:[...renamed.stages].reverse()});assert.equal(locationDiscovered(reordered.stages,l,'start'),true);
});
test('探索视图不会从名称、类别、收藏泄露未知地点，作者模式可检索全部',()=>{
  const map=input({locations:[location('港口'),location('隐藏遗迹',{kind:'秘境',description:'隐藏词',unlockStageId:'later',favorite:true}),location('归档',{archived:true})]});
  assert.equal(filterMapLocations(map,'explore','start','','',false,true).length,2);
  for(const [query,kind,favorites] of [['隐藏','',false],['隐藏词','',false],['','秘境',false],['','',true]])assert.equal(filterMapLocations(map,'explore','start',query,kind,favorites,true).length,0);
  assert.equal(filterMapLocations(map,'author','start','隐藏','',false,false).length,1);
  assert.equal(filterMapLocations(map,'explore','later','','秘境',true,false).length,1);
  assert.equal(filterMapLocations(map,'author','start','','',false,true).length,3);
});
test('地图编辑拒绝过期版本和迁移世界，地图归档与恢复保留内容',t=>{
  const {store}=fixture(t),m=store.maps.save(input({terrain:[stroke],locations:[location('port')]}));
  const edited=store.maps.save({...mapInput(m),name:'新名称'});
  assert.throws(()=>store.maps.save(mapInput(m)),rejected('CONFLICT'));assert.throws(()=>store.maps.save({...mapInput(edited),worldId:'world-b'}),rejected('VALIDATION'));
  const archived=store.maps.archive(edited.id,edited.version,true);assert.deepEqual(archived.terrain,m.terrain);assert.throws(()=>store.maps.save(mapInput(archived)),rejected('VALIDATION'));
  assert.throws(()=>store.maps.archive(archived.id,edited.version,false),rejected('CONFLICT'));
  const restored=store.maps.archive(archived.id,archived.version,false);assert.equal(restored.name,'新名称');assert.deepEqual(restored.locations,m.locations);
});
test('地点以归档代替直接移除，解锁信息与引用均保留',t=>{
  const {store}=fixture(t),m=store.maps.save(input({locations:[location('port',{unlockStageId:'later'})]}));
  assert.throws(()=>store.maps.save({...mapInput(m),locations:[]}),rejected('VALIDATION'));
  const archived=store.maps.save({...mapInput(m),locations:m.locations.map(l=>({...l,archived:true}))});
  assert.equal(archived.locations[0].unlockStageId,'later');const restored=store.maps.save({...mapInput(archived),locations:archived.locations.map(l=>({...l,archived:false}))});assert.deepEqual(restored.locations,m.locations);
});
test('跨世界人物、条目和图片不能关联；已归档引用保留但不能新建',t=>{
  const {store}=fixture(t),p=person(store),foreign=person(store,'world-b'),e=entry(store),foreignEntry=entry(store,'world-b');
  assert.throws(()=>store.maps.save(input({locations:[location('x',{characterIds:[foreign.id]})]})),rejected('VALIDATION'));
  assert.throws(()=>store.maps.save(input({locations:[location('x',{entryIds:[foreignEntry.id]})]})),rejected('VALIDATION'));
  const image=store.importImage('world-b',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=','base64'),'other.png');
  assert.throws(()=>store.maps.save(input({backgroundId:image.id})),rejected('VALIDATION'));assert.throws(()=>store.maps.save(input({locations:[location('x',{imageId:image.id})]})),rejected('VALIDATION'));
  const m=store.maps.save(input({locations:[location('x',{entryIds:[e.id],characterIds:[p.id]})]}));store.archiveCharacter(p.id,p.version,true);store.world.archiveEntry(e.id,e.version,true);
  assert.equal(store.maps.save({...mapInput(m),name:'保留旧关联'}).locations.length,1);
  assert.throws(()=>store.maps.save(input({locations:[location('new',{entryIds:[e.id]})]})),rejected('VALIDATION'));
  assert.throws(()=>store.maps.save(input({locations:[location('new',{characterIds:[p.id]})]})),rejected('VALIDATION'));
});
test('拒绝无效坐标、笔画、重复编号、未知解锁节点与超量数据',t=>{
  const {store}=fixture(t);
  for(const patch of [{expectedVersion:-1},{worldId:'missing'},{stages:[]},{stages:[{id:'a',name:'相同'},{id:'b',name:'相同'}]},{terrain:[{...stroke,kind:'script'}]},{terrain:[{...stroke,points:[{x:0,y:0}]}]},{terrain:[{...stroke,points:[{x:NaN,y:0},{x:0,y:0},{x:2,y:2}]}]},{terrain:[stroke,stroke]},{locations:[location('x',{x:1601})]},{locations:[location('x',{y:-1})]},{locations:[location('x',{unlockStageId:'missing'})]},{locations:[location('x'),location('x')]},{locations:[location('__proto__')]},{locations:[location('x',{entryIds:['missing','missing']})]},{locations:Array.from({length:501},(_,i)=>location('l'+i))}])assert.throws(()=>store.maps.save(input(patch)),rejected('VALIDATION'));
});
test('地图历史保存失败，地图正文、地形、地点和版本一起回滚',t=>{
  const {store,db}=fixture(t),m=store.maps.save(input({terrain:[stroke]}));const count=db.prepare('SELECT count(*) AS n FROM map_history').get().n;
  db.exec("CREATE TRIGGER reject_map_history BEFORE INSERT ON map_history BEGIN SELECT RAISE(ABORT,'map history failure'); END");
  assert.throws(()=>store.maps.save({...mapInput(m),terrain:[],locations:[location('x')]}),/map history failure/);assert.throws(()=>store.maps.archive(m.id,m.version,true),/map history failure/);assert.deepEqual(store.maps.get(m.id),m);assert.equal(db.prepare('SELECT count(*) AS n FROM map_history').get().n,count);
});
test('旧资料库升级只增加空地图模块，原有设定和人物完整保留',t=>{
  const {store,db,path,directory}=fixture(t),p=person(store),e=entry(store);db.exec('DROP TABLE map_history; DROP TABLE world_maps');store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);try{assert.deepEqual(reopened.getCharacter(p.id),p);assert.deepEqual(reopened.world.getEntry(e.id),e);assert.deepEqual(reopened.snapshot().maps,[]);}finally{reopened.close();}
});
