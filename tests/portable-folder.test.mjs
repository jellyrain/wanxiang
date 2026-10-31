import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {writeProgramManifest,cleanBuildDirectory,afterPack} from '../scripts/package-layout.mjs';
const root=resolve('test-results/portable-folder-tests');mkdirSync(root,{recursive:true});
const sha=bytes=>createHash('sha512').update(bytes).digest('hex');
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const seven=process.platform==='win32'?await builder('app-builder-lib/out/toolsets/7zip.js').getPath7za():undefined;
function fixture(t){const path=mkdtempSync(join(root,'case-'));t.after(()=>{assert.ok(path.startsWith(root+sep));rmSync(path,{recursive:true,force:true,maxRetries:5,retryDelay:200});});return path;}
async function prepare(t,{badExe=false,extra}={}){
  const base=fixture(t),directory=join(base,"万象 ' 工坊"),work=join(directory,'data/update-cache/p-test');
  const executable='workshop.exe',old=readFileSync(join(process.env.SystemRoot,'System32/whoami.exe')),next=badExe?Buffer.from('invalid executable'):readFileSync(join(process.env.SystemRoot,'System32/hostname.exe'));
  mkdirSync(join(directory,'resources'),{recursive:true});writeFileSync(join(directory,executable),old);writeFileSync(join(directory,'resources/removed.txt'),'obsolete');writeFileSync(join(directory,'wanxiang-portable.json'),'{}');writeProgramManifest(directory,'0.1.0',executable);
  mkdirSync(work,{recursive:true});writeFileSync(join(directory,'data/creative.txt'),'作品与设置');writeFileSync(join(directory,'user-note.txt'),'custom file');
  const stage=join(base,'stage'),payload=join(stage,'WanxiangWorkshop');mkdirSync(join(payload,'resources'),{recursive:true});
  writeFileSync(join(payload,executable),next);writeFileSync(join(payload,'resources/new.txt'),'new resource');writeFileSync(join(payload,'wanxiang-portable.json'),'{}');writeProgramManifest(payload,'0.2.0',executable);
  if(extra){mkdirSync(dirname(join(payload,extra)),{recursive:true});writeFileSync(join(payload,extra),'must reject');}
  const archive=join(work,'update.zip'),zip=spawnSync(seven,['a','-tzip',archive,'WanxiangWorkshop'],{cwd:stage,windowsHide:true,encoding:'utf8'});assert.equal(zip.status,0,zip.stderr);
  return {base,directory,work,old,next,job:{pid:2147483647,directory,executable,archive,root:'WanxiangWorkshop',version:'0.2.0',sha512:sha(readFileSync(archive)),ready:join(work,'ready'),result:join(directory,'data/update-cache/portable-result.json')}};
}
async function helper(job){
  const config=join(dirname(job.ready),'install.json');writeFileSync(config,JSON.stringify(job));
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('resources/updater/portable-install.ps1'),'-Config',config],{windowsHide:true,stdio:'pipe'});
  let output='';child.stderr.on('data',b=>output+=b);return await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',code=>done({code,output}));});
}
test('文件夹更新替换整套程序，保留 data、自定义文件和旧程序，支持中文与单引号路径',{skip:process.platform!=='win32'},async t=>{
  const f=await prepare(t),r=await helper(f.job);assert.equal(r.code,0,r.output);const result=JSON.parse(readFileSync(f.job.result,'utf8'));assert.equal(result.ok,true,result.error);
  assert.deepEqual(readFileSync(join(f.directory,f.job.executable)),f.next);assert.deepEqual(readFileSync(join(result.backup,f.job.executable)),f.old);
  assert.equal(existsSync(join(f.directory,'resources/removed.txt')),false);assert.equal(readFileSync(join(f.directory,'resources/new.txt'),'utf8'),'new resource');
  assert.equal(readFileSync(join(f.directory,'data/creative.txt'),'utf8'),'作品与设置');assert.equal(readFileSync(join(f.directory,'user-note.txt'),'utf8'),'custom file');
});
test('校验失败、ZIP 包夹带 data 或多余文件时拒绝更新，启动失败时回退旧程序',{skip:process.platform!=='win32'},async t=>{
  for(const kind of ['checksum','data','extra','launch']){
    const f=await prepare(t,{badExe:kind==='launch',extra:kind==='data'?'data/creative.txt':kind==='extra'?'unexpected.txt':undefined});if(kind==='checksum')f.job.sha512='0'.repeat(128);
    const r=await helper(f.job);assert.equal(r.code,1,kind);assert.deepEqual(readFileSync(join(f.directory,f.job.executable)),f.old,kind);assert.equal(readFileSync(join(f.directory,'data/creative.txt'),'utf8'),'作品与设置');
    const result=JSON.parse(readFileSync(f.job.result,'utf8'));assert.equal(result.ok,false);if(kind==='launch')assert.ok(existsSync(f.job.ready),result.error);else assert.equal(existsSync(f.job.ready),false,result.error);
  }
});
test('下载 ZIP 的驱动启动真实更新助手，主进程退出后仍能完成更新',{skip:process.platform!=='win32',timeout:40000},async t=>{
  const f=await prepare(t),bytes=readFileSync(f.job.archive),manifest={format:2,kind:'folder-zip',root:'WanxiangWorkshop',version:'0.2.0',file:'WanxiangWorkshop-0.2.0-win-x64-Portable.zip',bytes:bytes.length,sha512:sha(bytes)};
  const server=createServer((req,res)=>res.end(req.url==='/latest-portable.json'?JSON.stringify(manifest):bytes));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const options={version:'0.1.0',executable:join(f.directory,f.job.executable),cache:join(f.directory,'data/update-cache'),helper:resolve('resources/updater/portable-install.ps1')};
  const script=`import {createPortableDriver} from ${JSON.stringify(new URL('../electron/portable-update.ts',import.meta.url).href)};const driver=createPortableDriver({...${JSON.stringify(options)},quit:()=>process.exit(0)});await driver.check('http://127.0.0.1:${server.address().port}/');await driver.download(()=>{});await driver.install();`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,stdio:'pipe'});t.after(()=>{if(child.exitCode===null)child.kill();});let stderr='';child.stderr.on('data',b=>stderr+=b);
  assert.equal(await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);}),0,stderr);
  for(let n=0;n<150&&!existsSync(f.job.result);n++)await new Promise(r=>setTimeout(r,100));
  assert.ok(existsSync(f.job.result),'helper survives app exit');const result=JSON.parse(readFileSync(f.job.result,'utf8'));assert.equal(result.ok,true,result.error);assert.deepEqual(readFileSync(join(f.directory,f.job.executable)),f.next);
});
test('NSIS 仅删除发布文件，打包清理限制在指定临时目录，资料不会进入发布包',async t=>{
  const base=fixture(t),program=join(base,'app'),resources=join(base,'build');mkdirSync(join(program,'resources'),{recursive:true});writeFileSync(join(program,'app.exe'),'fixture');writeFileSync(join(program,'resources/code.js'),'code');
  afterPack({appOutDir:program,packager:{appInfo:{version:'0.1.0',productFilename:'app'},config:{},info:{buildResourcesDir:resources}}});
  const macro=readFileSync(join(resources,'remove-program-files.nsh'),'utf8');assert.ok(macro.includes('Delete "$INSTDIR\\app.exe"'));assert.ok(!/RMDir\s+\/r|\\data/i.test(macro));
  mkdirSync(join(program,'data'));assert.throws(()=>writeProgramManifest(program,'0.1.0','app.exe'),/data/);
  const builds=join(base,'release');mkdirSync(builds);const temporary=mkdtempSync(join(builds,'.windows-build-'));writeFileSync(join(temporary,'partial'),'incomplete');await cleanBuildDirectory(temporary,builds);assert.equal(existsSync(temporary),false);
  await assert.rejects(cleanBuildDirectory(program,builds));assert.ok(existsSync(join(program,'data')));assert.deepEqual(readdirSync(builds),[]);
});
