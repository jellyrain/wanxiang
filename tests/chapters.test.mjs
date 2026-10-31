import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import Database from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {blankChapter,chapterInput,outlineInput,orderedChapters,moveChapter,textCount} from '../src/shared/chapters.ts';
import {mapInput} from '../src/shared/maps.ts';
import {timelineInput} from '../src/shared/timeline.ts';

function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'oc-chapters-')),path=join(directory,'library.sqlite'),db=new Database(path),store=new LibraryStore(db,directory);
  db.exec("INSERT INTO worlds VALUES('a','甲世界'),('b','乙世界'); INSERT INTO works VALUES('book-a','a','第一部'),('book-b','a','共享世界的第二部'),('book-c','b','独立作品')");
  t.after(()=>{if(db.open)store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-chapters-'))throw Error('Unexpected cleanup target');rmSync(target,{recursive:true,force:true});});
  return {store,db,path,directory};
}
const rejects=code=>e=>e.code===code;
function create(store,patch={}){return store.chapters.save({...blankChapter(store.chapters.getOutline(patch.workId??'book-a')),name:'第一章',body:'第一段：风起。\n\n第二段：灯火渐明。',...patch});}
function person(store,worldId='a'){return store.saveCharacter({worldId,expectedVersion:0,name:'人物',caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null});}
function stage(store,p,patch={}){return store.saveCharacterStage({characterId:p.id,expectedVersion:p.version,name:'早期',period:'故事开始',summary:'阶段说明',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false,...patch});}
function map(store,worldId='a'){return store.maps.save({worldId,expectedVersion:0,name:'地图',description:'',backgroundId:null,stages:[{id:'start',name:'起始'},{id:'later',name:'渡河之后'}],terrain:[],locations:[]});}
function entry(store,worldId='a'){const c=store.world.saveCategory({worldId,name:'类别',color:'#abcdef',description:'',active:true,expectedVersion:0});return store.world.saveEntry({worldId,categoryId:c.id,expectedCategoryVersion:c.version,expectedVersion:0,name:'设定',aliases:'',summary:'',body:'',pending:'',source:'',status:'draft',facts:[],imageId:null,links:[]});}
function timeline(store,worldId='a'){return store.timeline.save({worldId,name:'年表',description:'',expectedVersion:0,eras:[{id:'era',name:'当世',description:''}],events:[{id:'event',eraId:'era',name:'初见',period:'第一年',endPeriod:'',summary:'',body:'',status:'pending',participants:[],entryIds:[],places:[],mapProgress:[],archived:false}]});}

test('作品分卷、大纲、正文、全部关联与手动状态重启后保留',t=>{
  const {store,path,directory}=fixture(t),p=person(store),s=stage(store,p),m=map(store),e=entry(store),h=timeline(store);
  const o=store.chapters.saveOutline({...outlineInput(store.chapters.getOutline('book-a')),synopsis:'作品大纲\n第二行',volumes:[{id:'v',name:'第一卷',summary:'卷梗概'}]});
  const c=create(store,{volumeId:'v',summary:'本章梗概',notes:'待修订\n伏笔',status:'revising',participants:[{characterId:p.id,stageId:s.id}],events:[{timelineId:h.id,eventId:'event'}],entryIds:[e.id],mapProgress:[{mapId:m.id,stageId:'later'}]});
  const outline=store.chapters.getOutline('book-a');assert.equal(outline.version,o.version+1);assert.deepEqual(outline.chapterIds,[c.id]);store.close();
  const reopened=new LibraryStore(new Database(path),directory);try{assert.deepEqual(reopened.chapters.get(c.id),c);assert.deepEqual(reopened.chapters.getOutline('book-a'),outline);assert.deepEqual(reopened.snapshot().chapters,[c]);}finally{reopened.close();}
});

test('共用世界的作品仍有独立目录，跨作品转移与目录混用被拒绝',t=>{
  const {store}=fixture(t),a=create(store),b=create(store,{workId:'book-b'}),other=store.chapters.getOutline('book-b');
  assert.deepEqual(store.chapters.getOutline('book-a').chapterIds,[a.id]);assert.deepEqual(other.chapterIds,[b.id]);
  assert.throws(()=>store.chapters.save({...chapterInput(a,other),workId:'book-b'}),rejects('VALIDATION'));
  assert.throws(()=>store.chapters.saveOutline({...outlineInput(other),chapterIds:[a.id]}),rejects('VALIDATION'));
  assert.throws(()=>store.chapters.saveOutline({...outlineInput(other),chapterIds:[]}),rejects('VALIDATION'));
});

test('分卷顺序、章序及跨卷移动按作者安排，归档章不会丢失',t=>{
  const {store}=fixture(t);store.chapters.saveOutline({...outlineInput(store.chapters.getOutline('book-a')),volumes:[{id:'v1',name:'卷一',summary:''},{id:'v2',name:'卷二',summary:''}]});
  const a=create(store,{volumeId:'v1',name:'第十章'}),hidden=create(store,{volumeId:'v1',name:'隐藏章节'}),b=create(store,{volumeId:'v1',name:'第二章'}),c=create(store,{volumeId:'v2'});
  store.chapters.archive(hidden.id,hidden.version,true);let o=store.chapters.getOutline('book-a'),all=store.snapshot().chapters;
  const ids=moveChapter(o,all,b.id,-1);assert.deepEqual(ids,[b.id,hidden.id,a.id,c.id]);
  o=store.chapters.saveOutline({...outlineInput(o),chapterIds:ids,volumes:[o.volumes[1],o.volumes[0]]});assert.deepEqual(orderedChapters(o,all).map(c=>c.id),[c.id,b.id,hidden.id,a.id]);
  assert.throws(()=>store.chapters.saveOutline({...outlineInput(o),volumes:[o.volumes[0]]}),rejects('VALIDATION'));
  const moved=store.chapters.save({...chapterInput(a,o),volumeId:'v2'});assert.equal(moved.volumeId,'v2');assert.deepEqual(store.chapters.getOutline('book-a'),o);
});

test('正文独立保存，不重写其他章节与目录；过期写入保留原内容',t=>{
  const {store,db}=fixture(t),a=create(store),b=create(store,{name:'另一章'}),o=store.chapters.getOutline('book-a');
  const count=db.prepare('SELECT count(*) n FROM outline_history').get().n;
  const saved=store.chapters.save({...chapterInput(a,o),body:'新的正文',status:'finished'});assert.equal(saved.version,2);assert.deepEqual(store.chapters.get(b.id),b);assert.deepEqual(store.chapters.getOutline('book-a'),o);assert.equal(db.prepare('SELECT count(*) n FROM outline_history').get().n,count);
  assert.throws(()=>store.chapters.save({...chapterInput(a,o),body:'过期稿'}),rejects('CONFLICT'));assert.equal(store.chapters.get(a.id).body,'新的正文');
  assert.throws(()=>store.chapters.archive(a.id,1,true),rejects('CONFLICT'));
  const stale=blankChapter(o);create(store);assert.throws(()=>store.chapters.save({...stale,name:'过期目录的新章'}),rejects('CONFLICT'));
});

test('创建章节和加入目录为同一事务，历史写入失败全部回滚',t=>{
  const {store,db}=fixture(t);
  db.exec("CREATE TRIGGER fail_outline BEFORE INSERT ON outline_history BEGIN SELECT RAISE(ABORT,'forced history failure'); END");
  assert.throws(()=>create(store),/forced history failure/);assert.equal(store.snapshot().chapters.length,0);assert.equal(store.snapshot().outlines.length,0);assert.equal(db.prepare('SELECT count(*) n FROM chapter_history').get().n,0);
  db.exec('DROP TRIGGER fail_outline');const c=create(store),o=store.chapters.getOutline('book-a');
  db.exec("CREATE TRIGGER fail_chapter BEFORE INSERT ON chapter_history BEGIN SELECT RAISE(ABORT,'forced chapter failure'); END");
  assert.throws(()=>store.chapters.save({...chapterInput(c,o),body:'不得留下'}),/forced chapter failure/);assert.deepEqual(store.chapters.get(c.id),c);
});

test('引用人物阶段不改写阶段，错误人物、地图节点与年表事件被拒绝',t=>{
  const {store}=fixture(t),p=person(store),s=stage(store,p),q=person(store),m=map(store),h=timeline(store),before=store.getCharacter(p.id);
  create(store,{participants:[{characterId:p.id,stageId:s.id}]});assert.deepEqual(store.getCharacter(p.id),before);
  for(const patch of [{participants:[{characterId:q.id,stageId:s.id}]},{events:[{timelineId:h.id,eventId:'missing'}]},{mapProgress:[{mapId:m.id,stageId:'missing'}]},{volumeId:'missing'}])assert.throws(()=>create(store,patch),rejects('VALIDATION'));
});

test('拒绝跨世界关联，即使共用同名人物或节点也不能串联',t=>{
  const {store}=fixture(t),p=person(store,'b'),m=map(store,'b'),e=entry(store,'b'),h=timeline(store,'b');
  for(const patch of [{participants:[{characterId:p.id,stageId:null}]},{events:[{timelineId:h.id,eventId:'event'}]},{mapProgress:[{mapId:m.id,stageId:'start'}]},{entryIds:[e.id]}])assert.throws(()=>create(store,patch),rejects('VALIDATION'));
});

test('归档关联可继续保留，但不可添加到新章；归档章节可恢复',t=>{
  const {store}=fixture(t);let p=person(store),s=stage(store,p),m=map(store),e=entry(store),h=timeline(store);
  const refs={participants:[{characterId:p.id,stageId:s.id}],events:[{timelineId:h.id,eventId:'event'}],mapProgress:[{mapId:m.id,stageId:'later'}],entryIds:[e.id]};let c=create(store,refs),o=store.chapters.getOutline('book-a');
  p=store.getCharacter(p.id);stage(store,p,{id:s.id,archived:true});p=store.getCharacter(p.id);store.archiveCharacter(p.id,p.version,true);store.maps.archive(m.id,m.version,true);store.world.archiveEntry(e.id,e.version,true);h=store.timeline.save({...timelineInput(h),events:h.events.map(e=>({...e,archived:true}))});store.timeline.archive(h.id,h.version,true);
  c=store.chapters.save({...chapterInput(c,o),body:'保留所有关联'});assert.deepEqual(c.participants,refs.participants);
  for(const [key,value] of Object.entries(refs))assert.throws(()=>create(store,{[key]:value}),rejects('VALIDATION'));
  c=store.chapters.archive(c.id,c.version,true);assert.throws(()=>store.chapters.save(chapterInput(c,o)),rejects('VALIDATION'));c=store.chapters.archive(c.id,c.version,false);assert.equal(c.body,'保留所有关联');assert.equal(c.events[0].eventId,'event');
});

test('章节引用的地图节点禁止删除，包括已归档章；解除关联后可删',t=>{
  const {store}=fixture(t);let m=map(store),c=create(store,{mapProgress:[{mapId:m.id,stageId:'later'}]});const o=store.chapters.getOutline('book-a');
  m=store.maps.save({...mapInput(m),stages:[m.stages[0],{id:'later',name:'修改名称'}]});assert.equal(store.chapters.get(c.id).mapProgress[0].stageId,'later');
  assert.throws(()=>store.maps.save({...mapInput(m),stages:[m.stages[0]]}),rejects('VALIDATION'));c=store.chapters.archive(c.id,c.version,true);assert.throws(()=>store.maps.save({...mapInput(m),stages:[m.stages[0]]}),rejects('VALIDATION'));
  c=store.chapters.archive(c.id,c.version,false);store.chapters.save({...chapterInput(c,o),mapProgress:[]});assert.equal(store.maps.save({...mapInput(m),stages:[m.stages[0]]}).stages.length,1);
});

test('空标题、超长正文、非法状态、重复关联与重复目录被拒绝',t=>{
  const {store}=fixture(t),p=person(store),o=store.chapters.getOutline('book-a');
  for(const patch of [{name:'  '},{body:'a'.repeat(300001)},{status:'unknown'},{participants:[{characterId:p.id,stageId:null},{characterId:p.id,stageId:null}]},{events:null},{expectedVersion:-1},{expectedOutlineVersion:NaN}])assert.throws(()=>create(store,patch),rejects('VALIDATION'));
  assert.throws(()=>store.chapters.saveOutline({...outlineInput(o),volumes:[{id:'v',name:'一',summary:''},{id:'v',name:'二',summary:''}]}),rejects('VALIDATION'));
  const c=create(store);assert.throws(()=>store.chapters.saveOutline({...outlineInput(store.chapters.getOutline('book-a')),chapterIds:[c.id,c.id]}),rejects('VALIDATION'));
  assert.equal(textCount('中文，\n abc 😀\t'),'中文，abc😀'.length-1);
});
