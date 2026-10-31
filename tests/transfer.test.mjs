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
  const directory=mkdtempSync(join(tmpdir(),'oc-transfer-')),db=new Database(join(directory,'library.sqlite')),store=new LibraryStore(db,directory);
  const work=store.workspace.createWork({name:'测试作品',world:{kind:'new',name:'测试世界',description:'世界说明'}});
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-transfer-'))throw Error('Unexpected cleanup path');rmSync(target,{recursive:true,force:true});});
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

test('完整资料包往返：所有内容表、图片、阶段与历史保留，原库不变且重复导入独立',t=>{
  const f=fixture(t),r=rich(f),file=pack(f),before=dump(f),sequence=f.store.journal.sequence(),revision=f.commands.revision();
  const p=f.commands.invoke('previewTransferImport',[file]);
  assert.equal(dump(f),before);assert.equal(f.store.journal.sequence(),sequence);assert.equal(f.commands.revision(),revision);assert.equal(p.characters,2);assert.equal(p.images,1);assert.equal(p.chapters,1);assert.ok(p.histories>10);
  const result=f.commands.invoke('importTransfer',[{token:p.token}]),s=f.store.snapshot(),newWorld=result.worldIds[0],c=s.characters.find(c=>c.worldId===newWorld&&c.name==='人物');
  assert.notEqual(c.id,r.c.id);assert.equal(c.body,r.asset.id);assert.notEqual(c.portraitId,r.asset.id);assert.equal(c.stages[0].snapshot.profile.body,r.asset.id);
  const template=s.attributeTemplates.find(x=>x.worldId===newWorld);assert.equal(c.attributes.values[template.id][template.dimensions[0].id],0);assert.equal(c.forms[0].attributes.values[template.id][template.dimensions[0].id],0);
  const ch=s.chapters.find(x=>x.workId===result.workIds[0]),map=s.maps.find(x=>x.worldId===newWorld),timeline=s.timelines.find(x=>x.worldId===newWorld);
  assert.equal(ch.participants[0].characterId,c.id);assert.equal(ch.participants[0].stageId,c.stages[0].id);assert.equal(ch.mapProgress[0].mapId,map.id);assert.equal(ch.mapProgress[0].stageId,map.stages[0].id);assert.equal(ch.events[0].eventId,timeline.events[0].id);assert.equal(timeline.events[0].places[0].locationId,map.locations[0].id);
  assert.deepEqual(s.graphLayouts.find(g=>g.worldId===newWorld).positions[c.id],{x:10,y:20});assert.deepEqual(f.store.getCharacter(r.c.id),r.c);assert.deepEqual(f.store.chapters.get(r.ch.id),r.ch);
  assert.equal(f.db.prepare('SELECT count(*) n FROM revisions WHERE character_id=?').get(c.id).n,f.db.prepare('SELECT count(*) n FROM revisions WHERE character_id=?').get(r.c.id).n);
  assert.equal(readdirSync(f.store.mediaDir).length,1);assert.deepEqual(readFileSync(join(f.store.mediaDir,r.asset.fileName)),png);
  const again=f.store.transfer.confirm({token:f.store.transfer.preview(file).token});assert.notEqual(again.workIds[0],result.workIds[0]);assert.equal(f.store.snapshot().works.length,3);
  // An imported copy must itself remain exportable and importable.
  const next=f.store.transfer.export({format:'package',scope:'work',id:result.workIds[0]});assert.equal(f.store.transfer.preview(next).characters,2);
});

test('作品、世界、全库范围正确，共用世界完整且不泄漏其他作品正文和设置',t=>{
  const f=fixture(t);rich(f);const shared=f.store.workspace.createWork({name:'共享作品',world:{kind:'existing',id:f.worldId}});chapter(f,{workId:shared.id,body:'另一本私有正文'});
  const other=f.store.workspace.createWork({name:'独立作品',world:{kind:'new',name:'独立世界',description:''}});chapter(f,{workId:other.id});f.store.setTheme('paper');f.store.journal.set('settings','private-settings');
  const file=pack(f),p=f.store.transfer.preview(file);assert.equal(p.works.length,1);assert.equal(p.worlds.length,1);assert.ok(!file.content.includes('另一本私有正文'));assert.ok(!file.content.includes('private-settings'));assert.ok(!JSON.parse(file.content).data.rows.some(r=>r.table==='meta'));
  const world=f.store.transfer.preview(f.store.transfer.export({format:'package',scope:'world',id:f.worldId}));assert.equal(world.works.length,2);assert.equal(world.chapters,2);
  const all=f.store.transfer.preview(f.store.transfer.export({format:'package',scope:'library'}));assert.equal(all.worlds.length,2);assert.equal(all.works.length,3);
});

test('损坏校验、未知表、跨世界引用、JSON 编号不一致、丢失图片与目录均拒绝且预览不落库',t=>{
  const f=fixture(t);rich(f);const file=pack(f),before=dump(f);
  for(const edit of [d=>d.schema='other',d=>d.rows.push({table:'meta',row:{key:'active-work',value:'x'}}),d=>d.images=[],d=>d.images[0].name='../bad.png',d=>d.rows=d.rows.filter(r=>r.table!=='world_categories'),d=>{const r=d.rows.find(r=>r.table==='chapters');const c=JSON.parse(r.row.chapter_json);c.worldId='missing';r.row.chapter_json=JSON.stringify(c);},d=>d.rows=d.rows.filter(r=>r.table!=='work_outlines')]){
    assert.throws(()=>f.store.transfer.preview(mutate(file,edit)));assert.equal(dump(f),before);
  }
  assert.throws(()=>f.store.transfer.preview({...file,content:file.content.replace('渡口','篡改')}),/校验/);assert.equal(dump(f),before);
});

test('取消、过期、其他窗口修改及恢复代次会使确认失效，一次性令牌不可重放',t=>{
  const f=fixture(t),input={name:'一章.txt',content:'正文',workId:f.work.id};
  let p=f.commands.invoke('previewTransferImport',[input]);f.commands.invoke('cancelTransferImport',[{token:p.token}]);assert.throws(()=>f.commands.invoke('importTransfer',[{token:p.token}]),e=>e.code==='CONFLICT');
  p=f.store.transfer.preview(input);character(f);assert.throws(()=>f.store.transfer.confirm({token:p.token}),e=>e.code==='CONFLICT');
  p=f.store.transfer.preview(input);const now=Date.now();t.mock.method(Date,'now',()=>now+660000);assert.throws(()=>f.store.transfer.confirm({token:p.token}),e=>e.code==='CONFLICT');t.mock.restoreAll();
  p=f.store.transfer.preview(input);f.store.journal.set('generation','next');assert.throws(()=>f.store.transfer.confirm({token:p.token}),e=>e.code==='RESTORED');
  f.store.journal.set('requireGeneration','1');assert.throws(()=>f.commands.invoke('previewTransferImport',[input],'old'),e=>e.code==='RESTORED');
  p=f.commands.invoke('previewTransferImport',[input],'next');f.commands.invoke('importTransfer',[{token:p.token}],'next');assert.throws(()=>f.commands.invoke('importTransfer',[{token:p.token}],'next'),e=>e.code==='CONFLICT');
});

test('正文分章、空行与代码块预览，确认原子追加并保留原目录；支持整篇模式',t=>{
  const f=fixture(t),existing=chapter(f),before=dump(f),input={name:'新稿.md',content:'# 书名\n\n## 初遇\n\n第一段\n\n第二段\n\n```md\n## 这不是章节\n```\n\n## 离别\n\n最后一段',workId:f.work.id};
  const p=f.store.transfer.preview(input);assert.equal(p.chapters,2);assert.deepEqual(p.chapterPreviews.map(c=>c.name),['初遇','离别']);assert.equal(dump(f),before);
  const r=f.store.transfer.confirm({token:p.token});assert.deepEqual(f.store.chapters.get(existing.id),existing);assert.deepEqual(f.store.chapters.getOutline(f.work.id).chapterIds,[existing.id,...r.chapterIds]);assert.match(f.store.chapters.get(r.chapterIds[0]).body,/第一段\n\n第二段/);assert.match(f.store.chapters.get(r.chapterIds[0]).body,/## 这不是章节/);
  assert.equal(f.store.transfer.preview({...input,split:'single'}).chapters,1);
  assert.equal(f.store.transfer.preview({name:'新稿.txt',content:'第一章 春\n正文\n\n第二章 秋\n正文二',workId:f.work.id}).chapters,2);
});

test('导入失败事务回滚：章节、目录、历史、日志和新图片均无部分落库',t=>{
  const f=fixture(t),source=fixture(t);rich(source);const file=pack(source),p=f.store.transfer.preview(file),before=dump(f),sequence=f.store.journal.sequence();
  f.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON chapters BEGIN SELECT RAISE(ABORT,'forced import failure'); END");
  assert.throws(()=>f.store.transfer.confirm({token:p.token}),/forced import/);assert.equal(dump(f),before);assert.equal(f.store.journal.sequence(),sequence);assert.equal(readdirSync(f.store.mediaDir).length,0);
  f.db.exec('DROP TRIGGER fail_import');const text=f.store.transfer.preview({name:'稿.txt',content:'第一章\n甲\n第二章\n乙',workId:f.work.id});
  f.db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON chapters WHEN (SELECT count(*) FROM chapters)>0 BEGIN SELECT RAISE(ABORT,'second chapter failure'); END");
  assert.throws(()=>f.store.transfer.confirm({token:text.token}),/second chapter/);assert.equal(dump(f),before);assert.equal(f.store.journal.sequence(),sequence);
});

test('正文导出按分卷目录顺序、可选归档；Markdown 导回保留章名正文',t=>{
  const f=fixture(t);f.store.chapters.saveOutline({...f.store.chapters.getOutline(f.work.id),expectedVersion:0,volumes:[{id:'v2',name:'第二卷',summary:''},{id:'v1',name:'第一卷',summary:''}]});
  const a=chapter(f,{name:'A',volumeId:'v1'}),b=chapter(f,{name:'B',volumeId:'v2'}),c=chapter(f,{name:'C'});f.store.chapters.archive(c.id,c.version,true);
  const input={format:'markdown',scope:'work',id:f.work.id},file=f.store.transfer.export(input);assert.ok(file.content.indexOf('## B')<file.content.indexOf('## A'));assert.ok(!file.content.includes('## C'));
  assert.ok(f.store.transfer.export({...input,includeArchived:true}).content.includes('## C'));
  const p=f.store.transfer.preview({...file,workId:f.work.id}),r=f.store.transfer.confirm({token:p.token});assert.deepEqual(r.chapterIds.map(id=>f.store.chapters.get(id).name),['B','A']);assert.equal(f.store.chapters.get(r.chapterIds[0]).body,b.body);assert.equal(f.store.chapters.get(r.chapterIds[1]).body,a.body);
});

test('已归档人物、章节、图片及冻结阶段保留，导入的历史仍可预览',t=>{
  const f=fixture(t),r=rich(f);f.store.archiveCharacter(r.c.id,r.c.version,true);f.store.chapters.archive(r.ch.id,r.ch.version,true);const m=f.store.gallery.get(r.asset.id);f.store.gallery.archive(m.id,m.version,true);
  const p=f.store.transfer.preview(pack(f)),result=f.store.transfer.confirm({token:p.token}),s=f.store.snapshot(),c=s.characters.find(c=>c.worldId===result.worldIds[0]&&c.name==='人物');
  assert.equal(c.archived,true);assert.equal(s.chapters.find(c=>c.workId===result.workIds[0]).archived,true);assert.equal(s.media.find(m=>m.worldId===result.worldIds[0]).archived,true);
  const detail=f.store.history.detail({kind:'character',entityId:c.id,version:1});assert.equal(detail.selection.entityId,c.id);
});
