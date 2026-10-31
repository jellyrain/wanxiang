import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {BackupService} from '../src/core/backups.ts';
import {contentCommands} from '../src/core/commands.ts';
import {digest} from '../src/core/backup-journal.ts';
import {blankChapter} from '../src/shared/chapters.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const rejects=code=>error=>error.code===code;
const base=resolve('test-results/backup-tests');mkdirSync(base,{recursive:true});
function fixture(t){
  const directory=mkdtempSync(join(base,'case-')),db=new Database(join(directory,'library.sqlite')),store=new LibraryStore(db,directory),commands=contentCommands(store);
  const backup=new BackupService({store,directory,openDatabase:path=>new Database(path),onRestored:commands.changed});
  db.exec("INSERT INTO worlds VALUES('a','山海'),('b','星海'); INSERT INTO works VALUES('one','a','墨影'),('two','a','外传'),('three','b','远行')");
  t.after(()=>{backup.stop();if(db.open)store.close();});
  return {directory,db,store,commands,backup,root:backup.status().settings.directory};
}
const baseline=f=>f.backup.baseline(f.backup.estimate());

test('退出时等待已启动的备份提交，禁止开始新的自动或手动备份',async t=>{
  const f=fixture(t);const pending=baseline(f);
  assert.ok(f.backup.status().busy);f.store.closing=true;f.backup.stop();
  let idle=false;const stopped=f.backup.waitIdle().then(()=>idle=true);
  assert.equal(idle,false);
  await assert.rejects(()=>f.backup.increment(),rejects('BUSY'));
  assert.throws(()=>f.backup.saveSettings(f.backup.status().settings),rejects('BUSY'));
  await f.backup.tick(Number.MAX_SAFE_INTEGER);
  const point=await pending;await stopped;assert.ok(idle);assert.equal(f.backup.status().headId,point.point.id);
  assert.equal(f.backup.status().points.length,1);assert.equal(f.backup.status().lastError,null);
});
function changeWork(f,name='新标题'){const work=f.store.workspace.getWork('one');return f.commands.invoke('saveWork',[{id:work.id,name,expectedVersion:work.version}],f.store.snapshot().generation);}
function dataRows(f){return f.store.journal.allRows();}
function records(f,id){return JSON.parse(readFileSync(join(f.root,'points',id,'records.json'),'utf8'));}
function character(f,extra={}){return f.store.saveCharacter({worldId:'a',expectedVersion:0,name:'测试旅人',caption:'',status:'待定',quote:'',intro:'简介',body:'人物完整正文',pending:'',facts:[],tagIds:[],portraitId:null,...extra});}
function populate(f){
  const {store}=f,asset=store.importImage('a',png,'旅人.png',{width:1,height:1});
  const tag=store.saveTag({worldId:'a',name:'主角',color:'#bda374',expectedVersion:0});
  let c=character(f,{portraitId:asset.id,tagIds:[tag.id]});
  const stage=store.saveCharacterStage({characterId:c.id,expectedVersion:c.version,name:'早期',period:'第一年',summary:'冻结阶段',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false});
  c=store.getCharacter(c.id);
  const other=character(f,{name:'同伴'}),type=store.graph.saveType({worldId:'a',expectedVersion:0,name:'同门',color:'#bda374',active:true});
  store.graph.saveRelation({worldId:'a',sourceId:c.id,targetId:other.id,sourceStageId:stage.id,targetStageId:null,typeId:type.id,expectedTypeVersion:type.version,label:'旧识',description:'一起修行',direction:'mutual',status:'confirmed',expectedVersion:0});
  const category=store.world.saveCategory({worldId:'a',name:'规则',color:'#bda374',description:'',active:true,expectedVersion:0});
  const entry=store.world.saveEntry({worldId:'a',categoryId:category.id,expectedCategoryVersion:category.version,name:'灵气',aliases:'',summary:'天地规则',body:'世界完整正文',pending:'',source:'',status:'adopted',facts:[],imageId:asset.id,links:[{kind:'character',targetId:c.id,label:'关联人物'}],expectedVersion:0});
  const chapter=store.chapters.save({...blankChapter(store.chapters.getOutline('one')),name:'第一章',body:'章节正文\n第二段',participants:[{characterId:c.id,stageId:stage.id}],entryIds:[entry.id]});
  store.maps.save({worldId:'a',name:'山河',description:'',backgroundId:asset.id,stages:[{id:'start',name:'开篇'}],locations:[],terrain:[],expectedVersion:0});
  store.timeline.save({worldId:'a',name:'编年',description:'',eras:[{id:'first',name:'第一纪',description:''}],events:[],expectedVersion:0});
  return {asset,tag,c,other,stage,chapter};
}

test('日志覆盖全部内容表，数据与日志同事务回滚，空更新不产生增量',t=>{
  const f=fixture(t),before=f.store.journal.sequence(),triggers=f.db.prepare("SELECT tbl_name FROM sqlite_master WHERE type='trigger' AND name GLOB '_backup_*'").all();
  assert.deepEqual([...new Set(triggers.map(r=>r.tbl_name))].sort(),f.store.journal.tables.map(t=>t.name).sort());
  f.db.exec("UPDATE worlds SET name=name; BEGIN; UPDATE worlds SET name='不会保留'; ROLLBACK;");
  assert.equal(f.store.journal.sequence(),before);
  f.db.exec("BEGIN; INSERT INTO tags(id,world_id,name) VALUES('tag','a','临时'); UPDATE tags SET name='新名'; DELETE FROM tags; COMMIT;");
  assert.deepEqual(f.store.journal.changes(before,f.store.journal.sequence()).map(c=>c.row?.name??null),['临时','新名',null]);
  assert.equal(f.store.workspace.getWorld('a').name,'山海');
});

test('没有基准时自动与手动增量均拒绝，不会偷偷创建首个全量',async t=>{
  const f=fixture(t);f.backup.saveSettings({...f.backup.status().settings,automatic:true});
  await f.backup.tick();assert.equal(f.backup.status().needsBaseline,true);assert.match(f.backup.status().lastError,/手动建立基准/);
  assert.equal(f.backup.status().points.length,0);assert.equal(existsSync(join(f.root,'repository.json')),false);
  await assert.rejects(()=>f.backup.increment(),rejects('BASELINE_REQUIRED'));
  assert.equal(f.backup.status().points.length,0);
});

test('手动基准需有效预览，普通增量只包含变化记录，不拷贝整个库',async t=>{
  const f=fixture(t);populate(f);const estimate=f.backup.estimate();changeWork(f);
  await assert.rejects(()=>f.backup.baseline(estimate),rejects('CONFLICT'));
  const initial=await baseline(f);changeWork(f,'只改一个作品名');const next=await f.backup.increment();
  assert.equal(next.point.kind,'increment');assert.equal(next.point.parentId,initial.point.id);
  assert.ok(next.point.records<initial.point.records);assert.deepEqual([...new Set(records(f,next.point.id).map(r=>r.table))].sort(),['work_settings','works','workspace_history']);
  assert.equal(records(f,next.point.id).some(r=>r.table==='chapters'),false);
  assert.equal(next.point.newImages,0);assert.equal(f.backup.status().pendingChanges,0);
  assert.equal((await f.backup.increment()).skipped,true);assert.equal(f.backup.status().points.length,2);
});

test('图片跨世界按内容去重，自动增量无变化跳过，重启不重记原数据',async t=>{
  const f=fixture(t);f.store.importImage('a',png,'A.png');await baseline(f);
  f.store.importImage('b',png,'B.png');const result=await f.backup.increment();assert.equal(result.point.newImages,0);assert.equal(readdirSync(join(f.root,'objects')).length,1);
  f.backup.saveSettings({...f.backup.status().settings,automatic:true});await f.backup.tick();assert.equal(f.backup.status().points.length,2);
  const rows=dataRows(f);f.store.close();const db=new Database(join(f.directory,'library.sqlite')),reopened=new LibraryStore(db,f.directory);
  try{assert.deepEqual(reopened.journal.allRows(),rows);assert.equal(reopened.journal.changes(0,reopened.journal.sequence()).length,0);}finally{reopened.close();}
});

test('图片缺失时不推进游标，修复后补存完整增量，失败目录不当作恢复点',async t=>{
  const f=fixture(t);await baseline(f);const head=f.backup.status().headId;
  const asset=f.store.importImage('a',png,'图.png'),path=join(f.store.mediaDir,asset.fileName);unlinkSync(path);
  await assert.rejects(()=>f.backup.increment());assert.equal(f.backup.status().headId,head);assert.ok(f.backup.status().pendingChanges>0);
  const partial=join(f.root,'points',randomUUID());mkdirSync(partial);writeFileSync(join(partial,'records.json'),'[]');
  assert.equal(f.backup.status().repositoryError,null);writeFileSync(path,png);
  const result=await f.backup.increment();assert.equal(result.point.newImages,1);assert.equal(f.backup.status().pendingChanges,0);assert.equal(f.backup.status().points.length,2);
});

test('文件提交后游标写入失败，重试仍从旧游标补齐，没有漏掉变更',async t=>{
  const f=fixture(t);await baseline(f);const head=f.backup.status().headId;changeWork(f);
  f.db.exec("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON _backup_meta WHEN NEW.key='checkpoint' BEGIN SELECT RAISE(ABORT,'simulated commit failure'); END");
  await assert.rejects(()=>f.backup.increment());assert.equal(f.backup.status().headId,head);assert.ok(f.backup.status().pendingChanges>0);
  f.db.exec('DROP TRIGGER reject_checkpoint');const result=await f.backup.increment();const preview=await f.backup.previewRestore(result.point.id);await f.backup.restore(preview.token);
  assert.equal(f.store.workspace.getWork('one').name,'新标题');
});

test('完整恢复人物、冻结阶段、关联、章节和图片，旧增量分支保留',async t=>{
  const f=fixture(t),content=populate(f),original=dataRows(f);const initial=await baseline(f);
  f.store.deleteTag(content.tag.id,content.tag.version);f.store.archiveCharacter(content.other.id,content.other.version,true);changeWork(f,'新故事');
  const next=await f.backup.increment(),after=dataRows(f),preview=await f.backup.previewRestore(initial.point.id);
  assert.equal(preview.characters,2);assert.equal(preview.chapters,1);assert.equal(preview.images,1);assert.equal(preview.canProtectCurrent,true);
  unlinkSync(join(f.store.mediaDir,content.asset.fileName));await f.backup.restore(preview.token);
  assert.deepEqual(dataRows(f),original);assert.deepEqual(readFileSync(join(f.store.mediaDir,content.asset.fileName)),png);
  assert.deepEqual(f.store.getCharacter(content.c.id).stages[0],content.stage);
  await f.backup.restore((await f.backup.previewRestore(next.point.id)).token);assert.deepEqual(dataRows(f),after);
});

test('恢复后开启新增量分支，不制造全量，两个分支均能独立重放',async t=>{
  const f=fixture(t);const initial=await baseline(f);changeWork(f,'分支甲');const a=await f.backup.increment();
  await f.backup.restore((await f.backup.previewRestore(initial.point.id)).token);changeWork(f,'分支乙');const b=await f.backup.increment();
  assert.equal(b.point.parentId,initial.point.id);assert.equal(f.backup.status().points.filter(p=>p.kind==='baseline').length,1);
  await f.backup.restore((await f.backup.previewRestore(a.point.id)).token);assert.equal(f.store.workspace.getWork('one').name,'分支甲');
  await f.backup.restore((await f.backup.previewRestore(b.point.id)).token);assert.equal(f.store.workspace.getWork('one').name,'分支乙');
});

test('恢复前只补存未保存到备份的增量，且拒绝旧窗口和缺少代次的写入',async t=>{
  const f=fixture(t),generation=f.store.snapshot().generation,initial=await baseline(f);changeWork(f,'恢复前的文字');
  await f.backup.restore((await f.backup.previewRestore(initial.point.id)).token);
  assert.equal(f.backup.status().points.length,2);assert.equal(f.backup.status().points.filter(p=>p.kind==='baseline').length,1);
  const input={id:'one',name:'过期窗口',expectedVersion:0};
  assert.throws(()=>f.commands.invoke('saveWork',[input],generation),rejects('RESTORED'));assert.throws(()=>f.commands.invoke('saveWork',[input]),rejects('RESTORED'));
  assert.equal(f.commands.invoke('saveWork',[input],f.store.snapshot().generation).name,'过期窗口');
});

test('损坏的数据、缺图或断链阻止恢复且不改动当前资料',async t=>{
  const f=fixture(t),{asset}=populate(f),initial=await baseline(f);changeWork(f);const next=await f.backup.increment(),before=dataRows(f);
  const path=join(f.root,'points',next.point.id,'records.json'),data=readFileSync(path);writeFileSync(path,'[]');
  await assert.rejects(()=>f.backup.previewRestore(next.point.id),rejects('BACKUP_INVALID'));assert.deepEqual(dataRows(f),before);writeFileSync(path,data);
  const imagePath=join(f.root,'objects',asset.fileName);unlinkSync(imagePath);await assert.rejects(()=>f.backup.previewRestore(next.point.id),rejects('BACKUP_INVALID'));writeFileSync(imagePath,png);
  unlinkSync(join(f.root,'points',initial.point.id,'manifest.json'));await assert.rejects(()=>f.backup.previewRestore(next.point.id),rejects('BACKUP_INVALID'));assert.deepEqual(dataRows(f),before);
});

test('预览过期后禁止恢复；切换事务失败完整回滚，解除写入锁',async t=>{
  const f=fixture(t),initial=await baseline(f);let preview=await f.backup.previewRestore(initial.point.id);changeWork(f);
  await assert.rejects(()=>f.backup.restore(preview.token),rejects('CONFLICT'));
  preview=await f.backup.previewRestore(initial.point.id);const before=dataRows(f),generation=f.store.snapshot().generation;
  f.db.exec("CREATE TRIGGER reject_restore BEFORE DELETE ON worlds BEGIN SELECT RAISE(ABORT,'restore failure'); END");
  await assert.rejects(()=>f.backup.restore(preview.token));assert.deepEqual(dataRows(f),before);assert.equal(f.store.snapshot().generation,generation);assert.equal(f.store.writesPaused,false);assert.equal(f.store.journal.get('recording'),'1');
  f.db.exec('DROP TRIGGER reject_restore');changeWork(f,'失败后继续保存');
});

test('备份期间新保存留给下一次增量，恢复期间拒绝外部写入',async t=>{
  const f=fixture(t);await baseline(f);changeWork(f,'先保存');const running=f.backup.increment();changeWork(f,'备份中保存');await running;
  assert.ok(f.backup.status().pendingChanges>0);const last=await f.backup.increment();const preview=await f.backup.previewRestore(last.point.id),restoring=f.backup.restore(preview.token);
  assert.throws(()=>changeWork(f,'不应成功'),rejects('BUSY'));await restoring;assert.equal(f.store.workspace.getWork('one').name,'备份中保存');
});

test('依赖保护禁止删链中间节点，新基准下可按保留期清理旧分支',async t=>{
  const f=fixture(t),initial=await baseline(f);changeWork(f);const next=await f.backup.increment();
  await assert.rejects(()=>f.backup.deletePoint(initial.point.id),rejects('DEPENDENCY'));await assert.rejects(()=>f.backup.deletePoint(next.point.id),rejects('DEPENDENCY'));
  t.mock.timers.enable({apis:['Date'],now:Date.now()+40*86400000});const newer=await baseline(f);
  f.backup.saveSettings({...f.backup.status().settings,automatic:true,retentionDays:30});await f.backup.tick();
  assert.deepEqual(f.backup.status().points.map(p=>p.id),[newer.point.id]);await f.backup.previewRestore(newer.point.id);
});

test('旧结构与日志缺口阻止自动增量，不回退到全量',async t=>{
  const f=fixture(t);await baseline(f);const checkpoint=f.store.journal.get('checkpoint');
  f.store.journal.set('checkpoint',JSON.stringify({...JSON.parse(checkpoint),schema:'0'.repeat(64)}));f.backup.saveSettings({...f.backup.status().settings,automatic:true});await f.backup.tick();
  assert.equal(f.backup.status().points.length,1);assert.match(f.backup.status().lastError,/结构/);
  f.store.journal.set('checkpoint',checkpoint);changeWork(f);f.db.exec('DELETE FROM _backup_journal');await assert.rejects(()=>f.backup.increment(),rejects('JOURNAL_GAP'));
  assert.equal(f.backup.status().points.length,1);
});

test('可从已有备份恢复到新资料库，不覆盖另一库的备份或自动创建基准',async t=>{
  const original=fixture(t);populate(original);const initial=await baseline(original),expected=dataRows(original),target=fixture(t);
  target.backup.saveSettings({...target.backup.status().settings,directory:original.root,automatic:false});
  await assert.rejects(()=>baseline(target),rejects('VALIDATION'));const preview=await target.backup.previewRestore(initial.point.id);assert.equal(preview.canProtectCurrent,false);
  await target.backup.restore(preview.token);assert.deepEqual(dataRows(target),expected);assert.equal(target.backup.status().headId,initial.point.id);assert.equal(target.backup.status().points.length,1);
});

test('恶意表名、路径与伪造行拒绝读取或执行',async t=>{
  const f=fixture(t),initial=await baseline(f),before=dataRows(f);await assert.rejects(()=>f.backup.previewRestore('../library.sqlite'),rejects('VALIDATION'));
  const dir=join(f.root,'points',initial.point.id),value=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')),rows=records(f,initial.point.id);
  rows[0].table='worlds; DROP TABLE works';const bytes=JSON.stringify(rows);writeFileSync(join(dir,'records.json'),bytes);value.manifest.dataHash=digest(bytes);value.hash=digest(JSON.stringify(value.manifest));writeFileSync(join(dir,'manifest.json'),JSON.stringify(value));
  await assert.rejects(()=>f.backup.previewRestore(initial.point.id),rejects('BACKUP_INVALID'));assert.deepEqual(dataRows(f),before);
});

test('恢复前校验当前分支保护，已有增量损坏时不替换当前资料',async t=>{
  const f=fixture(t),initial=await baseline(f);changeWork(f,'重要的新修改');const next=await f.backup.increment(),before=dataRows(f);
  writeFileSync(join(f.root,'points',next.point.id,'records.json'),'[]');
  const preview=await f.backup.previewRestore(initial.point.id);await assert.rejects(()=>f.backup.restore(preview.token),rejects('BACKUP_INVALID'));
  assert.deepEqual(dataRows(f),before);assert.equal(f.store.writesPaused,false);
});

test('清理图片只删除没有任何恢复点引用的对象；依赖断裂时保留所有图片',async t=>{
  const f=fixture(t),first=await baseline(f),asset=f.store.importImage('a',png,'只在分支里的图.png'),branch=await f.backup.increment();
  await f.backup.restore((await f.backup.previewRestore(first.point.id)).token);changeWork(f,'无图片的新分支');await f.backup.increment();
  await f.backup.deletePoint(branch.point.id);assert.equal(existsSync(join(f.root,'objects',asset.fileName)),false);
  const a=f.store.importImage('a',png,'再次使用.png'),withImage=await f.backup.increment();changeWork(f,'依赖图片');const child=await f.backup.increment();
  unlinkSync(join(f.root,'points',withImage.point.id,'manifest.json'));
  t.mock.timers.enable({apis:['Date'],now:Date.now()+40*86400000});await baseline(f);f.backup.saveSettings({...f.backup.status().settings,automatic:true,retentionDays:30});await f.backup.tick();
  assert.equal(existsSync(join(f.root,'objects',a.fileName)),true);assert.equal(existsSync(join(f.root,'points',child.point.id,'manifest.json')),true);assert.match(f.backup.status().lastError,/不完整|校验/);
});
