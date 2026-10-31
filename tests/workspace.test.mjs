import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import Database from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {blankChapter} from '../src/shared/chapters.ts';
import {dashboardInput,overviewData} from '../src/shared/overview.ts';

const rejects=code=>e=>e.code===code;
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'oc-workspace-')),path=join(directory,'library.sqlite'),db=new Database(path),store=new LibraryStore(db,directory);
  db.exec("INSERT INTO worlds VALUES('a','原世界'),('b','另一世界'); INSERT INTO works VALUES('first','a','第一部'),('second','a','第二部'),('other','b','独立作品')");
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-workspace-'))throw Error('Unexpected cleanup target');rmSync(target,{recursive:true,force:true});});
  return {store,db,path,directory};
}
function content(store) {
  const p=store.saveCharacter({worldId:'a',expectedVersion:0,name:'旧世界人物',caption:'',status:'',quote:'',intro:'',body:'人物经历',pending:'',facts:[],tagIds:[],portraitId:null});
  store.saveCharacterStage({characterId:p.id,expectedVersion:p.version,name:'早期',period:'第一年',summary:'历史片段',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false});
  const character=store.getCharacter(p.id);
  const chapter=store.chapters.save({...blankChapter(store.chapters.getOutline('first')),name:'开篇',body:'完整正文\n第二段。',participants:[{characterId:p.id,stageId:character.stages[0].id}]});
  const dashboard=store.dashboard.save({...dashboardInput(store.dashboard.get('first')),description:'旧简介',tasks:[{id:'todo',title:'留着的计划',done:false}]});
  return {character,chapter,dashboard};
}

test('旧作品与世界读取默认信息，升级不改写旧行或补写虚构资料',t=>{
  const {store,db,path,directory}=fixture(t);content(store);
  const tableNames=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
  const rows=Object.fromEntries(tableNames.map(name=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
  assert.equal(store.workspace.getWork('first').version,0);assert.equal(store.workspace.getWorld('a').description,'');assert.equal(store.snapshot().activeWorkId,'first');
  store.close();const nextDb=new Database(path),next=new LibraryStore(nextDb,directory);
  try{next.snapshot();for(const name of tableNames)assert.deepEqual(nextDb.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all(),rows[name],name);}finally{next.close();}
});

test('新作品可共用世界或独立新建，人物共享而正文和计划保持独立',t=>{
  const {store}=fixture(t),old=content(store);
  const shared=store.workspace.createWork({name:'外传',world:{kind:'existing',id:'a'}});
  const separate=store.workspace.createWork({name:'新故事',world:{kind:'new',name:'新天地',description:'一个全新的世界。'}});
  assert.equal(shared.worldId,'a');assert.notEqual(separate.worldId,'a');assert.equal(store.workspace.getWorld(separate.worldId).description,'一个全新的世界。');
  const library=store.snapshot(),sharedData=overviewData(library,shared),separateData=overviewData(library,separate);
  assert.equal(sharedData.characters[0].id,old.character.id);assert.equal(sharedData.chapters.length,0);assert.equal(separateData.characters.length,0);assert.equal(separateData.media.length,0);
  assert.equal(store.dashboard.get(shared.id).description,'');assert.equal(store.chapters.getOutline(shared.id).chapterIds.length,0);assert.deepEqual(store.chapters.get(old.chapter.id),old.chapter);
});

test('世界改名同步所有作品且不改变章节、人物阶段或设定关联',t=>{
  const {store}=fixture(t),old=content(store),before=store.snapshot();
  const world=store.workspace.saveWorld({id:'a',name:'山海共域',description:'第一行\n第二行',expectedVersion:0});
  const work=store.workspace.saveWork({id:'first',name:'首卷',expectedVersion:0});
  assert.equal(world.version,1);assert.equal(work.name,'首卷');assert.equal(work.worldId,'a');assert.equal(store.workspace.getWork('second').worldName,'山海共域');assert.equal(store.workspace.getWork('other').worldName,'另一世界');
  assert.deepEqual(store.getCharacter(old.character.id),old.character);assert.deepEqual(store.chapters.get(old.chapter.id),old.chapter);assert.deepEqual(store.dashboard.get('first'),old.dashboard);
  const after=store.snapshot();for(const key of Object.keys(before).filter(k=>!['works','worlds'].includes(k)))assert.deepEqual(after[key],before[key],key);
});

test('归档和恢复作品保留全部正文与共用资料，并妥善切换当前作品',t=>{
  const {store,path,directory}=fixture(t),old=content(store);store.workspace.selectWork('first');
  const archived=store.workspace.archiveWork('first',0,true);assert.equal(archived.archived,true);assert.equal(store.workspace.activeWorkId(),'second');
  assert.throws(()=>store.workspace.selectWork('first'),rejects('VALIDATION'));assert.throws(()=>store.workspace.saveWork({id:'first',name:'不应写入',expectedVersion:archived.version}),rejects('VALIDATION'));
  assert.deepEqual(store.chapters.get(old.chapter.id),old.chapter);assert.deepEqual(store.getCharacter(old.character.id),old.character);assert.deepEqual(store.dashboard.get('first'),old.dashboard);
  const restored=store.workspace.archiveWork('first',archived.version,false);store.workspace.selectWork(restored.id);store.close();
  const reopened=new LibraryStore(new Database(path),directory);try{assert.equal(reopened.snapshot().activeWorkId,'first');assert.deepEqual(reopened.workspace.getWork('first'),restored);assert.deepEqual(reopened.getCharacter(old.character.id),old.character);assert.deepEqual(reopened.chapters.get(old.chapter.id),old.chapter);}finally{reopened.close();}
});

test('世界简介、作品名和上次打开的作品重启后保留',t=>{
  const {store,path,directory}=fixture(t);
  const world=store.workspace.saveWorld({name:'独立空白世界',description:'暂不创建作品\n先保存灵感',expectedVersion:0});
  const work=store.workspace.createWork({name:'第四部',world:{kind:'existing',id:world.id}});store.workspace.selectWork(work.id);store.close();
  const next=new LibraryStore(new Database(path),directory);try{assert.deepEqual(next.workspace.getWorld(world.id),world);assert.deepEqual(next.workspace.getWork(work.id),work);assert.equal(next.snapshot().activeWorkId,work.id);}finally{next.close();}
});

test('作品、世界拒绝过期修改、同范围重名和跨世界迁移',t=>{
  const {store}=fixture(t);
  const world=store.workspace.saveWorld({id:'a',name:'更新世界',description:'',expectedVersion:0});
  assert.throws(()=>store.workspace.saveWorld({id:'a',name:'旧写入',description:'',expectedVersion:0}),rejects('CONFLICT'));
  assert.throws(()=>store.workspace.saveWorld({name:'更新世界',description:'',expectedVersion:0}),rejects('VALIDATION'));
  const work=store.workspace.saveWork({id:'first',name:'更新作品',expectedVersion:0});
  assert.throws(()=>store.workspace.saveWork({id:'first',name:'旧写入',expectedVersion:0}),rejects('CONFLICT'));
  assert.throws(()=>store.workspace.archiveWork('first',0,true),rejects('CONFLICT'));
  assert.throws(()=>store.workspace.saveWork({id:'first',name:'越界',worldId:'b',expectedVersion:work.version}),rejects('VALIDATION'));
  assert.throws(()=>store.workspace.createWork({name:'第二部',world:{kind:'existing',id:'a'}}),rejects('VALIDATION'));
  assert.throws(()=>store.workspace.saveWork({id:'first',name:'第二部',expectedVersion:work.version}),rejects('VALIDATION'));
  assert.equal(store.workspace.createWork({name:'第二部',world:{kind:'existing',id:'b'}}).worldId,'b');
  assert.deepEqual(store.workspace.getWork('first'),work);assert.deepEqual(store.workspace.getWorld('a'),world);
});

test('历史写入失败时新建世界与作品整体回滚，改名和归档也不留半成品',t=>{
  const {store,db}=fixture(t);const before=store.snapshot();
  db.exec("CREATE TRIGGER fail_workspace BEFORE INSERT ON workspace_history WHEN NEW.kind='work' BEGIN SELECT RAISE(ABORT,'forced work history failure'); END");
  assert.throws(()=>store.workspace.createWork({name:'失败作品',world:{kind:'new',name:'失败世界',description:'不能残留'}}),/forced work history failure/);
  assert.throws(()=>store.workspace.saveWork({id:'first',name:'失败改名',expectedVersion:0}),/forced work history failure/);
  assert.throws(()=>store.workspace.archiveWork('first',0,true),/forced work history failure/);
  assert.deepEqual(store.snapshot(),before);assert.equal(db.prepare('SELECT count(*) n FROM workspace_history').get().n,0);
  db.exec("CREATE TRIGGER fail_world BEFORE INSERT ON workspace_history WHEN NEW.kind='world' BEGIN SELECT RAISE(ABORT,'forced world history failure'); END");
  assert.throws(()=>store.workspace.saveWorld({id:'a',name:'失败世界名',description:'',expectedVersion:0}),/forced world history failure/);assert.deepEqual(store.snapshot(),before);
});

test('输入边界与最后一部作品保护，失效的历史选择自动回到可用作品',t=>{
  const {store,db}=fixture(t);
  for(const raw of [null,{name:' ',world:{kind:'existing',id:'a'}},{name:'a'.repeat(201),world:{kind:'existing',id:'a'}},{name:'正常',world:{kind:'bad'}},{name:'正常',world:{kind:'existing',id:'missing'}},{name:'正常',world:{kind:'new',name:'',description:''}},{name:'正常',world:{kind:'new',name:'新世界',description:1}}])assert.throws(()=>store.workspace.createWork(raw));
  for(const patch of [{name:' '},{expectedVersion:-1},{expectedVersion:0.5},{description:'x'.repeat(10001)}])assert.throws(()=>store.workspace.saveWorld({id:'a',name:'世界',description:'',expectedVersion:0,...patch}),rejects('VALIDATION'));
  for(const args of [['first',-1,true],['first',0,1],['__proto__',0,true]])assert.throws(()=>store.workspace.archiveWork(...args),rejects('VALIDATION'));
  store.workspace.archiveWork('second',0,true);store.workspace.archiveWork('other',0,true);
  assert.throws(()=>store.workspace.archiveWork('first',0,true),rejects('VALIDATION'));assert.equal(store.workspace.getWork('first').archived,false);
  db.prepare("INSERT INTO meta(key,value) VALUES('active-work','other')").run();assert.equal(store.snapshot().activeWorkId,'first');
});
