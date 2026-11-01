import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import DB from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {contentCommands} from '../src/core/commands.ts';
import {blankCatalog,catalogInput,hasCatalogLink} from '../src/shared/catalogs.ts';

const root=resolve('test-results/catalog-links');mkdirSync(root,{recursive:true});
function fixture(t){
  const dir=mkdtempSync(join(root,'case-')),db=new DB(join(dir,'library.sqlite')),s=new LibraryStore(db,dir);
  t.after(()=>{s.close();if(dirname(resolve(dir))!==root)throw Error('Unexpected cleanup path');rmSync(dir,{recursive:true,force:true});});
  const work=s.workspace.createWork({name:'关联测试',world:{kind:'new',name:'世界',description:''}}),worldId=work.worldId;
  const character=name=>s.saveCharacter({worldId,expectedVersion:0,name,caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null});
  const a=character('甲'),b=character('乙'),target={kind:'character',id:a.id,expectedVersion:a.version};
  const records=Object.fromEntries(['item','technique','place'].map(kind=>[kind,s.catalogs.save(kind,{...blankCatalog(kind,worldId),name:kind,body:'保留正文',facts:[{id:'fact',label:'设定',value:'保留字段'}]})]));
  const commands=contentCommands(s),generation=s.snapshot().generation;
  const save=(record,change={})=>commands.invoke('saveCatalogLink',[{kind:record.kind,catalogId:record.id,expectedVersion:record.version,target,linked:true,...change}],generation);
  return {s,worldId,a,b,target,records,commands,generation,save};
}

test('从角色添加、修改和解除关联保留其他人物、行编号、定义与历史',t=>{
  const f=fixture(t),{s,records,b,save}=f;
  const seeded=s.catalogs.save('item',{...catalogInput(records.item),holders:[{id:'other',characterId:b.id,quantity:2,state:'stored',notes:'乙持有'}]});
  let item=save(seeded,{holding:{quantity:3,state:'equipped',notes:'甲装备'}}),row=item.holders[1];
  item=save(item,{holding:{quantity:4,state:'stored',notes:'收起'}});
  assert.equal(item.holders[1].id,row.id);assert.deepEqual(item.holders[0],seeded.holders[0]);
  assert.equal(item.body,seeded.body);assert.deepEqual(item.facts,seeded.facts);
  item=save(item,{linked:false});assert.deepEqual(item.holders,seeded.holders);
  assert.equal(s.history.list({kind:'item',entityId:item.id}).records.length,5);
  let technique=save(records.technique,{practice:{progress:'第二层',state:'learning',notes:'初成'}});
  const practiceId=technique.practitioners[0].id;
  technique=save(technique,{practice:{progress:'第三层',state:'mastered',notes:'稳定'}});
  assert.equal(technique.practitioners[0].id,practiceId);assert.equal(technique.practitioners[0].progress,'第三层');
  assert.deepEqual(save(technique,{linked:false}).practitioners,[]);
  const place=save(records.place);assert.ok(hasCatalogLink(place,f.target));assert.deepEqual(save(place,{linked:false}).characterIds,[]);
  assert.deepEqual(s.getCharacter(f.a.id),f.a);
});

test('世界条目与已保存地图标记发起关联，三库编辑保留反向引用',t=>{
  const f=fixture(t),{s,worldId,save,records}=f;
  const category=s.world.saveCategory({worldId,name:'规则',color:'#bda374',description:'',active:true,expectedVersion:0});
  const entry=s.world.saveEntry({worldId,categoryId:category.id,expectedCategoryVersion:category.version,name:'门规',aliases:'',summary:'',body:'',pending:'',source:'',facts:[],status:'draft',imageId:null,links:[],expectedVersion:0});
  const entryTarget={kind:'worldEntry',id:entry.id,expectedVersion:entry.version};
  for(const original of Object.values(records)){
    const linked=save(original,{target:entryTarget});assert.deepEqual(linked.entryIds,[entry.id]);
    const edited=s.catalogs.save(linked.kind,{...catalogInput(linked),summary:'修改定义'});assert.deepEqual(edited.entryIds,[entry.id]);
    assert.deepEqual(save(edited,{target:entryTarget,linked:false}).entryIds,[]);
  }
  const map=s.maps.save({worldId,expectedVersion:0,name:'地图',description:'',backgroundId:null,stages:[{id:'start',name:'开篇'}],terrain:[],locations:[{id:'hall',name:'大殿',kind:'建筑',description:'',unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false,x:10,y:20}]});
  const target={kind:'mapLocation',id:map.id,locationId:'hall',expectedVersion:map.version},place=save(s.catalogs.get('place',records.place.id),{target});
  assert.deepEqual(place.positions,[{mapId:map.id,locationId:'hall'}]);
  assert.deepEqual(save(place,{target,linked:false}).positions,[]);
  assert.throws(()=>save(s.catalogs.get('item',records.item.id),{target}),{code:'VALIDATION'});
  assert.throws(()=>save(s.catalogs.get('place',records.place.id),{target:{...target,locationId:'missing'}}),{code:'VALIDATION'});
});

test('关联拒绝陈旧版本、恢复代次、跨世界、归档及无效状态，事务无残留',t=>{
  const f=fixture(t),{s,a,target,save,records,commands,generation}=f;
  const second=s.workspace.createWork({name:'另一部',world:{kind:'new',name:'另一个世界',description:''}});
  const foreign=s.catalogs.save('place',{...blankCatalog('place',second.worldId),name:'异界地点'});
  const before=s.snapshot(),sequence=s.journal.sequence();
  const cases=[
    ()=>save(records.item,{holding:{quantity:-1,state:'stored',notes:''}}),
    ()=>save(records.item,{holding:{quantity:1,state:'invalid',notes:''}}),
    ()=>save(records.technique,{practice:{progress:4,state:'learning',notes:''}}),
    ()=>save(records.item),
    ()=>save(foreign),
    ()=>save(records.place,{expectedVersion:0}),
    ()=>save(records.place,{target:{...target,expectedVersion:0}}),
    ()=>commands.invoke('saveCatalogLink',[{target,kind:'place',catalogId:records.place.id,expectedVersion:1,linked:true}],'stale-generation')
  ];
  for(const action of cases){assert.throws(action,e=>['VALIDATION','CONFLICT','RESTORED'].includes(e.code));assert.deepEqual(s.snapshot(),before);assert.equal(s.journal.sequence(),sequence);}
  const archived=s.archiveCharacter(a.id,a.version,true);assert.throws(()=>save(records.place,{target:{...target,expectedVersion:archived.version}}),{code:'VALIDATION'});
  const restored=s.archiveCharacter(a.id,archived.version,false);
  const archivedPlace=s.catalogs.archive('place',records.place.id,records.place.version,true);
  assert.throws(()=>save(archivedPlace,{target:{...target,expectedVersion:restored.version}}),{code:'VALIDATION'});
  assert.equal(commands.invoke('snapshot',[]).generation,generation);
});
