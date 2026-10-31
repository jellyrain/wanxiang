// Test the delivered Electron runtime + native SQLite, using disposable data only.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyPackageVersion} from './verify-package-version.mjs';
const root=resolve(import.meta.dirname,'..'),base=resolve(tmpdir()),temporary=mkdtempSync(join(base,'wanxiang-package-smoke-'));
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
let executable,appDirectory;
try{
  if(process.platform==='win32'){
    const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder')),seven=await builder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
    const result=spawnSync(seven,['x',join(root,`release/windows/WanxiangWorkshop-${version}-win-x64-Portable.zip`),'-o'+temporary,'-y'],{stdio:'ignore',windowsHide:true});
    if(result.error||result.status!==0)throw Error('无法解压 Windows 发布包。');
    executable=join(temporary,'WanxiangWorkshop/万象工坊.exe');appDirectory=join(temporary,'WanxiangWorkshop/resources/app');
  }else if(process.platform==='darwin'){
    const bundle=join(root,`release/mac-${process.arch}`,process.arch==='arm64'?'mac-arm64':'mac','万象工坊.app','Contents');
    executable=join(bundle,'MacOS/万象工坊');appDirectory=join(bundle,'Resources/app');
  }else{
    const folder=join(root,`release/linux-${process.arch}`,process.arch==='arm64'?'linux-arm64-unpacked':'linux-unpacked');
    executable=join(folder,'wanxiang');appDirectory=join(folder,'resources/app');
  }
  if(!existsSync(executable)||!existsSync(appDirectory))throw Error('未找到对应系统的打包程序。');
  console.log(JSON.stringify({versions:verifyPackageVersion(appDirectory,version)}));
  const script=join(temporary,'verify.cjs');
  writeFileSync(script,String.raw`const assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{join}=require('node:path'),{existsSync,readFileSync}=require('node:fs');
const appDirectory=${JSON.stringify(appDirectory)},directory=${JSON.stringify(join(temporary,'library'))};
const req=createRequire(join(appDirectory,'package.json'));
(async()=>{
  const Database=req('better-sqlite3'),db=new Database(':memory:');
  assert.equal(db.prepare('select 42 as value').get().value,42);db.close();
  const {openProtectedLibrary}=await import(pathToFileURL(join(appDirectory,'dist-desktop/src/core/upgrade-protection.js')));
  const {store}=await openProtectedLibrary(directory,req('./package.json').version);
  store.workspace.createWork({name:'三端打包检查',world:{kind:'new',name:'测试世界',description:''}});
  assert.equal(store.snapshot().works[0].name,'三端打包检查');store.close();
  const {store:reopened}=await openProtectedLibrary(directory,req('./package.json').version);assert.equal(reopened.snapshot().works[0].name,'三端打包检查');reopened.close();
  const html=readFileSync(join(appDirectory,'dist-ui/index.html'),'utf8');
  const assets=[...html.matchAll(/(?:src|href)="(\.\/assets\/[^"\s]+)"/g)];assert.ok(assets.length>=2,'Renderer assets must be present');
  for(const match of assets)assert.ok(existsSync(join(appDirectory,'dist-ui',match[1])),match[1]);
  for(const file of ['resources/api-contract.json','resources/release-config.json','resources/skills/wanxiang-workshop-api.zip','resources/skills/wanxiang-workshop-mcp.zip'])assert.ok(existsSync(join(appDirectory,file)),file);
  console.log(JSON.stringify({ok:true,platform:process.platform,arch:process.arch,version:req('./package.json').version,sqlite:true,persistence:true,resources:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});`);
  const result=spawnSync(executable,[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:60000});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr||result.stdout||'原生运行时检查失败');
  console.log(result.stdout.trim());
}finally{
  if(!temporary.startsWith(base+sep))throw Error('拒绝清理非临时目录');
  rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
