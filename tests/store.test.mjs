import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { LibraryStore } from '../src/core/store.ts';
import { profileOf, resolveForms, characterSearchText } from '../src/shared/journey.ts';

const seed = fileURLToPath(new URL('../resources/seed/',import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(),'wanxiang-test-'));
  const path = join(directory,'library.sqlite');
  const db = new BetterSqlite3(path);
  const store = new LibraryStore(db,directory);
  db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('test-world','测试世界');
  t.after(() => {
    if (db.open) store.close();
    const target=resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('wanxiang-test-')) throw new Error('Unexpected cleanup directory');
    rmSync(target,{ recursive:true,force:true });
  });
  return { store,db,path,directory };
}
function input(extra={}) { return { worldId:'test-world',expectedVersion:0,name:'测试人物',caption:'',status:'草稿',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null,...extra }; }
function edit(c,extra={}) { return input({ id:c.id,worldId:c.worldId,expectedVersion:c.version,name:c.name,caption:c.caption,status:c.status,quote:c.quote,intro:c.intro,body:c.body,pending:c.pending,facts:c.facts,tagIds:c.tags.map(t=>t.id),portraitId:c.portraitId,portraitWidth:c.portraitWidth,attributes:c.attributes,...extra }); }
function tag(store,name,worldId='test-world') {return store.saveTag({worldId,name,color:'#bda374',expectedVersion:0});}
function dimension(id,extra={}) {return {id,name:id,min:0,max:100,unit:'',enabled:true,...extra};}
function template(store,extra={}) {return store.saveAttributeTemplate({worldId:'test-world',name:'测试属性',expectedVersion:0,dimensions:[dimension('power'),dimension('speed'),dimension('will')],makeDefault:false,expectedDefaultVersion:store.snapshot().attributeDefaults.find(s=>s.worldId==='test-world')?.version ?? 0,...extra});}
function attributes(t,values={}) {return {templateId:t.id,values:{[t.id]:values},versions:{[t.id]:t.version}};}
function identity(id,extra={}) {return {id,name:id,alias:'',title:'',organization:'',visibility:'public',description:'',active:true,...extra};}
function form(id,extra={}) {return {id,name:id,appearance:'',condition:'',cost:'',abilities:null,portraitMode:'inherit',portraitId:null,portraitWidth:100,attributeMode:'inherit',attributes:{templateId:null,values:{},versions:{}},active:true,...extra};}
function variants(store,c,extra={}) {return store.saveCharacterVariants({characterId:c.id,expectedVersion:c.version,...extra});}
function stageInput(c,extra={}) {return {characterId:c.id,expectedVersion:c.version,name:'第一阶段',period:'第一卷',summary:'',identityIds:c.identities.filter(i=>i.active).map(i=>i.id),formIds:['base',...c.forms.filter(f=>f.active).map(f=>f.id)],defaultFormId:c.defaultFormId,attributeValues:{},archived:false,...extra};}
function stageEdit(c,s,extra={}) {return stageInput(c,{id:s.id,name:s.name,period:s.period,summary:s.summary,identityIds:s.snapshot.identities.map(i=>i.id),formIds:s.snapshot.forms.map(f=>f.id),defaultFormId:s.snapshot.defaultFormId,archived:s.archived,...extra});}

test('人物、自定义字段、标签和正文保存后重新打开数据库仍完整',t => {
  const { store,path,directory }=fixture(t);
  const lead=tag(store,'主角'),traveler=tag(store,'旅人');
  const original=store.saveCharacter(input({ name:'林间客',body:'第一段。\n\n第二段。',facts:[{ id:'birth',label:'出身',value:'' },{ id:'age',label:'年龄',value:'0' }],tagIds:[lead.id,traveler.id,lead.id] }));
  const edited=store.saveCharacter(edit(original,{ caption:'听雨的人' }));
  assert.equal(edited.version,2); assert.equal(edited.tags.length,2);
  assert.equal(edited.tags[0].id,original.tags[0].id);
  store.close(); const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try { assert.deepEqual(reopened.getCharacter(edited.id),edited); assert.equal(edited.facts[0].value,''); assert.equal(edited.facts[1].value,'0'); }
  finally { reopened.close(); }
});

test('过期版本被拒绝，并保留最新内容和原有历史',t => {
  const { store,db }=fixture(t);
  const first=store.saveCharacter(input());
  const latest=store.saveCharacter(edit(first,{ name:'已确认的名字' }));
  assert.throws(() => store.saveCharacter(edit(first,{ name:'旧草稿',tagIds:['missing'] })),{ code:'CONFLICT' });
  assert.deepEqual(store.getCharacter(first.id),latest);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tags').get().n,0);
});

test('关联写入失败时，人物内容、标签与历史一并回滚',t => {
  const { store,db }=fixture(t);
  const oldTag=tag(store,'原标签'),newTag=tag(store,'新标签');
  const original=store.saveCharacter(input({ tagIds:[oldTag.id] }));
  db.exec("CREATE TRIGGER reject_tag BEFORE INSERT ON character_tags BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(() => store.saveCharacter(edit(original,{ name:'不应保存',tagIds:[newTag.id] })));
  assert.deepEqual(store.getCharacter(original.id),original);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tags').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,1);
});

test('归档与恢复保留人物内容，归档中不能直接修改',t => {
  const { store }=fixture(t);
  const original=store.saveCharacter(input({ body:'不能丢失的经历' }));
  const archived=store.archiveCharacter(original.id,1,true);
  assert.equal(archived.archived,true); assert.equal(archived.body,original.body);
  assert.throws(() => store.saveCharacter(edit(archived,{ body:'不应保存' })),{ code:'VALIDATION' });
  const restored=store.archiveCharacter(original.id,2,false);
  assert.equal(restored.archived,false); assert.equal(restored.version,3); assert.equal(restored.body,original.body);
});

test('图片存入资料库，相同世界内去重，禁止跨世界关联',t => {
  const { store,db }=fixture(t);
  const bytes=readFileSync(join(seed,'gu.png'));
  const image=store.importImage('test-world',bytes,'参考.png');
  assert.ok(existsSync(join(store.mediaDir,image.fileName)));
  assert.deepEqual(readFileSync(join(store.mediaDir,image.fileName)),bytes);
  assert.equal(store.importImage('test-world',bytes,'另一名字.png').id,image.id);
  db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('other-world','另一个世界');
  assert.throws(() => store.saveCharacter(input({ worldId:'other-world',portraitId:image.id })),{ code:'VALIDATION' });
  assert.throws(() => store.saveCharacter(input({ name:'   ' })),{ code:'VALIDATION' });
});

test('初始导入保留两个人物，重复启动不覆盖用户修改',t => {
  const { store,db }=fixture(t);
  store.seed(seed);
  const initial=store.snapshot(); assert.equal(initial.characters.length,2);
  assert.ok(initial.characters.every(c => c.tags.some(tag => tag.name==='主角')));
  const first=initial.characters[0]; store.saveCharacter(edit(first,{ intro:'用户后来填写的简介' }));
  store.seed(seed);
  assert.equal(store.snapshot().characters.length,2);
  assert.equal(store.getCharacter(first.id).intro,'用户后来填写的简介');
  assert.ok(JSON.parse(db.prepare('SELECT source_json FROM characters WHERE id=?').get(first.id).source_json).links.length>0);
});

test('初始导入中断时整体回滚，再次启动不产生重复人物',t => {
  const { store,db }=fixture(t);
  db.exec("CREATE TRIGGER reject_seed BEFORE INSERT ON characters WHEN NEW.name='墨月澜' BEGIN SELECT RAISE(ABORT,'test seed failure'); END;");
  assert.throws(() => store.seed(seed));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM characters').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n,0);
  db.exec('DROP TRIGGER reject_seed');
  store.seed(seed);
  assert.equal(store.snapshot().characters.length,2);
});

test('预配置的空标签、主题与特写范围在重启后保留，修改主题不改变人物',t => {
  const {store,path,directory}=fixture(t);
  const empty=tag(store,'尚未使用');
  const c=store.saveCharacter(input({portraitWidth:29.5}));
  store.setTheme('paper');
  assert.throws(()=>store.setTheme('unknown'),{code:'VALIDATION'});
  assert.deepEqual(store.getCharacter(c.id),c);
  store.close();
  const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {
    assert.equal(reopened.snapshot().theme,'paper');
    assert.deepEqual(reopened.snapshot().tags,[empty]);
    assert.equal(reopened.getCharacter(c.id).portraitWidth,29.5);
  } finally {reopened.close();}
});

test('标签重命名及删除同步普通与归档人物，历史保留旧名，拒绝过期草稿',t => {
  const {store,db}=fixture(t);
  const lead=tag(store,'主角');
  const first=store.saveCharacter(input({tagIds:[lead.id],body:'正文保留'}));
  const second=store.saveCharacter(input({tagIds:[lead.id],name:'另一人'}));
  store.archiveCharacter(second.id,second.version,true);
  const renamed=store.saveTag({...lead,expectedVersion:lead.version,name:'主人公',color:'#77a993'});
  assert.equal(renamed.id,lead.id);
  for(const id of [first.id,second.id]) assert.equal(store.getCharacter(id).tags[0].name,'主人公');
  assert.equal(store.getCharacter(second.id).archived,true);
  const before=JSON.parse(db.prepare('SELECT snapshot_json FROM revisions WHERE character_id=? AND version=1').get(first.id).snapshot_json);
  assert.equal(before.tags[0].name,'主角');
  assert.throws(()=>store.saveCharacter(edit(first)),{code:'CONFLICT'});
  assert.throws(()=>store.deleteTag(lead.id,lead.version),{code:'CONFLICT'});
  store.deleteTag(renamed.id,renamed.version);
  assert.equal(store.getCharacter(first.id).tags.length,0);
  assert.equal(store.getCharacter(second.id).tags.length,0);
  assert.equal(store.getCharacter(first.id).body,'正文保留');
  assert.equal(store.snapshot().tags.length,0);
});

test('拒绝未配置、跨世界、重复名称标签，以及无效特写范围',t => {
  const {store,db}=fixture(t);
  db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('other-world','另一个世界');
  const foreign=tag(store,'主角','other-world');
  tag(store,'主角');
  assert.throws(()=>tag(store,' 主角 '),{code:'VALIDATION'});
  assert.throws(()=>store.saveCharacter(input({tagIds:[foreign.id]})),{code:'VALIDATION'});
  assert.throws(()=>store.saveCharacter(input({tagIds:['unknown']})),{code:'NOT_FOUND'});
  assert.throws(()=>store.saveCharacter(input({portraitWidth:0})),{code:'VALIDATION'});
  assert.equal(store.snapshot().characters.length,0);
});

test('标签批量同步失败时回滚名称、人物版本与历史',t => {
  const {store,db}=fixture(t);
  const lead=tag(store,'主角');
  const c=store.saveCharacter(input({tagIds:[lead.id]}));
  const before=store.snapshot();
  db.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>store.saveTag({...lead,expectedVersion:lead.version,name:'不应保存'}));
  assert.throws(()=>store.deleteTag(lead.id,lead.version));
  assert.deepEqual(store.snapshot(),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(c.id).n,1);
});

test('旧库升级保留标签编号与用户内容，仅给原有设定拼图选择特写取景',t => {
  const {store,db,path,directory}=fixture(t);
  store.seed(seed);
  const before=store.snapshot();
  const changed=before.characters[1];
  // An already replaced image must not be treated as a seed sheet during migration.
  db.prepare('UPDATE characters SET portrait_id=NULL,intro=? WHERE id=?').run('保留用户修改',changed.id);
  // Simulate an older schema which predates the backup triggers.
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB '_backup_*'").all())db.exec('DROP TRIGGER \"'+name+'\"');
  db.exec('ALTER TABLE characters DROP COLUMN portrait_width; ALTER TABLE tags DROP COLUMN color; ALTER TABLE tags DROP COLUMN version;');
  store.close();
  const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {
    reopened.seed(seed);
    const after=reopened.snapshot();
    assert.deepEqual(after.tags.map(t=>t.id),before.tags.map(t=>t.id));
    assert.equal(after.characters.length,2);
    assert.equal(after.characters[0].portraitWidth,32.5);
    assert.equal(reopened.getCharacter(changed.id).portraitWidth,100);
    assert.equal(reopened.getCharacter(changed.id).intro,'保留用户修改');
  } finally {reopened.close();}
});

test('属性零值、未定值、负数小数和单位持久化，默认模板仅作用于新人物',t=>{
  const {store,path,directory}=fixture(t);
  const existing=store.saveCharacter(input({name:'已有角色'}));
  const tp=template(store,{makeDefault:true,dimensions:[dimension('temperature',{name:'体温',min:-50,max:50,unit:'℃'}),dimension('zero'),dimension('unknown')]});
  assert.equal(store.getCharacter(existing.id).attributes.templateId,null);
  const c=store.saveCharacter(input({attributes:attributes(tp,{temperature:-2.5,zero:0,unknown:null})}));
  assert.equal(store.saveCharacter(input()).attributes.templateId,tp.id);
  assert.equal(store.saveCharacter(input({attributes:{templateId:null,values:{},versions:{}}})).attributes.templateId,null);
  const before=store.snapshot();store.close();
  const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {
    assert.deepEqual(reopened.snapshot(),before);
    assert.deepEqual(reopened.getCharacter(c.id).attributes.values[tp.id],{temperature:-2.5,zero:0,unknown:null});
  } finally {reopened.close();}
});

test('切换或暂不使用模板保留各自数值，明确清空一个值不影响其他模板',t=>{
  const {store}=fixture(t);
  const a=template(store),b=template(store,{name:'另一个模板'});
  let c=store.saveCharacter(input({attributes:attributes(a,{power:23,speed:0})}));
  c=store.saveCharacter(edit(c,{attributes:attributes(b,{power:81})}));
  assert.equal(c.attributes.values[a.id].power,23);
  c=store.saveCharacter(edit(c,{attributes:{templateId:null,values:{},versions:{}}}));
  assert.equal(c.attributes.values[b.id].power,81);
  c=store.saveCharacter(edit(c,{attributes:attributes(a,{power:null})}));
  assert.equal(c.attributes.values[a.id].power,null);
  assert.equal(c.attributes.values[a.id].speed,0);
  assert.equal(c.attributes.values[b.id].power,81);
  c=store.saveCharacter(edit(c,{attributes:undefined,body:'只修改正文'}));
  assert.equal(c.attributes.values[b.id].power,81);
});

test('模板改名重排、停用恢复和缩小范围不改写原值，并保存当时的属性定义',t=>{
  const {store,db}=fixture(t);
  const a=template(store);
  const c=store.saveCharacter(input({attributes:attributes(a,{power:90,speed:0,will:null})}));
  const archived=store.archiveCharacter(c.id,c.version,true);
  const changed=template(store,{...a,expectedVersion:a.version,name:'已更新模板',dimensions:[dimension('speed',{name:'身法',enabled:false}),dimension('will'),dimension('power',{max:50})]});
  const after=store.getCharacter(c.id);
  assert.equal(after.version,archived.version+1);assert.equal(after.archived,true);
  assert.deepEqual(after.attributes.values[a.id],c.attributes.values[a.id]);
  const oldRevision=JSON.parse(db.prepare('SELECT snapshot_json FROM revisions WHERE character_id=? AND version=1').get(c.id).snapshot_json);
  assert.equal(oldRevision.attributeSchemas[0].dimensions[1].name,'speed');
  assert.equal(oldRevision.attributeSchemas[0].dimensions[0].max,100);
  const restoredTemplate=template(store,{...changed,expectedVersion:changed.version,dimensions:changed.dimensions.map(d=>({...d,enabled:true}))});
  let current=store.getCharacter(c.id);current=store.archiveCharacter(current.id,current.version,false);
  current=store.saveCharacter(edit(current,{body:'范围变更后仍可编辑正文'}));
  assert.equal(current.attributes.values[a.id].power,90);
  assert.equal(current.attributes.values[a.id].speed,0);
  assert.throws(()=>store.saveCharacter(edit(current,{attributes:attributes(restoredTemplate,{power:91})})),{code:'VALIDATION'});
  assert.equal(store.getCharacter(c.id).attributes.values[a.id].power,90);
});

test('过期人物、模板与默认设置不会覆盖新修改，新人物也校验模板版本',t=>{
  const {store}=fixture(t);
  const a=template(store),b=template(store,{name:'第二模板'});
  const c=store.saveCharacter(input({attributes:attributes(a,{power:10})}));
  const updated=template(store,{...a,expectedVersion:a.version,name:'新名称',makeDefault:true});
  assert.throws(()=>store.saveCharacter(edit(c)),{code:'CONFLICT'});
  assert.throws(()=>template(store,{...a,expectedVersion:a.version}),{code:'CONFLICT'});
  assert.throws(()=>store.saveCharacter(input({attributes:attributes(a)})),{code:'VALIDATION'});
  assert.throws(()=>template(store,{...b,expectedVersion:b.version,makeDefault:true,expectedDefaultVersion:0}),{code:'CONFLICT'});
  const fresh=store.getCharacter(c.id);assert.equal(fresh.attributes.versions[a.id],updated.version);
  assert.equal(store.snapshot().attributeDefaults[0].templateId,a.id);
});

test('属性模板与值隔离所属世界，拒绝无效维度、范围、非数值及直接删除已有维度',t=>{
  const {store,db}=fixture(t);
  const a=template(store);
  db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('other-world','另一个世界');
  assert.throws(()=>store.saveCharacter(input({worldId:'other-world',attributes:attributes(a)})),{code:'VALIDATION'});
  assert.throws(()=>template(store,{name:'异常',dimensions:[dimension('a',{min:100,max:0})]}),{code:'VALIDATION'});
  assert.throws(()=>template(store,{name:'异常',dimensions:[dimension('a'),dimension('a')]}),{code:'VALIDATION'});
  assert.throws(()=>template(store,{name:'异常',dimensions:[dimension('a',{enabled:false})]}),{code:'VALIDATION'});
  assert.throws(()=>template(store,{...a,expectedVersion:a.version,dimensions:a.dimensions.slice(1)}),{code:'VALIDATION'});
  for(const value of [NaN,Infinity,'7',false,101]) assert.throws(()=>store.saveCharacter(input({attributes:attributes(a,{power:value})})),{code:'VALIDATION'});
  assert.throws(()=>store.saveCharacter(input({attributes:attributes(a,{unknown:10})})),{code:'VALIDATION'});
  assert.equal(store.snapshot().characters.length,0);
  assert.equal(template(store,{name:'一维',dimensions:[dimension('one')]}).dimensions.length,1);
  assert.equal(template(store,{name:'多维',dimensions:Array.from({length:12},(_,i)=>dimension('dim-'+i))}).dimensions.length,12);
});

test('属性模板同步发生失败时，模板、默认设置、人物与历史全部回滚',t=>{
  const {store,db}=fixture(t);
  const a=template(store);
  const c=store.saveCharacter(input({attributes:attributes(a,{power:20})}));
  const before=store.snapshot();
  db.exec("CREATE TRIGGER reject_attribute_history BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'test attribute failure'); END;");
  assert.throws(()=>template(store,{...a,name:'不应保存',expectedVersion:a.version,makeDefault:true}));
  assert.deepEqual(store.snapshot(),before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE character_id=?').get(c.id).n,1);
});

test('不含属性功能的旧资料库升级后保持内容，人物属性留空且无虚构数值',t=>{
  const {store,db,path,directory}=fixture(t);store.seed(seed);
  const before=store.snapshot();
  // Simulate an older schema which predates the backup triggers.
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB '_backup_*'").all())db.exec('DROP TRIGGER \"'+name+'\"');
  db.exec('DROP TABLE attribute_defaults; DROP TABLE attribute_templates; ALTER TABLE characters DROP COLUMN attributes_json;');
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try{
    reopened.seed(seed);assert.deepEqual(reopened.snapshot(),before);
    assert.equal(reopened.snapshot().attributeTemplates.length,0);
    assert.ok(reopened.snapshot().characters.every(c=>c.attributes.templateId===null && Object.keys(c.attributes.values).length===0));
  }finally{reopened.close();}
});

test('身份共存、化名检索与形态独立资料持久化，共用资料随基础档案更新',t=>{
  const {store,path,directory}=fixture(t), tp=template(store);
  const image=store.importImage('test-world',readFileSync(join(seed,'gu.png')),'原始图.png');
  let c=store.saveCharacter(input({abilities:'基础能力一',portraitId:image.id,portraitWidth:32.5,attributes:attributes(tp,{power:10})}));
  c=variants(store,c,{identities:[identity('public',{name:'旅人',alias:'听风'}),identity('secret',{name:'守夜者',alias:'无名',visibility:'secret',organization:'北城'})],forms:[form('inherit'),form('custom',{abilities:'独立能力',portraitMode:'custom',portraitId:image.id,portraitWidth:40,attributeMode:'custom',attributes:attributes(tp,{power:80})}),form('none',{portraitMode:'none'})],defaultFormId:'custom'});
  assert.ok(characterSearchText(c).includes('无名'));assert.equal(c.identities.length,2);
  c=store.saveCharacter(edit(c,{abilities:'基础能力二',attributes:attributes(tp,{power:20}),portraitWidth:29.5}));
  const resolved=resolveForms(profileOf(c),c.forms,[tp]);
  assert.equal(resolved[1].abilities,'基础能力二');assert.equal(resolved[1].attributes.values[tp.id].power,20);assert.equal(resolved[1].portraitWidth,29.5);
  assert.equal(resolved[2].abilities,'独立能力');assert.equal(resolved[2].attributes.values[tp.id].power,80);assert.equal(resolved[2].portraitWidth,40);assert.equal(resolved[3].portraitId,null);
  c=variants(store,c,{identities:c.identities.map(i=>({...i,active:false}))});
  assert.ok(characterSearchText(c).includes('听风'));
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try{assert.deepEqual(reopened.getCharacter(c.id),c);}finally{reopened.close();}
});

test('阶段保留当时的图片、能力、身份、标签、数值和模板，不随当前资料变化',t=>{
  const {store}=fixture(t),tp=template(store),lead=tag(store,'旧标签');
  const image=store.importImage('test-world',readFileSync(join(seed,'gu.png')),'原图.png');
  let c=store.saveCharacter(input({tagIds:[lead.id],body:'早期经历',abilities:'旧能力',portraitId:image.id,portraitWidth:32.5,attributes:attributes(tp,{power:10,speed:0,will:null})}));
  c=variants(store,c,{identities:[identity('one',{alias:'早期化名'})],forms:[form('ink',{abilities:'早期独立能力',attributeMode:'custom',attributes:attributes(tp,{power:50})})]});
  const stage=store.saveCharacterStage(stageInput(c)), frozen=structuredClone(stage);
  c=store.getCharacter(c.id);c=store.saveCharacter(edit(c,{name:'后期名字',body:'后期经历',abilities:'新能力',portraitId:null,attributes:attributes(tp,{power:90})}));
  c=variants(store,c,{identities:[identity('one',{alias:'后期化名',active:false})],forms:[{...c.forms[0],abilities:'后期独立能力',active:false}]});
  store.deleteTag(lead.id,lead.version);
  const changed=template(store,{...tp,expectedVersion:tp.version,name:'新版模板',dimensions:tp.dimensions.map(d=>({...d,max:200,name:d.name+'新'}))});
  c=store.getCharacter(c.id);assert.deepEqual(c.stages[0],frozen);assert.ok(characterSearchText(c).includes('早期化名'));
  assert.equal(c.stages[0].snapshot.forms[0].attributeSchemas[0].version,1);assert.equal(c.attributes.versions[tp.id],changed.version);
  const updated=store.saveCharacterStage(stageEdit(c,stage,{summary:'修订阶段说明',attributeValues:{base:attributes(tp,{power:0,will:null}),ink:attributes(tp,{power:75})}}));
  assert.equal(updated.snapshot.forms[0].attributes.values[tp.id].power,0);assert.equal(updated.snapshot.forms[0].attributes.values[tp.id].speed,0);assert.equal(updated.snapshot.forms[1].attributes.values[tp.id].power,75);
  assert.deepEqual(updated.snapshot.profile,frozen.snapshot.profile);assert.equal(updated.capturedAt,stage.capturedAt);assert.equal(updated.sourceVersion,stage.sourceVersion);
  assert.equal(store.getCharacter(c.id).attributes.values[tp.id].power,90);
});

test('显式重新取资料才更新阶段，历史保存重建前的副本，阶段可以新增关联',t=>{
  const {store,db}=fixture(t);let c=store.saveCharacter(input({abilities:'最初能力'}));
  c=variants(store,c,{identities:[identity('one')],forms:[form('one',{abilities:'旧形态'})]});
  const original=store.saveCharacterStage(stageInput(c));c=store.getCharacter(c.id);
  c=store.saveCharacter(edit(c,{abilities:'后来能力'}));
  c=variants(store,c,{identities:[...c.identities,identity('two')],forms:[{...c.forms[0],abilities:'新形态'},form('two')]});
  const added=store.saveCharacterStage(stageEdit(c,original,{formIds:['base','one','two'],identityIds:['one','two']}));
  assert.equal(added.snapshot.forms[1].abilities,'旧形态');assert.equal(added.snapshot.forms[2].abilities,'后来能力');assert.equal(added.snapshot.profile.abilities,'最初能力');
  c=store.getCharacter(c.id);
  const recaptured=store.saveCharacterStage(stageEdit(c,added,{recapture:true}));
  assert.equal(recaptured.sourceVersion,c.version);assert.equal(recaptured.snapshot.profile.abilities,'后来能力');assert.equal(recaptured.snapshot.forms[1].abilities,'新形态');
  const revision=JSON.parse(db.prepare('SELECT snapshot_json FROM revisions WHERE character_id=? AND version=?').get(c.id,c.version).snapshot_json);
  assert.deepEqual(revision.stages[0],added);assert.equal(revision.stages[0].snapshot.forms[1].abilities,'旧形态');
  assert.ok(!Object.hasOwn(recaptured.snapshot.profile,'stages'));
});

test('身份形态拒绝重复、移除、无效默认形态、跨世界图片与模板',t=>{
  const {store,db}=fixture(t);db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('foreign','外部世界');
  const tp=template(store,{worldId:'foreign'}),img=store.importImage('foreign',readFileSync(join(seed,'gu.png')),'外图.png');
  let c=store.saveCharacter(input());c=variants(store,c,{identities:[identity('one')],forms:[form('one')]});
  const bad=[{identities:[]},{forms:[]},{identities:[identity('one'),identity('one')]},{identities:[identity('one'),identity('two',{name:'one'})]},{forms:[form('base')]},{forms:[form('one',{name:'基础形态'})]},{forms:[form('one'),form('two',{name:'one'})]},{forms:[form('one',{portraitMode:'custom',portraitId:img.id})]},{forms:[form('one',{portraitMode:'custom'})]},{forms:[form('one',{attributeMode:'custom',attributes:attributes(tp)})]},{forms:[form('one',{active:false})],defaultFormId:'one'},{defaultFormId:'missing'}];
  for(const change of bad)assert.throws(()=>variants(store,c,change),{code:'VALIDATION'});
  assert.deepEqual(store.getCharacter(c.id),c);
});

test('阶段关联必须属于当前人物，拒绝旧版本、未知属性与无效默认形态',t=>{
  const {store}=fixture(t),tp=template(store);
  let c=store.saveCharacter(input({attributes:attributes(tp,{power:20})}));
  c=variants(store,c,{identities:[identity('one')],forms:[form('one'),form('off',{active:false})]});
  for(const change of [{identityIds:['foreign']},{formIds:['base','missing']},{formIds:['off']},{defaultFormId:'missing'},{identityIds:['one','one']},{attributeValues:{foreign:attributes(tp)}},{attributeValues:{base:attributes(tp,{unknown:20})}}])assert.throws(()=>store.saveCharacterStage(stageInput(c,change)),{code:'VALIDATION'});
  const stage=store.saveCharacterStage(stageInput(c));
  assert.throws(()=>store.saveCharacterStage(stageInput(c,{name:'过期'})),{code:'CONFLICT'});
  const other=store.saveCharacter(input({name:'另一人'}));
  assert.throws(()=>store.saveCharacterStage(stageInput(other,{id:stage.id})),{code:'NOT_FOUND'});
  c=store.getCharacter(c.id);assert.throws(()=>store.saveCharacterStage(stageInput(c)),{code:'VALIDATION'});
  assert.equal(store.getCharacter(c.id).stages.length,1);
});

test('阶段排序、归档与恢复持久化，并拒绝不完整顺序',t=>{
  const {store,path,directory}=fixture(t);let c=store.saveCharacter(input());
  const first=store.saveCharacterStage(stageInput(c));c=store.getCharacter(c.id);
  const second=store.saveCharacterStage(stageInput(c,{name:'第二阶段'}));c=store.getCharacter(c.id);
  assert.throws(()=>store.reorderCharacterStages(c.id,c.version,[first.id]),{code:'VALIDATION'});
  assert.throws(()=>store.reorderCharacterStages(c.id,c.version,[first.id,first.id]),{code:'VALIDATION'});
  c=store.reorderCharacterStages(c.id,c.version,[second.id,first.id]);
  const archived=store.saveCharacterStage(stageEdit(c,first,{archived:true}));c=store.getCharacter(c.id);
  assert.deepEqual(c.stages.map(s=>s.id),[second.id,first.id]);assert.deepEqual(archived.snapshot,first.snapshot);
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {assert.deepEqual(reopened.getCharacter(c.id),c);const restored=reopened.saveCharacterStage(stageEdit(c,archived,{archived:false}));assert.equal(restored.archived,false);assert.deepEqual(restored.snapshot,first.snapshot);} finally {reopened.close();}
});

test('所有身份形态与阶段写入共用人物版本，归档期间不能编辑，失败整体回滚',t=>{
  const {store,db}=fixture(t);let c=store.saveCharacter(input()), old=c;
  c=variants(store,c,{identities:[identity('one')]});
  assert.throws(()=>store.saveCharacter(edit(old)),{code:'CONFLICT'});assert.throws(()=>variants(store,old,{forms:[form('one')]}),{code:'CONFLICT'});
  const first=store.saveCharacterStage(stageInput(c));c=store.getCharacter(c.id);const second=store.saveCharacterStage(stageInput(c,{name:'第二阶段'}));c=store.getCharacter(c.id);
  let archived=store.archiveCharacter(c.id,c.version,true);
  assert.throws(()=>variants(store,archived),{code:'VALIDATION'});assert.throws(()=>store.saveCharacterStage(stageEdit(archived,first)),{code:'VALIDATION'});assert.throws(()=>store.reorderCharacterStages(archived.id,archived.version,[second.id,first.id]),{code:'VALIDATION'});
  c=store.archiveCharacter(c.id,archived.version,false);const before=store.snapshot(),count=db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n;
  db.exec("CREATE TRIGGER reject_journey BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>variants(store,c,{forms:[form('new')]}));assert.throws(()=>store.saveCharacterStage(stageInput(c,{name:'不应存在'})));assert.throws(()=>store.saveCharacterStage(stageEdit(c,first,{summary:'不应修改'})));assert.throws(()=>store.reorderCharacterStages(c.id,c.version,[second.id,first.id]));
  assert.deepEqual(store.snapshot(),before);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,count);
});

test('形态引用的模板也同步版本，克隆基础属性允许保留停用及超界旧值',t=>{
  const {store}=fixture(t),tp=template(store);
  let c=store.saveCharacter(input({attributes:attributes(tp,{power:90,speed:20})}));
  let onlyForm=store.saveCharacter(input({name:'仅形态用模板'}));onlyForm=variants(store,onlyForm,{forms:[form('one',{attributeMode:'custom',attributes:attributes(tp,{power:40})})]});
  const originalVersion=onlyForm.version;
  const changed=template(store,{...tp,expectedVersion:tp.version,dimensions:tp.dimensions.map(d=>({...d,max:d.id==='power'?50:d.max,enabled:d.id!=='speed'}))});
  assert.equal(store.getCharacter(onlyForm.id).version,originalVersion+1);
  assert.throws(()=>variants(store,onlyForm,{forms:onlyForm.forms}),{code:'CONFLICT'});
  c=store.getCharacter(c.id);c=variants(store,c,{forms:[form('copy',{attributeMode:'custom',attributes:structuredClone(c.attributes)})]});
  assert.deepEqual(c.forms[0].attributes.values[tp.id],{power:90,speed:20});
  assert.throws(()=>variants(store,c,{forms:[{...c.forms[0],attributes:attributes(changed,{power:91})}]}),{code:'VALIDATION'});
  const captured=store.saveCharacterStage(stageInput(c));assert.equal(captured.snapshot.forms[1].attributeSchemas[0].version,changed.version);
});

test('旧库升级不虚构身份、形态或阶段，也不丢已有内容与历史',t=>{
  const {store,db,path,directory}=fixture(t);store.seed(seed);const before=store.snapshot();
  const revisions=db.prepare('SELECT * FROM revisions').all();
  // Simulate an older schema which predates the backup triggers.
  for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB '_backup_*'").all())db.exec('DROP TRIGGER \"'+name+'\"');
  db.exec('DROP TABLE character_stages; ALTER TABLE characters DROP COLUMN variants_json; ALTER TABLE characters DROP COLUMN abilities;');
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {reopened.seed(seed);assert.deepEqual(reopened.snapshot(),before);for(const c of reopened.snapshot().characters){assert.deepEqual(c.identities,[]);assert.deepEqual(c.forms,[]);assert.deepEqual(c.stages,[]);assert.equal(c.defaultFormId,'base');assert.equal(c.abilities,'');}
    const check=new BetterSqlite3(path,{readonly:true});try{assert.deepEqual(check.prepare('SELECT * FROM revisions').all(),revisions);}finally{check.close();}
  } finally{reopened.close();}
});

function relationType(store,extra={}) {return store.graph.saveType({worldId:'test-world',expectedVersion:0,name:'测试关系',color:'#bda374',active:true,...extra});}
function relationInput(a,b,type,extra={}) {return {worldId:a.worldId,sourceId:a.id,targetId:b.id,sourceStageId:null,targetStageId:null,typeId:type.id,expectedTypeVersion:type.version,label:'',description:'',direction:'mutual',status:'pending',expectedVersion:0,...extra};}

test('关系类型、双方阶段、方向、说明与布局重启保留，人物本体和阶段不被改写',t=>{
  const {store,path,directory}=fixture(t);let a=store.saveCharacter(input({name:'甲'})),b=store.saveCharacter(input({name:'乙'}));
  const as=store.saveCharacterStage(stageInput(a)),bs=store.saveCharacterStage(stageInput(b));a=store.getCharacter(a.id);b=store.getCharacter(b.id);
  const tp=relationType(store),r=store.graph.saveRelation(relationInput(a,b,tp,{sourceStageId:as.id,targetStageId:bs.id,direction:'forward',status:'confirmed',label:'保护',description:'第一段。\n\n第二段。'}));
  const layout=store.graph.saveLayout({worldId:a.worldId,expectedVersion:0,positions:{[a.id]:{x:-120.5,y:0},[b.id]:{x:330,y:280}}});
  assert.deepEqual(store.getCharacter(a.id),a);assert.deepEqual(store.getCharacter(b.id),b);assert.equal(layout.version,1);
  store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {assert.deepEqual(reopened.snapshot().relations,[r]);assert.deepEqual(reopened.snapshot().relationTypes,[tp]);assert.deepEqual(reopened.snapshot().graphLayouts,[layout]);assert.deepEqual(reopened.getCharacter(a.id),a);}finally{reopened.close();}
});

test('关系类型改名改色同步关系版本并保留旧历史，停用后只允许维护已有关系',t=>{
  const {store,db}=fixture(t);const a=store.saveCharacter(input()),b=store.saveCharacter(input({name:'另一人'}));
  const tp=relationType(store),r=store.graph.saveRelation(relationInput(a,b,tp));
  const changed=relationType(store,{...tp,name:'新关系类型',color:'#123abc',active:false,expectedVersion:tp.version});
  const current=store.snapshot().relations[0];assert.equal(current.version,r.version+1);assert.equal(store.snapshot().relationTypes[0].color,'#123abc');
  assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp,{...r,expectedVersion:r.version})),{code:'CONFLICT'});
  const history=JSON.parse(db.prepare("SELECT snapshot_json FROM relation_history WHERE entity_kind='relation' AND entity_id=? AND version=1").get(r.id).snapshot_json);assert.equal(history.type.name,'测试关系');
  assert.throws(()=>store.graph.saveRelation(relationInput(a,b,changed,{label:'新增'})),{code:'VALIDATION'});
  const edited=store.graph.saveRelation(relationInput(a,b,changed,{...current,expectedVersion:current.version,description:'已有关系可继续维护'}));assert.equal(edited.description,'已有关系可继续维护');
  const restored=relationType(store,{...changed,expectedVersion:changed.version,active:true});assert.equal(store.graph.saveRelation(relationInput(a,b,restored,{label:'新增'})).label,'新增');
});

test('关系拒绝跨世界对象、错误阶段、同一人物自连和过期类型',t=>{
  const {store,db}=fixture(t);db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('foreign','外部世界');
  const a=store.saveCharacter(input()),b=store.saveCharacter(input({name:'乙'})),foreign=store.saveCharacter(input({worldId:'foreign',name:'外部人物'}));
  const tp=relationType(store),other=relationType(store,{worldId:'foreign'}),bs=store.saveCharacterStage(stageInput(b));
  const invalid=[{targetId:a.id},{targetId:foreign.id},{sourceStageId:bs.id},{targetStageId:'missing'},{typeId:other.id},{direction:'other'},{status:'other'},{sourceStageId:undefined}];
  for(const change of invalid)assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp,change)),{code:'VALIDATION'});
  relationType(store,{...tp,expectedVersion:tp.version,name:'更新'});
  assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp)),{code:'CONFLICT'});assert.equal(store.snapshot().relations.length,0);
});

test('多种关系可以共存，双向反序重复被拒绝，单向关系保留各自方向',t=>{
  const {store}=fixture(t);const a=store.saveCharacter(input()),b=store.saveCharacter(input({name:'乙'})),tp=relationType(store),other=relationType(store,{name:'第二种'});
  store.graph.saveRelation(relationInput(a,b,tp));assert.throws(()=>store.graph.saveRelation(relationInput(b,a,tp)),{code:'VALIDATION'});
  store.graph.saveRelation(relationInput(a,b,other));store.graph.saveRelation(relationInput(a,b,tp,{label:'另一个角度'}));
  store.graph.saveRelation(relationInput(a,b,tp,{direction:'forward'}));store.graph.saveRelation(relationInput(b,a,tp,{direction:'forward'}));
  const stage=store.saveCharacterStage(stageInput(a));store.graph.saveRelation(relationInput(a,b,tp,{sourceStageId:stage.id}));assert.equal(store.snapshot().relations.length,6);
});

test('归档恢复关系保留内容，已有归档人物或阶段不阻止维护，新增关联需先恢复',t=>{
  const {store}=fixture(t);let a=store.saveCharacter(input()),b=store.saveCharacter(input({name:'乙'}));const stage=store.saveCharacterStage(stageInput(a));a=store.getCharacter(a.id);
  const tp=relationType(store),r=store.graph.saveRelation(relationInput(a,b,tp,{sourceStageId:stage.id,description:'保留'}));
  store.saveCharacterStage(stageEdit(a,stage,{archived:true}));a=store.getCharacter(a.id);a=store.archiveCharacter(a.id,a.version,true);
  assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp,{label:'新关系'})),{code:'VALIDATION'});
  const edited=store.graph.saveRelation(relationInput(a,b,tp,{...r,expectedVersion:r.version,description:'维护现有说明'}));
  const archived=store.graph.archiveRelation(r.id,edited.version,true);assert.equal(archived.description,'维护现有说明');
  assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp,{...archived,expectedVersion:archived.version})),{code:'VALIDATION'});
  assert.equal(store.graph.archiveRelation(r.id,archived.version,false).archived,false);
});

test('关系历史写入失败时回滚类型、关联记录和版本，布局失败不覆盖旧位置',t=>{
  const {store,db}=fixture(t);const a=store.saveCharacter(input()),b=store.saveCharacter(input({name:'乙'})),tp=relationType(store),r=store.graph.saveRelation(relationInput(a,b,tp));
  store.graph.saveLayout({worldId:a.worldId,expectedVersion:0,positions:{[a.id]:{x:0,y:0}}});const before=store.snapshot(),historyCount=db.prepare('SELECT COUNT(*) AS n FROM relation_history').get().n;
  db.exec("CREATE TRIGGER reject_relation_history BEFORE INSERT ON relation_history BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp,{...r,expectedVersion:r.version,label:'不应保存'})));assert.throws(()=>store.graph.saveRelation(relationInput(a,b,tp,{label:'不应新建'})));assert.throws(()=>relationType(store,{...tp,name:'不应改名',expectedVersion:tp.version}));assert.throws(()=>store.graph.archiveRelation(r.id,r.version,true));
  assert.deepEqual(store.snapshot(),before);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relation_history').get().n,historyCount);
  db.exec("CREATE TRIGGER reject_layout BEFORE UPDATE ON graph_layouts BEGIN SELECT RAISE(ABORT,'test failure'); END;");assert.throws(()=>store.graph.saveLayout({worldId:a.worldId,expectedVersion:1,positions:{[a.id]:{x:10,y:10}}}));assert.deepEqual(store.snapshot().graphLayouts,before.graphLayouts);
});

test('布局局部保存保留隐藏节点，拒绝旧版本、非法坐标与跨世界节点',t=>{
  const {store,db}=fixture(t);const a=store.saveCharacter(input()),b=store.saveCharacter(input({name:'乙'}));db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run('foreign','外部世界');const foreign=store.saveCharacter(input({worldId:'foreign'}));
  store.graph.saveLayout({worldId:a.worldId,expectedVersion:0,positions:{[a.id]:{x:1,y:2},[b.id]:{x:300,y:0}}});
  const changed=store.graph.saveLayout({worldId:a.worldId,expectedVersion:1,positions:{[a.id]:{x:20,y:30}}});assert.deepEqual(changed.positions[b.id],{x:300,y:0});
  assert.throws(()=>store.graph.saveLayout({worldId:a.worldId,expectedVersion:1,positions:{}}),{code:'CONFLICT'});
  for(const positions of [{[a.id]:{x:Infinity,y:1}},{[a.id]:{x:100001,y:1}},{[a.id]:{x:'1',y:1}},{[foreign.id]:{x:0,y:0}},JSON.parse('{"__proto__":{"x":0,"y":0}}')])assert.throws(()=>store.graph.saveLayout({worldId:a.worldId,expectedVersion:2,positions}),{code:'VALIDATION'});
  assert.deepEqual(store.snapshot().graphLayouts,[changed]);
});

test('恢复关系时也校验双向重复，阶段筛选包含通用关系但不串到其他阶段',async t=>{
  const {relationsForCharacter}=await import('../src/shared/relations.ts');const {store}=fixture(t);let a=store.saveCharacter(input());const b=store.saveCharacter(input({name:'乙'})),tp=relationType(store);
  const first=store.saveCharacterStage(stageInput(a));a=store.getCharacter(a.id);const second=store.saveCharacterStage(stageInput(a,{name:'第二期'}));
  const generic=store.graph.saveRelation(relationInput(a,b,tp));const one=store.graph.saveRelation(relationInput(a,b,tp,{sourceStageId:first.id}));store.graph.saveRelation(relationInput(a,b,tp,{sourceStageId:second.id}));
  assert.deepEqual(relationsForCharacter(store.snapshot().relations,a.id,first.id).map(r=>r.id),[generic.id,one.id]);
  const archived=store.graph.archiveRelation(generic.id,generic.version,true);store.graph.saveRelation(relationInput(b,a,tp));assert.throws(()=>store.graph.archiveRelation(archived.id,archived.version,false),{code:'VALIDATION'});
});

test('关系功能迁移只新增空表，原有两位人物和已保存阶段保持一致',t=>{
  const {store,db,path,directory}=fixture(t);store.seed(seed);const c=store.snapshot().characters[0];store.saveCharacterStage(stageInput(c));const before=store.snapshot();
  db.exec('DROP TABLE character_relations; DROP TABLE relation_history; DROP TABLE relation_types; DROP TABLE graph_layouts;');store.close();const reopened=new LibraryStore(new BetterSqlite3(path),directory);
  try {assert.deepEqual(reopened.snapshot(),before);assert.deepEqual(reopened.snapshot().relations,[]);assert.deepEqual(reopened.snapshot().relationTypes,[]);}finally{reopened.close();}
});
