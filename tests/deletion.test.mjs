import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import Database from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {contentCommands} from '../src/core/commands.ts';
import {digest} from '../src/core/backup-journal.ts';
import {blankChapter} from '../src/shared/chapters.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'oc-deletion-')),db=new Database(join(directory,'library.sqlite')),store=new LibraryStore(db,directory);
  const work=store.workspace.createWork({name:'测试作品',world:{kind:'new',name:'测试世界',description:'世界说明'}});
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-deletion-'))throw Error('Unexpected cleanup path');rmSync(target,{recursive:true,force:true});});
  return {directory,db,store,work,worldId:work.worldId,commands:contentCommands(store)};
}
const character=(f,patch={})=>f.store.saveCharacter({worldId:f.worldId,expectedVersion:0,name:'人物',caption:'',status:'草稿',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null,...patch});
const chapter=(f,patch={})=>f.store.chapters.save({...blankChapter(f.store.chapters.getOutline(patch.workId??f.work.id)),name:'初见',body:'首段\n\n第二段。',...patch});
const pack=f=>f.store.transfer.export({format:'package',scope:'work',id:f.work.id});
const mutate=(file,fn)=>{const wrapper=JSON.parse(file.content);fn(wrapper.data);return {...file,content:JSON.stringify({data:wrapper.data,sha256:digest(JSON.stringify(wrapper.data))})};};
const dump=f=>JSON.stringify(f.store.journal.allRows());
function rich(f){
  const {store:s,worldId:w}=f,asset=s.importImage(w,png,'原图.png',{width:1,height:1});
  const tag=s.saveTag({worldId:w,name:'标签',color:'#abcdef',expectedVersion:0});
  const template=s.saveAttributeTemplate({worldId:w,name:'属性',expectedVersion:0,expectedDefaultVersion:0,makeDefault:true,dimensions:[{id:'power',name:'灵力',min:0,max:100,unit:'',enabled:true}]});
  const attributes={templateId:template.id,values:{[template.id]:{power:0}},versions:{[template.id]:template.version}};
  let c=character(f,{tagIds:[tag.id],portraitId:asset.id,attributes,body:asset.id});
  c=s.saveCharacterVariants({characterId:c.id,expectedVersion:c.version,identities:[{id:'identity',name:'隐藏身份',alias:'旧名',title:'',organization:'',visibility:'secret',description:'',active:true}],forms:[{id:'form',name:'觉醒',appearance:'',condition:'',cost:'',abilities:null,portraitMode:'custom',portraitId:asset.id,portraitWidth:100,attributeMode:'custom',attributes,active:true}],defaultFormId:'form'});
  const stage=s.saveCharacterStage({characterId:c.id,expectedVersion:c.version,name:'前期',period:'第一章',summary:'',identityIds:['identity'],formIds:['base','form'],defaultFormId:'form',attributeValues:{},archived:false});
  const second=character(f,{name:'另一人物'}),type=s.graph.saveType({worldId:w,name:'师徒',color:'#abcdef',active:true,expectedVersion:0});
  s.graph.saveRelation({worldId:w,sourceId:c.id,targetId:second.id,sourceStageId:stage.id,targetStageId:null,typeId:type.id,expectedTypeVersion:type.version,expectedVersion:0,label:'同行',description:'',direction:'forward',status:'confirmed'});
  s.graph.saveLayout({worldId:w,expectedVersion:0,positions:{[c.id]:{x:10,y:20}}});
  const category=s.world.saveCategory({worldId:w,name:'地点',color:'#abcdef',description:'',active:true,expectedVersion:0});
  const entry=s.world.saveEntry({worldId:w,categoryId:category.id,expectedCategoryVersion:category.version,expectedVersion:0,name:'渡口',aliases:'',summary:'',body:'设定正文',pending:'',source:'',status:'draft',facts:[],imageId:asset.id,links:[{kind:'character',targetId:c.id,label:''}]});
  const map=s.maps.save({worldId:w,expectedVersion:0,name:'地图',description:'',backgroundId:asset.id,stages:[{id:'start',name:'开始'}],terrain:[],locations:[{id:'port',name:'港口',kind:'城镇',description:'',x:10,y:20,unlockStageId:'start',imageId:asset.id,entryIds:[entry.id],characterIds:[c.id],favorite:false,archived:false}]});
  const timeline=s.timeline.save({worldId:w,expectedVersion:0,name:'前史',description:'',eras:[{id:'era',name:'当世',description:''}],events:[{id:'event',eraId:'era',name:'相遇',period:'',endPeriod:'',summary:'',body:'',status:'confirmed',participants:[{characterId:c.id,stageId:stage.id}],entryIds:[entry.id],places:[{mapId:map.id,locationId:'port'}],mapProgress:[{mapId:map.id,stageId:'start'}],archived:false}]});
  const ch=chapter(f,{participants:[{characterId:c.id,stageId:stage.id}],events:[{timelineId:timeline.id,eventId:'event'}],entryIds:[entry.id],mapProgress:[{mapId:map.id,stageId:'start'}]});
  s.gallery.saveCatalog({worldId:w,expectedVersion:0,categories:[{id:'art',name:'立绘',color:'#abcdef',active:true}],tags:[{id:'tag',name:'参考',color:'#abcdef',active:true}]});
  s.gallery.save({...s.gallery.get(asset.id),expectedVersion:0,categoryId:'art',tagIds:['tag'],description:'素材说明'});
  s.dashboard.save({...s.dashboard.get(f.work.id),expectedVersion:0,coverId:asset.id,tasks:[{id:'task',title:'完善',done:false}]});
  return {asset,c:s.getCharacter(c.id),stage,entry,map,timeline,ch,template};
}


const preview=(f,kind,id,parentId)=>f.store.deletion.preview({kind,id,parentId});
const remove=(f,kind,id,parentId)=>{const p=preview(f,kind,id,parentId);assert.deepEqual(p.blockers,[],JSON.stringify(p.blockers));return f.store.deletion.confirm({token:p.token,name:p.target.name});};
test('删除作品清理章节大纲计划和历史，共用世界与另一部作品保持完整，最后一部可删除',t=>{
 const f=fixture(t),r=rich(f),s=f.store;
 const other=s.workspace.createWork({name:'同世界外传',world:{kind:'existing',id:f.worldId}});const kept=chapter(f,{workId:other.id,name:'保留正文'});
 s.workspace.selectWork(f.work.id);const before=s.snapshot(),p=preview(f,'work',f.work.id);
 assert.ok(p.included.some(v=>v.id===r.ch.id));assert.deepEqual(s.snapshot(),before);
 s.deletion.confirm({token:p.token,name:p.target.name});assert.equal(s.workspace.activeWorkId(),other.id);assert.deepEqual(s.chapters.get(kept.id),kept);
 const after=s.snapshot();for(const key of ['characters','worlds','worldEntries','maps','timelines','media','relations'])assert.deepEqual(after[key],before[key],key);
 for(const table of ['work_outlines','work_dashboards'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table+' WHERE work_id=?').get(f.work.id).n,0);
 for(const table of ['outline_history','dashboard_history','chapter_history'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table+' WHERE entity_id=?').get(table==='chapter_history'?r.ch.id:f.work.id).n,0);
 remove(f,'work',other.id);assert.equal(s.snapshot().activeWorkId,null);assert.deepEqual(s.snapshot().works,[]);
 const next=s.workspace.createWork({name:'重新开始',world:{kind:'existing',id:f.worldId}});assert.equal(s.workspace.activeWorkId(),next.id);
});
test('删除整个世界按依赖顺序清理，独立世界保留，资料包仍可导入',t=>{
 const f=fixture(t);rich(f);const next=f.store.workspace.createWork({name:'保留作品',world:{kind:'new',name:'保留世界',description:''}});
 const p=preview(f,'world',f.worldId);assert.ok(p.included.length>20);assert.deepEqual(p.blockers,[]);f.store.deletion.confirm({token:p.token,name:p.target.name});
 const snap=f.store.snapshot();assert.deepEqual(snap.worlds.map(v=>v.id),[next.worldId]);assert.deepEqual(snap.works.map(v=>v.id),[next.id]);assert.equal(snap.characters.length,0);assert.equal(snap.media.length,0);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);const file=f.store.transfer.export({format:'package',scope:'library'});assert.ok(f.store.transfer.preview(file).token);
});
test('所有结构引用会阻止删除，归档内容与冻结阶段也参与检查',t=>{
 const f=fixture(t),r=rich(f),s=f.store;s.chapters.archive(r.ch.id,r.ch.version,true);
 for(const [kind,id,parentId] of [['character',r.c.id],['stage',r.stage.id,r.c.id],['media',r.asset.id],['attributeTemplate',r.template.id],['map',r.map.id],['location','port',r.map.id],['mapStage','start',r.map.id],['worldEntry',r.entry.id],['timeline',r.timeline.id],['event','event',r.timeline.id],['era','era',r.timeline.id],['mediaCategory','art',f.worldId],['mediaTag','tag',f.worldId]]){
   const before=dump(f),p=preview(f,kind,id,parentId);assert.ok(p.blockers.length,kind);assert.throws(()=>s.deletion.confirm({token:p.token,name:p.target.name}),e=>e.code==='VALIDATION');assert.equal(dump(f),before,kind);
 }
});
test('删除子项更新父版本和历史，默认形态回到基础，冻结阶段保留原内容',t=>{
 const f=fixture(t),r=rich(f),s=f.store;
 remove(f,'identity','identity',r.c.id);remove(f,'form','form',r.c.id);
 const c=s.getCharacter(r.c.id);assert.equal(c.version,r.c.version+2);assert.equal(c.identities.length,0);assert.equal(c.forms.length,0);assert.equal(c.defaultFormId,'base');assert.deepEqual(c.stages,r.c.stages);
 assert.throws(()=>s.saveCharacterVariants({characterId:c.id,expectedVersion:r.c.version,identities:[]}),e=>e.code==='CONFLICT');
});
test('删除预览绑定资料序列、代次、名称、有效期并且只能消费一次',t=>{
 const f=fixture(t),s=f.store;let p=preview(f,'work',f.work.id);s.workspace.saveWork({id:f.work.id,name:'改名',expectedVersion:f.work.version});
 assert.throws(()=>s.deletion.confirm({token:p.token,name:p.target.name}),e=>e.code==='CONFLICT');
 p=preview(f,'work',f.work.id);assert.throws(()=>s.deletion.confirm({token:p.token,name:'错误名称'}),e=>e.code==='VALIDATION');assert.throws(()=>s.deletion.confirm({token:p.token,name:p.target.name}),e=>e.code==='CONFLICT');
 p=preview(f,'work',f.work.id);s.journal.set('generation','restored');assert.throws(()=>s.deletion.confirm({token:p.token,name:p.target.name}),e=>e.code==='RESTORED');
 p=preview(f,'work',f.work.id);const now=Date.now();t.mock.method(Date,'now',()=>now+600001);assert.throws(()=>s.deletion.confirm({token:p.token,name:p.target.name}),e=>e.code==='CONFLICT');t.mock.restoreAll();
 remove(f,'work',f.work.id);assert.throws(()=>preview(f,'work',f.work.id),e=>e.code==='NOT_FOUND');
});
test('删除事务中途失败时内容、历史与增量日志整体回滚',t=>{
 const f=fixture(t);rich(f);const before=dump(f),seq=f.store.journal.sequence(),p=preview(f,'world',f.worldId);
 f.db.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON worlds BEGIN SELECT RAISE(ABORT,'forced deletion failure'); END");
 assert.throws(()=>f.store.deletion.confirm({token:p.token,name:p.target.name}),/forced deletion failure/);assert.equal(dump(f),before);assert.equal(f.store.journal.sequence(),seq);
});
test('删除章节更新目录并在重启后保留，删除记录进入增量日志',t=>{
 const f=fixture(t),c=chapter(f),seq=f.store.journal.sequence();remove(f,'chapter',c.id);assert.deepEqual(f.store.chapters.getOutline(f.work.id).chapterIds,[]);
 assert.ok(f.store.journal.changes(seq,f.store.journal.sequence()).some(v=>v.table==='chapters'&&v.row===null));
 f.store.close();const reopened=new LibraryStore(new Database(join(f.directory,'library.sqlite')),f.directory);try{assert.equal(reopened.snapshot().chapters.length,0);assert.deepEqual(reopened.chapters.getOutline(f.work.id).chapterIds,[]);}finally{reopened.close();}
});

test('全部 23 类资料可通过统一接口实际删除，剩余资料包持续通过关联校验',t=>{
 const f=fixture(t),r=rich(f),s=f.store;
 s.maps.save({...r.map,expectedVersion:r.map.version,stages:[...r.map.stages,{id:'spare',name:'后期'}]});
 s.timeline.save({...r.timeline,expectedVersion:r.timeline.version,eras:[...r.timeline.eras,{id:'spare',name:'后世',description:''}]});
 const o=s.chapters.getOutline(f.work.id);s.chapters.saveOutline({...o,expectedVersion:o.version,volumes:[{id:'volume',name:'空卷',summary:''}]});
 const snap=s.snapshot(),types=new Set();
 const targets=[['identity','identity',r.c.id],['form','form',r.c.id],['chapter',r.ch.id],['event','event',r.timeline.id],['era','era',r.timeline.id],['timeline',r.timeline.id],['location','port',r.map.id],['mapStage','start',r.map.id],['map',r.map.id],['relation',snap.relations[0].id],['stage',r.stage.id,r.c.id],['worldEntry',r.entry.id],['worldCategory',snap.worldCategories[0].id],...snap.characters.map(c=>['character',c.id]),['relationType',snap.relationTypes[0].id],['tag',snap.tags[0].id],['attributeTemplate',r.template.id],['media',r.asset.id],['mediaCategory','art',f.worldId],['mediaTag','tag',f.worldId],['volume','volume',f.work.id],['work',f.work.id],['world',f.worldId]];
 for(const [kind,id,parentId] of targets){
   if(kind==='media'){const d=s.dashboard.get(f.work.id);s.dashboard.save({...d,expectedVersion:d.version,coverId:null});}
   remove(f,kind,id,parentId);types.add(kind);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[],kind);
   if(kind!=='world'){const file=s.transfer.export({format:'package',scope:'library'});const p=s.transfer.preview(file);assert.ok(p.token,kind);s.transfer.cancel({token:p.token});}
 }
 assert.equal(types.size,23);assert.equal(s.snapshot().works.length,0);assert.equal(s.snapshot().worlds.length,0);
});
