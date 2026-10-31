import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyPackageVersion} from '../scripts/verify-package-version.mjs';

function fixture(t,appVersion,rendererVersion){
  const root=mkdtempSync(join(tmpdir(),'wanxiang-version-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'dist-ui'));
  writeFileSync(join(root,'package.json'),JSON.stringify({version:appVersion}));
  if(rendererVersion!==null)writeFileSync(join(root,'dist-ui/app-version.json'),JSON.stringify({format:1,version:rendererVersion}));
  return root;
}
test('实际应用包与本次界面构建版本一致才能通过成品检查',t=>{
  assert.deepEqual(verifyPackageVersion(fixture(t,'1.2.3','1.2.3'),'1.2.3'),{appVersion:'1.2.3',rendererVersion:'1.2.3'});
});
test('只更新外部文件名或发布版本不能掩盖旧应用包',t=>{
  assert.throws(()=>verifyPackageVersion(fixture(t,'1.2.2','1.2.2'),'1.2.3'),/应用版本与待发布版本不一致/);
});
test('更新 package.json 却误带旧界面时拒绝发布',t=>{
  assert.throws(()=>verifyPackageVersion(fixture(t,'1.2.3','1.2.2'),'1.2.3'),/界面构建版本与应用版本不一致/);
});
test('未重新构建、缺少界面版本凭据时拒绝发布',t=>{
  assert.throws(()=>verifyPackageVersion(fixture(t,'1.2.3',null),'1.2.3'),{code:'ENOENT'});
});
