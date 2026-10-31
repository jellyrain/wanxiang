import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import Database from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {contentCommands} from '../src/core/commands.ts';
import {historyEntities} from '../src/shared/history.ts';

function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'oc-history-')),db=new Database(join(directory,'library.sqlite')),store=new LibraryStore(db,directory);
  const work=store.workspace.createWork({name:'第一部',world:{kind:'new',name:'甲世界',description:'最初世界'}}),worldId=work.worldId;
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-history-'))throw Error('Unexpected cleanup path');rmSync(target,{recursive:true,force:true});});
  return {store,db,work,worldId,commands:contentCommands(store)};
}
const character=(f,name='初版人物')=>f.store.saveCharacter({worldId:f.worldId,expectedVersion:0,name,caption:'旧称号',status:'草稿',quote:'',intro:'',body:'第一版正文\n第二行',pending:'',facts:[],tagIds:[],portraitId:null});
const edit=(f,c,patch={})=>f.store.saveCharacter({...c,tagIds:c.tags.map(t=>t.id),expectedVersion:c.version,...patch});
const selection=(kind,entity,version=entity.version)=>({kind,entityId:entity.id??entity.workId??entity.worldId,version});
const rejected=code=>error=>error.code===code;
const dump=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

test('历史读取与实际回退预览不写任何数据库记录，确认后追加版本且旧记录逐字保留',t=>{
  const f=fixture(t),first=character(f),latest=edit(f,first,{body:'第二版',name:'当前人物'}),s=selection('character',first),before=dump(f.db),revision=f.commands.revision();
  const page=f.commands.invoke('listHistory',[s]);assert.deepEqual(page.records.map(r=>r.version),[2,1]);
  const detail=f.commands.invoke('getHistory',[s]);assert.equal(detail.currentVersion,2);assert.ok(detail.differences.some(d=>d.field==='body'&&d.after===first.body));
  const preview=f.commands.invoke('previewHistoryRestore',[s]);assert.equal(f.commands.revision(),revision);assert.deepEqual(dump(f.db),before);
  assert.ok(preview.differences.some(d=>d.field==='name'&&d.before===latest.name&&d.after===first.name));
  const result=f.commands.invoke('restoreHistory',[{token:preview.token}]);assert.equal(result.version,3);assert.equal(f.store.getCharacter(first.id).body,first.body);
  assert.deepEqual(f.db.prepare('SELECT * FROM revisions WHERE version<=2 ORDER BY id').all(),before.revisions);
  assert.equal(f.store.history.list(s).records[0].action,'回退至版本 1');assert.notEqual(f.commands.revision(),revision);
  assert.throws(()=>f.store.history.restore({token:preview.token}),rejected('CONFLICT'));
});

test('任意并发修改、过期预览或资料库代际变化均阻止旧预览覆盖',t=>{
  const f=fixture(t),c=character(f);edit(f,c,{name:'当前'});const s=selection('character',c);
  let preview=f.store.history.preview(s);character(f,'另一人物');assert.throws(()=>f.store.history.restore({token:preview.token}),rejected('CONFLICT'));
  preview=f.store.history.preview(s);const now=Date.now();t.mock.method(Date,'now',()=>now+11*60*1000);assert.throws(()=>f.store.history.restore({token:preview.token}),rejected('CONFLICT'));t.mock.restoreAll();
  preview=f.store.history.preview(s);f.store.journal.set('generation','restored-generation');assert.throws(()=>f.store.history.restore({token:preview.token}),rejected('RESTORED'));
  f.store.journal.set('requireGeneration','1');preview=f.commands.invoke('previewHistoryRestore',[s],'restored-generation');assert.ok(preview.token);
  assert.throws(()=>f.commands.invoke('previewHistoryRestore',[s],'old-generation'),rejected('RESTORED'));
});

test('无效标签导致回退失败时，临时取消归档等动作也一起撤销',t=>{
  const f=fixture(t),tag=f.store.saveTag({worldId:f.worldId,name:'旧标签',color:'#abcdef',expectedVersion:0});let c=character(f);
  c=edit(f,c,{tagIds:[tag.id]});const s=selection('character',c);f.store.deleteTag(tag.id,tag.version);c=f.store.getCharacter(c.id);f.store.archiveCharacter(c.id,c.version,true);
  const before=dump(f.db);assert.throws(()=>f.store.history.preview(s),/标签/);assert.deepEqual(dump(f.db),before);assert.equal(f.store.getCharacter(c.id).archived,true);
});

test('人物恢复旧阶段快照，后来新增的身份、形态和阶段保留且停用或归档',t=>{
  const f=fixture(t);let c=character(f);
  const stageInput=(name)=>({characterId:c.id,expectedVersion:c.version,name,period:'早期',summary:'',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false});
  const originalStage=f.store.saveCharacterStage(stageInput('最初阶段'));c=f.store.getCharacter(c.id);const s=selection('character',c);
  c=edit(f,c,{body:'后期正文'});f.store.saveCharacterStage({...stageInput('最初阶段'),id:originalStage.id,recapture:true});c=f.store.getCharacter(c.id);
  const identity={id:'later-identity',name:'后来身份',alias:'',title:'',organization:'',visibility:'secret',description:'保留',active:true};
  const form={id:'later-form',name:'后来形态',appearance:'',condition:'',cost:'',abilities:null,portraitMode:'inherit',portraitId:null,portraitWidth:100,attributeMode:'inherit',attributes:{templateId:null,values:{},versions:{}},active:true};
  c=f.store.saveCharacterVariants({characterId:c.id,expectedVersion:c.version,identities:[identity],forms:[form],defaultFormId:form.id});
  const laterStage=f.store.saveCharacterStage(stageInput('后来阶段'));const preview=f.store.history.preview(s);
  assert.ok(preview.differences.some(d=>d.field==='stages'));f.store.history.restore({token:preview.token});c=f.store.getCharacter(c.id);
  assert.equal(c.body,'第一版正文\n第二行');assert.equal(c.defaultFormId,'base');assert.equal(c.identities[0].active,false);assert.equal(c.forms[0].active,false);
  assert.equal(c.stages.find(s=>s.id===laterStage.id).archived,true);assert.equal(c.stages[0].snapshot.profile.body,originalStage.snapshot.profile.body);
  assert.equal(c.stages[0].capturedAt,originalStage.capturedAt);
});

test('不能通过历史回退移除后来加入的地点，也不在失败预览中留下记录',t=>{
  const f=fixture(t),first=f.store.maps.save({worldId:f.worldId,expectedVersion:0,name:'旧地图',description:'',backgroundId:null,stages:[{id:'start',name:'开始'}],locations:[],terrain:[]});
  f.store.maps.save({...first,expectedVersion:first.version,locations:[{id:'town',name:'城镇',kind:'城镇',description:'',x:100,y:100,unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false}]});
  const before=dump(f.db);assert.throws(()=>f.store.history.preview(selection('map',first)),/地点/);assert.deepEqual(dump(f.db),before);
});

test('阶段内冻结的属性维度变化必须显示，回退不改当前属性模板',t=>{
  const f=fixture(t);let c=character(f);
  let template=f.store.saveAttributeTemplate({worldId:f.worldId,name:'战力',expectedVersion:0,expectedDefaultVersion:0,makeDefault:false,dimensions:[{id:'power',name:'灵力',min:0,max:100,unit:'',enabled:true}]});
  c=edit(f,c,{attributes:{templateId:template.id,values:{[template.id]:{power:30}},versions:{[template.id]:template.version}}});
  const stageInput={characterId:c.id,expectedVersion:c.version,name:'初期',period:'',summary:'',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false};
  const stage=f.store.saveCharacterStage(stageInput);c=f.store.getCharacter(c.id);const s=selection('character',c);
  template=f.store.saveAttributeTemplate({...template,expectedVersion:template.version,expectedDefaultVersion:0,makeDefault:false,dimensions:[{...template.dimensions[0],max:200}]});
  c=f.store.getCharacter(c.id);f.store.saveCharacterStage({...stageInput,id:stage.id,expectedVersion:c.version,recapture:true});
  const preview=f.store.history.preview(s),stages=preview.differences.find(d=>d.field==='stages');assert.ok(stages);
  assert.equal(stages.before[0].snapshot.forms[0].attributeSchemas[0].dimensions[0].max,200);
  assert.equal(stages.after[0].snapshot.forms[0].attributeSchemas[0].dimensions[0].max,100);
  f.store.history.restore({token:preview.token});assert.equal(f.store.snapshot().attributeTemplates[0].dimensions[0].max,200);
  assert.equal(f.store.getCharacter(c.id).stages[0].snapshot.forms[0].attributeSchemas[0].dimensions[0].max,100);
});

test('历史分页稳定，按实体隔离，非法类型和编号不能访问其他表',t=>{
  const f=fixture(t);let c=character(f),other=character(f,'其他');for(let i=0;i<53;i++)c=edit(f,c,{name:`版本${i}`});
  const page=f.store.history.list(selection('character',c));assert.equal(page.records.length,50);assert.equal(page.hasMore,true);
  const next=f.store.history.list({...selection('character',c),beforeVersion:page.records.at(-1).version});assert.equal(next.records.length,4);assert.equal(next.hasMore,false);
  assert.equal(f.store.history.list(selection('character',other)).records.length,1);
  for(const kind of ['__proto__','constructor','assets','character; DROP TABLE worlds'])assert.throws(()=>f.store.history.list({kind,entityId:c.id}),rejected('VALIDATION'));
  assert.throws(()=>f.store.history.detail({kind:'world',entityId:c.id,version:1}),rejected('NOT_FOUND'));
  assert.throws(()=>f.store.history.list({kind:'character',entityId:c.id,beforeVersion:-1}),rejected('VALIDATION'));
  assert.throws(()=>f.store.history.preview(selection('character',c)),/当前版本/);
});

test('世界、作品、分类、关系、地图、年表、章节、目录、素材和计划均可回退，依赖版本更新可预览',t=>{
  const f=fixture(t),{store,worldId,work}=f,c=character(f),other=character(f,'同伴');
  const category=store.world.saveCategory({worldId,expectedVersion:0,name:'旧分类',color:'#abcdef',description:'',active:true});
  const entry=store.world.saveEntry({worldId,expectedVersion:0,categoryId:category.id,expectedCategoryVersion:category.version,name:'旧条目',aliases:'',summary:'',body:'旧内容',pending:'',source:'',status:'draft',facts:[],imageId:null,links:[]});
  const type=store.graph.saveType({worldId,expectedVersion:0,name:'旧类型',color:'#abcdef',active:true});
  const relation=store.graph.saveRelation({worldId,expectedVersion:0,sourceId:c.id,targetId:other.id,sourceStageId:null,targetStageId:null,typeId:type.id,expectedTypeVersion:type.version,label:'旧关系',description:'',direction:'forward',status:'confirmed'});
  const map=store.maps.save({worldId,expectedVersion:0,name:'旧地图',description:'',backgroundId:null,stages:[{id:'start',name:'开始'}],locations:[],terrain:[]});
  const timeline=store.timeline.save({worldId,expectedVersion:0,name:'旧年表',description:'',eras:[{id:'era',name:'当世',description:''}],events:[]});
  const chapter=store.chapters.save({workId:work.id,expectedVersion:0,expectedOutlineVersion:store.chapters.getOutline(work.id).version,volumeId:null,name:'旧章节',summary:'',body:'旧正文',notes:'',status:'draft',participants:[],events:[],entryIds:[],mapProgress:[]});
  const outline=store.chapters.saveOutline({...store.chapters.getOutline(work.id),expectedVersion:store.chapters.getOutline(work.id).version,synopsis:'旧大纲'});
  const asset=store.importImage(worldId,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),'image.png');
  const media=store.gallery.save({...store.gallery.get(asset.id),expectedVersion:0,name:'旧素材'});
  const catalog=store.gallery.saveCatalog({worldId,expectedVersion:0,categories:[{id:'cat',name:'旧素材分类',color:'#abcdef',active:true}],tags:[]});
  const dashboard=store.dashboard.save({...store.dashboard.get(work.id),expectedVersion:0,memo:'旧备忘'});
  const cases=[
    ['world',store.workspace.getWorld(worldId),v=>store.workspace.saveWorld({...v,expectedVersion:v.version,name:'新世界'})],
    ['work',work,v=>store.workspace.saveWork({...v,expectedVersion:v.version,name:'新作品'})],
    ['worldEntry',entry,v=>store.world.saveEntry({...v,expectedVersion:v.version,expectedCategoryVersion:category.version,name:'新条目'})],
    ['worldCategory',category,v=>store.world.saveCategory({...v,expectedVersion:v.version,name:'新分类'})],
    ['relation',relation,v=>store.graph.saveRelation({...v,expectedVersion:v.version,expectedTypeVersion:type.version,label:'新关系'})],
    ['relationType',type,v=>store.graph.saveType({...v,expectedVersion:v.version,name:'新类型'})],
    ['map',map,v=>store.maps.save({...v,expectedVersion:v.version,name:'新地图'})],
    ['timeline',timeline,v=>store.timeline.save({...v,expectedVersion:v.version,name:'新年表'})],
    ['chapter',chapter,v=>store.chapters.save({...v,expectedVersion:v.version,expectedOutlineVersion:store.chapters.getOutline(work.id).version,name:'新章节'})],
    ['outline',outline,v=>store.chapters.saveOutline({...v,expectedVersion:v.version,synopsis:'新大纲'})],
    ['media',media,v=>store.gallery.save({...v,expectedVersion:v.version,name:'新素材'})],
    ['mediaCatalog',catalog,v=>store.gallery.saveCatalog({...v,expectedVersion:v.version,categories:v.categories.map(c=>({...c,name:'新素材分类'}))})],
    ['dashboard',dashboard,v=>store.dashboard.save({...v,expectedVersion:v.version,memo:'新备忘'})]
  ];
  for(const [kind,first,update] of cases){
    const edited=update(first),s=selection(kind,first),before=dump(f.db),preview=store.history.preview(s);
    assert.deepEqual(dump(f.db),before,kind+' preview must roll back');
    if(kind==='worldCategory')assert.ok(preview.affected.some(a=>a.kind==='worldEntry'));
    if(kind==='relationType')assert.ok(preview.affected.some(a=>a.kind==='relation'));
    const restored=store.history.restore({token:preview.token});assert.ok(restored.version>edited.version,kind);
    assert.equal(store.history.detail(s).differences.length,0,kind);
    assert.ok(historyEntities(store.snapshot(),kind).some(e=>e.id===s.entityId));
  }
});
