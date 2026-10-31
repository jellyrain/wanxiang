import test from 'node:test';
import assert from 'node:assert/strict';
import DB from 'better-sqlite3';
import {LibraryStore} from '../src/core/store.ts';
import {assertLibraryVersion,markLibraryVersion,LIBRARY_FORMAT_VERSION} from '../src/core/library-version.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('较新版资料库在建表或迁移之前被拒绝，内容及版本保持原样',()=>{
  const db=new DB(':memory:');db.exec('PRAGMA user_version=99;CREATE TABLE future(value TEXT);INSERT INTO future VALUES(\'保留未来资料\')');
  const before=db.serialize();assert.throws(()=>assertLibraryVersion(db),e=>e.code==='NEWER_LIBRARY');assert.deepEqual(db.serialize(),before);db.close();
});
test('已有资料库首次登记版本及重复启动不改变创作内容或备份游标',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wanxiang-version-'));const db=new DB(':memory:');
  try{
    assertLibraryVersion(db);const store=new LibraryStore(db,dir);
    store.workspace.createWork({name:'升级前的作品',world:{kind:'new',name:'原世界',description:'保留设定'}});
    const before=JSON.stringify(store.snapshot()),sequence=store.journal.sequence();
    markLibraryVersion(db);assertLibraryVersion(db);markLibraryVersion(db);
    assert.equal(db.pragma('user_version',{simple:true}),LIBRARY_FORMAT_VERSION);
    assert.equal(JSON.stringify(store.snapshot()),before);assert.equal(store.journal.sequence(),sequence);store.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
