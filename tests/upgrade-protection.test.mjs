import test from 'node:test';
import assert from 'node:assert/strict';
import DB from 'better-sqlite3';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LibraryStore} from '../src/core/store.ts';
import {blankChapter} from '../src/shared/chapters.ts';
import {openProtectedLibrary,createProtectionPoint,verifyProtectionPoint,listProtectionPoints,restoreProtectionPoint,recoverInterruptedUpgrade} from '../src/core/upgrade-protection.ts';
import {schemaFingerprint,LEGACY_PACKAGE_SCHEMAS} from '../src/core/schema-format.ts';
import {TransferService} from '../src/core/transfer.ts';
import {LIBRARY_FORMAT_VERSION,LIBRARY_SCHEMA} from '../src/core/library-version.ts';
import {digest} from '../src/core/backup-journal.ts';
const root=resolve('test-results/update-tests');mkdirSync(root,{recursive:true});const dir=()=>mkdtempSync(join(root,'library-'));
function fixture(){
  const directory=dir(),db=new DB(join(directory,'library.sqlite')),store=new LibraryStore(db,directory);
  const work=store.workspace.createWork({name:'原作品',world:{kind:'new',name:'原世界',description:'旧设定'}});
  store.chapters.save({...blankChapter(store.chapters.getOutline(work.id)),name:'旧章节',body:'正文必须保留。\n第二段'});
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),asset=store.importImage(work.worldId,bytes,'图.png',{width:1,height:1});
  store.saveCharacter({worldId:work.worldId,expectedVersion:0,name:'原人物',caption:'',status:'',quote:'',intro:'',body:'旧人物经历',pending:'',facts:[],tagIds:[],portraitId:asset.id});
  return {directory,db,store,asset,bytes};
}
test('旧库在副本升级，正文人物图片历史与游标保留；再次启动不重复保护',async()=>{
  const f=fixture();assert.equal(schemaFingerprint(f.db),LIBRARY_SCHEMA);const before=f.store.snapshot(),cursor=f.store.journal.sequence();f.store.close();
  const opened=await openProtectedLibrary(f.directory,'0.2.0');
  try{assert.deepEqual(opened.store.snapshot(),before);assert.equal(opened.store.journal.sequence(),cursor);assert.equal(opened.db.pragma('user_version',{simple:true}),LIBRARY_FORMAT_VERSION);assert.deepEqual(readFileSync(join(f.directory,'media',f.asset.fileName)),f.bytes);}finally{opened.store.close();}
  const points=listProtectionPoints(f.directory);assert.equal(points.length,1);await verifyProtectionPoint(f.directory,points[0].id);
  const again=await openProtectedLibrary(f.directory,'0.2.0');again.store.close();assert.equal(listProtectionPoints(f.directory).length,1);
});
test('未来版本和未知结构不会修改原库；迁移校验失败保留旧库和完整保护点',async()=>{
  for(const mode of ['future','unknown','migration']){
    const f=fixture();if(mode==='future')f.db.pragma('user_version=20');else{f.db.exec('CREATE TABLE unknown(value TEXT)');if(mode==='unknown')f.db.pragma('user_version=1');}f.store.close();
    const file=join(f.directory,'library.sqlite'),before=readFileSync(file);await assert.rejects(openProtectedLibrary(f.directory,'0.2.0'));assert.deepEqual(readFileSync(file),before);
    if(mode==='migration'){const points=listProtectionPoints(f.directory);assert.equal(points.length,1);await verifyProtectionPoint(f.directory,points[0].id);}
  }
});
test('保护点图片损坏拒绝恢复，恢复成功前另存当前新增内容',async()=>{
  const f=fixture();f.store.close();const point=await createProtectionPoint(f.directory,'0.1.0','0.2.0');
  let opened=await openProtectedLibrary(f.directory,'0.2.0');opened.store.workspace.createWork({name:'升级后新增作品',world:{kind:'new',name:'新世界',description:''}});opened.store.close();
  const preserved=await restoreProtectionPoint(f.directory,point.id,'0.2.0');await verifyProtectionPoint(f.directory,preserved.id);
  const kept=new DB(join(f.directory,'upgrade-recovery',preserved.id,'source.sqlite'),{readonly:true});assert.ok(kept.prepare('SELECT name FROM works').all().some(w=>w.name==='升级后新增作品'));kept.close();
  opened=await openProtectedLibrary(f.directory,'0.2.0');assert.equal(opened.store.snapshot().works.length,1);opened.store.close();
  writeFileSync(join(f.directory,'upgrade-recovery',point.id,'media',f.asset.fileName),'damaged');const before=readFileSync(join(f.directory,'library.sqlite'));
  await assert.rejects(restoreProtectionPoint(f.directory,point.id,'0.2.0'),/校验失败/);assert.deepEqual(readFileSync(join(f.directory,'library.sqlite')),before);
});
test('切换断电留下日志时回到原库，保留失败候选',async()=>{
  const f=fixture();f.store.close();const point=await createProtectionPoint(f.directory,'0.1.0','0.2.0'),path=join(f.directory,'library.sqlite'),before=readFileSync(path);
  renameSync(path,join(f.directory,'upgrade-recovery',point.id,'previous.sqlite'));writeFileSync(path,'incomplete candidate');writeFileSync(join(f.directory,'upgrade-switch.json'),JSON.stringify({version:1,id:point.id,phase:'prepared'}));
  assert.equal(await recoverInterruptedUpgrade(f.directory),true);assert.deepEqual(readFileSync(path),before);assert.equal(existsSync(join(f.directory,'upgrade-switch.json')),false);
});
test('缺少引用图片时停止保护与更新，旧资料包所有历史布局仍可预览',async()=>{
  const f=fixture();try{
    const file=f.store.transfer.export({format:'package',scope:'library'});
    for(const schema of LEGACY_PACKAGE_SCHEMAS){const wrapped=JSON.parse(file.content);wrapped.data.schema=schema;wrapped.sha256=digest(JSON.stringify(wrapped.data));const preview=new TransferService(f.store).preview({...file,content:JSON.stringify(wrapped)});assert.equal(preview.characters,1);assert.equal(preview.images,1);}
  }finally{f.store.close();}
  renameSync(join(f.directory,'media',f.asset.fileName),join(f.directory,'lost.png'));await assert.rejects(createProtectionPoint(f.directory,'0.1.0','0.2.0'),/图片缺失/);
});
