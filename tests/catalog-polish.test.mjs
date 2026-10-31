import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import DB from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {blankCatalog} from '../src/shared/catalogs.ts';
import {searchLibrary} from '../src/shared/search.ts';
import {mediaUses} from '../src/shared/gallery.ts';
import {schemaFingerprint} from '../src/core/schema-format.ts';
import {openProtectedLibrary,listProtectionPoints} from '../src/core/upgrade-protection.ts';
import {LIBRARY_SCHEMA} from '../src/core/library-version.ts';
import {BackupService} from '../src/core/backups.ts';
const root=resolve('test-results/catalog-polish');mkdirSync(root,{recursive:true});
function fixture(t){const dir=mkdtempSync(join(root,'case-')),db=new DB(join(dir,'library.sqlite')),s=new LibraryStore(db,dir),w=s.workspace.createWork({name:'主作品',world:{kind:'new',name:'测试世界',description:''}});t.after(()=>{if(db.open)s.close();});return {dir,db,s,w};}
const edit=c=>({...c,tagIds:c.tags.map(t=>t.id),expectedVersion:c.version});
function setup(f){const {s,w}=f,worldId=w.worldId;
  const tag=s.saveTag({worldId,name:'珍宝',color:'#77a993',expectedVersion:0});
  const template=s.saveAttributeTemplate({worldId,name:'统一战力',dimensions:[{id:'power',name:'威力',min:0,max:100,enabled:true,unit:'点'}],makeDefault:true,expectedDefaultVersion:0,expectedVersion:0});
  const attributes={templateId:template.id,values:{[template.id]:{power:70}},versions:{[template.id]:template.version}};
  const image=s.importImage(worldId,readFileSync('resources/seed/gu.png'),'设定.png');
  const character=s.saveCharacter({worldId,name:'沈墨',expectedVersion:0,caption:'',status:'草稿',quote:'',intro:'',body:'隐秘的雪山守卫',pending:'',facts:[],tagIds:[tag.id],portraitId:image.id,designImageId:image.id,attributes});
  const records=['item','technique','place'].map(kind=>s.catalogs.save(kind,{...blankCatalog(kind,worldId),name:kind+'珍宝',designImageId:image.id,imageId:image.id,tagIds:[tag.id],attributes,facts:[{id:'fact',label:'限制',value:'不超过当前境界'}]}));
  return {tag,template,attributes,image,character,records};
}
test('双图、标签、属性与自定义字段保存、版本冲突、素材引用及导入重绑',t=>{
  const f=fixture(t),{s}=f,r=setup(f);
  for(const c of r.records){assert.equal(c.designImageId,r.image.id);assert.equal(c.attributes.values[r.template.id].power,70);assert.ok(s.deletion.preview({kind:'media',id:r.image.id}).blockers.includes(c.name));assert.throws(()=>s.catalogs.save(c.kind,{...c,expectedVersion:c.version,attributes:{...r.attributes,values:{[r.template.id]:{power:101}}}}),{code:'VALIDATION'});}
  assert.equal(mediaUses(s.snapshot(),f.w.worldId).get(r.image.id).length,8);
  const file=s.transfer.export({scope:'work',id:f.w.id,format:'package'}),p=s.transfer.preview(file),copy=s.transfer.confirm({token:p.token}),snap=s.snapshot(),worldId=copy.worldIds[0],c=snap.characters.find(c=>c.worldId===worldId),i=snap.items.find(i=>i.worldId===worldId);
  assert.notEqual(i.designImageId,r.image.id);assert.equal(c.designImageId,i.designImageId);assert.notEqual(i.tagIds[0],r.tag.id);assert.notEqual(i.attributes.templateId,r.template.id);assert.equal(Object.values(i.attributes.values[i.attributes.templateId])[0],70);
  s.saveTag({...r.tag,name:'圣物',expectedVersion:r.tag.version});assert.equal(s.catalogs.get('item',r.records[0].id).version,2);assert.throws(()=>s.catalogs.save('item',{...r.records[0],expectedVersion:1}),{code:'CONFLICT'});
  s.deleteTag(r.tag.id,2);assert.deepEqual(s.catalogs.get('item',r.records[0].id).tagIds,[]);
});
test('模板改范围不改旧数值，历史恢复使用当前模板版本且恢复双图与字段',t=>{
  const f=fixture(t),{s}=f,r=setup(f),item=r.records[0];
  const updated=s.catalogs.save('item',{...item,expectedVersion:item.version,designImageId:null,facts:[]});
  s.saveAttributeTemplate({...r.template,name:'统一尺度',expectedVersion:1,makeDefault:true,expectedDefaultVersion:1});
  const p=s.history.preview({kind:'item',entityId:item.id,version:1});s.history.restore({token:p.token});assert.equal(s.catalogs.get('item',item.id).designImageId,r.image.id);assert.equal(s.catalogs.get('item',item.id).facts.length,1);
  s.saveAttributeTemplate({...r.template,dimensions:r.template.dimensions.map(d=>({...d,max:50})),expectedVersion:2,makeDefault:true,expectedDefaultVersion:1});
  const current=s.catalogs.get('item',item.id);assert.equal(current.attributes.values[r.template.id].power,70);assert.equal(s.catalogs.save('item',{...current,expectedVersion:current.version,summary:'保留超限旧值'}).attributes.values[r.template.id].power,70);
  assert.throws(()=>s.catalogs.save('item',{...current,expectedVersion:current.version+1,attributes:{...current.attributes,values:{[r.template.id]:{power:71}}}}),{code:'VALIDATION'});
});
test('人物阶段冻结设定图，回退与备份恢复保留双图及三库字段',async t=>{
  const f=fixture(t),{s}=f,r=setup(f);
  s.saveCharacterStage({characterId:r.character.id,expectedVersion:r.character.version,name:'初见',period:'',summary:'',identityIds:[],formIds:['base'],defaultFormId:'base',attributeValues:{},archived:false});
  const c=s.getCharacter(r.character.id);assert.equal(c.stages[0].snapshot.profile.designImageId,r.image.id);s.saveCharacter({...edit(c),designImageId:null});assert.equal(s.getCharacter(c.id).stages[0].snapshot.profile.designImageId,r.image.id);
  const p=s.history.preview({kind:'character',entityId:c.id,version:1});s.history.restore({token:p.token});assert.equal(s.getCharacter(c.id).designImageId,r.image.id);
  const b=new BackupService({store:s,directory:f.dir,openDatabase:p=>new DB(p)});t.after(()=>b.stop());const baseline=await b.baseline(b.estimate());const current=s.getCharacter(c.id);s.saveCharacter({...edit(current),designImageId:null});const restore=await b.previewRestore(baseline.point.id);await b.restore(restore.token);assert.equal(s.getCharacter(c.id).designImageId,r.image.id);assert.equal(s.catalogs.get('item',r.records[0].id).designImageId,r.image.id);
});
test('格式 2 升级保留原资料与旧包，保护点可追溯',async t=>{
  const f=fixture(t),{s,db,dir}=f;const old=s.catalogs.save('item',{...blankCatalog('item',f.w.worldId),name:'旧物品'});db.exec('DROP TABLE character_images');assert.equal(schemaFingerprint(db),'f417631c1be19013b9d05d1f889a861e99deaa300b07ff5bb2437f9f78e1389e');db.pragma('user_version=2');s.close();const opened=await openProtectedLibrary(dir,'0.1.3');try{assert.equal(schemaFingerprint(opened.db),LIBRARY_SCHEMA);assert.equal(opened.store.catalogs.get('item',old.id).name,'旧物品');assert.equal(listProtectionPoints(dir).length,1);}finally{opened.store.close();}
});
test('全局搜索跨世界涵盖正文、标签、归档及类型筛选',t=>{
  const f=fixture(t),{s}=f,r=setup(f),w=s.workspace.createWork({name:'第二作品',world:{kind:'new',name:'远方',description:''}});
  const p=s.catalogs.save('place',{...blankCatalog('place',w.worldId),name:'雪山古城',body:'远古守卫驻地'});let snap=s.snapshot();assert.ok(searchLibrary(snap,'雪山').some(h=>h.id===r.character.id));assert.ok(searchLibrary(snap,'雪山').some(h=>h.id===p.id));assert.equal(searchLibrary(snap,'珍宝','item').length,1);assert.equal(searchLibrary(snap,'远古 守卫','place')[0].id,p.id);
  s.catalogs.archive('place',p.id,p.version,true);snap=s.snapshot();assert.equal(searchLibrary(snap,'雪山','place').length,0);assert.equal(searchLibrary(snap,'雪山','place',true).length,1);
});
