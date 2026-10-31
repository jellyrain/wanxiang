// Real packaged upgrade acceptance, using a dedicated installer identity and profiles.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,copyFileSync,writeFileSync,openSync,closeSync,statSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {rename,rm} from 'node:fs/promises';
import DB from 'better-sqlite3';
import {listProtectionPoints,verifyProtectionPoint} from '../src/core/upgrade-protection.ts';

const project=resolve(import.meta.dirname,'..'),fixtures=join(project,'test-results/packaged-update-acceptance');
const run=mkdtempSync(join(fixtures,'run-')),report={run,isolatedInstallerIdentity:true,sourceReadOnly:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const log=(message)=>console.log(new Date().toISOString()+' '+message);
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const seven=await builder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
function extract(archive,destination){mkdirSync(destination,{recursive:true});const result=spawnSync(seven,['x','-y','-o'+destination,archive],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return join(destination,'WanxiangWorkshop');}
const extracted={};for(const version of ['0.1.0','0.1.1'])extracted[version]=extract(join(fixtures,version,`WanxiangWorkshop-${version}-win-x64-Portable.zip`),join(run,'payload-'+version));
for(const version of ['0.1.0','0.1.1'])for(const path of [
  'dist-desktop/electron/main.js','dist-desktop/electron/portable-update.js',
  'dist-desktop/electron/nsis-update.js','dist-desktop/electron/updater.js',
  'dist-desktop/electron/lifecycle.js','resources/updater/portable-install.ps1'
])assert.equal(hash(readFileSync(join(extracted[version],'resources/app',path))),hash(readFileSync(join(project,path))),version+' runtime must match release build: '+path);
report.fixturesShareReleaseRuntime=true;
writeFileSync(join(fixtures,'latest-run.json'),JSON.stringify({run}));
async function until(action,label,timeout=120000){let last;for(const end=Date.now()+timeout;Date.now()<end;){try{const result=await action();if(result)return result;}catch(e){last=e;}await sleep(500);}throw Error(label+' timed out: '+(last?.message??''));}
function environment(profile){
  const env={...process.env,WANXIANG_HTTP_PORT:'0'};
  for(const key of ['ELECTRON_RUN_AS_NODE','WANXIANG_DEV_URL','OC_STUDIO_DEV_URL','PORTABLE_EXECUTABLE_FILE','PORTABLE_EXECUTABLE_DIR'])delete env[key];
  return env;
}
function launch(exe,args,profile){mkdirSync(profile,{recursive:true});const file=openSync(join(profile,'process-'+Date.now()+'.log'),'w');let child;try{child=spawn(exe,args,{env:environment(profile),windowsHide:true,stdio:['ignore',file,file]});}finally{closeSync(file);}child.on('error',e=>log(e.message));return child;}
async function execute(exe,args,profile){const child=launch(exe,args,profile);return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve(code):reject(Error(basename(exe)+' exited '+code)));});}
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function connect(port){
  const target=await until(async()=>{const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();return pages.find(p=>p.type==='page'&&p.url.startsWith('file:'));},'renderer');
  const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const v=JSON.parse(event.data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}}});
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Renderer closed'));}pending.clear();});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const seq=++id;const timer=setTimeout(()=>{pending.delete(seq);reject(Error(method+' timed out'));},120000);pending.set(seq,{resolve,reject,timer});ws.send(JSON.stringify({id:seq,method,params}));});
  const evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
  const call=async(method,...args)=>{const result=await evaluate(`window.studio[${JSON.stringify(method)}](...${JSON.stringify(args)})`);assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;};
  await until(()=>evaluate('Boolean(window.studio)'),'preload');
  return {call,evaluate,send,close:()=>ws.close()};
}
async function api(profile,path){const c=json(join(profile,'connection.json'));const r=await fetch(c.apiUrl+path,{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(2500)});assert.equal(r.status,200);const result=await r.json();assert.equal(result.ok,true);return result.value;}
function contents(directory){const db=new DB(join(directory,'library.sqlite'),{readonly:true,fileMustExist:true});try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_backup_*' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]);}finally{db.close();}}
function images(directory){return readdirSync(join(directory,'media')).map(name=>[name,hash(readFileSync(join(directory,'media',name)))]);}
const source=join(project,'.local-data'),sourceContents=contents(source),sourceImages=images(source);
async function copyLibrary(profile){const directory=join(profile,'library');mkdirSync(join(directory,'media'),{recursive:true});const db=new DB(join(source,'library.sqlite'),{readonly:true,fileMustExist:true});try{await db.backup(join(directory,'library.sqlite'));}finally{db.close();}for(const [name] of sourceImages)copyFileSync(join(source,'media',name),join(directory,'media',name));}
async function stopAcceptance(){
  // A distinct executable name is used only by the fixtures built for this script.
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-Process -Name WanxiangUpgradeAcceptance -ErrorAction SilentlyContinue | Stop-Process -Force"],{windowsHide:true,stdio:'ignore'});
  await new Promise(r=>child.once('exit',r));
}

const served=[];
const feed=createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname.slice(1));
  if(name!==basename(name)||name.endsWith('.blockmap')){res.writeHead(404);res.end();return;}
  const file=join(fixtures,'0.1.1',name);if(!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return;}
  served.push(name);res.writeHead(200,{'Content-Length':statSync(file).size});createReadStream(file).pipe(res);
});
await new Promise(r=>feed.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+feed.address().port+'/';
try{
  log('Checking delivered portable folder ZIP');
  const released=extract(join(project,'release/windows/WanxiangWorkshop-0.1.0-win-x64-Portable.zip'),join(run,'release-smoke'));
  assert.equal(existsSync(join(released,'data')),false,'ZIP must not ship user data');
  const smoke=join(released,'data'),releasePort=await freePort(),release=join(released,'万象工坊.exe');
  const releaseProcess=launch(release,['--remote-debugging-port='+releasePort],smoke),releasePage=await connect(releasePort);
  const state=await releasePage.call('getUpdateStatus');assert.equal(state.currentVersion,'0.1.0');assert.equal(state.edition,'portable');assert.equal(state.phase,'unconfigured');
  assert.equal((await releasePage.call('getDesktopStatus')).dataDirectory,smoke);assert.ok(existsSync(join(smoke,'library/library.sqlite')));
  const empty=await releasePage.call('snapshot');assert.equal(empty.works.length,1);assert.equal(empty.characters.length,0);assert.equal(empty.media.length,0);
  await releasePage.call('completeOnboarding');await releasePage.send('Page.reload');
  await until(()=>releasePage.evaluate('document.body.innerText.length>100'),'rendered interface');
  writeFileSync(join(run,'release-portable.png'),Buffer.from((await releasePage.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  copyFileSync(join(run,'release-portable.png'),join(project,'test-results/layout-portable.png'));
  report.deliveredPortable={version:state.currentVersion,edition:state.edition,freshWorks:1,characters:0,images:0,interfaceRendered:true};
  await releasePage.call('quitApplication').catch(()=>{});releasePage.close();await until(()=>releaseProcess.exitCode!==null,'portable exit');
  log('Delivered portable starts with a clean library and exits normally');

  for(const edition of ['installed','portable']){
    const install=join(run,'installed-app'),portableDir=join(run,"免安装 ' 验收");
    const program=edition==='installed'?install:join(portableDir,'WanxiangWorkshop'),profile=join(program,'data'),directory=join(profile,'library');
    mkdirSync(profile,{recursive:true});
    let executable;
    if(edition==='installed'){
      log('Installing isolated NSIS 0.1.0 into chosen directory');
      await execute(join(fixtures,'0.1.0/WanxiangWorkshop-0.1.0-win-x64-Setup.exe'),['/S','/currentuser','/D='+install],profile);
      executable=join(install,'WanxiangUpgradeAcceptance.exe');assert.ok(existsSync(executable));
    }else{extract(join(fixtures,'0.1.0/WanxiangWorkshop-0.1.0-win-x64-Portable.zip'),portableDir);executable=join(program,'WanxiangUpgradeAcceptance.exe');}
    await copyLibrary(profile);
    const oldExecutableHash=hash(readFileSync(executable)),port=await freePort();launch(executable,['--remote-debugging-port='+port],profile);
    const page=await connect(port),status=await page.call('getUpdateStatus');assert.equal(status.currentVersion,'0.1.0');assert.equal(status.edition,edition);
    assert.equal((await page.call('getDesktopStatus')).dataDirectory,profile);
    const snapshot=await page.call('snapshot'),work=snapshot.works[0];
    await page.call('saveWork',{id:work.id,name:'真实升级验收 '+edition,expectedVersion:work.version});
    const before=contents(directory),beforeImages=images(directory),oldInstance=json(join(profile,'connection.json')).instanceId;
    assert.deepEqual(beforeImages,sourceImages);
    await page.call('saveUpdateSettings',{url,checkOnStartup:false});
    const available=await page.call('checkForUpdates');assert.equal(available.phase,'available',available.error);assert.equal(available.availableVersion,'0.1.1');
    const downloaded=await page.call('downloadUpdate');assert.equal(downloaded.phase,'downloaded',downloaded.error);assert.equal(downloaded.progress,100);
    log(edition+': verified download complete; triggering real restart and update');
    await page.call('installUpdate').catch(e=>{if(!/closed/.test(e.message))throw e;});page.close();
    await until(async()=>{if(json(join(directory,'library-state.json')).appVersion!=='0.1.1')return false;const health=await api(profile,'/health');return health.instanceId!==oldInstance;},edition+' restart on 0.1.1',180000);
    const after=await api(profile,'/snapshot');assert.ok(after.works.some(w=>w.name==='真实升级验收 '+edition));
    assert.deepEqual(contents(directory),before);assert.deepEqual(images(directory),beforeImages);
    const points=listProtectionPoints(directory);assert.ok(points.some(p=>p.appVersion==='0.1.0'&&p.targetVersion==='0.1.1'));
    for(const point of points)await verifyProtectionPoint(directory,point.id);
    const result={from:'0.1.0',to:'0.1.1',downloadVerified:true,automaticRestart:true,tableCount:before.length,imageCount:beforeImages.length,dataUnchanged:true,protectionPointsVerified:points.length};
    if(edition==='portable'){
      const expected=join(extracted['0.1.1'],'WanxiangUpgradeAcceptance.exe');assert.equal(hash(readFileSync(executable)),hash(readFileSync(expected)));
      const updateResult=json(join(profile,'update-cache/portable-result.json'));assert.equal(updateResult.ok,true);assert.equal(hash(readFileSync(join(updateResult.backup,'WanxiangUpgradeAcceptance.exe'))),oldExecutableHash);
      result.originalExecutablePreserved=true;result.specialCharacterPath=true;result.dataBesideProgram=true;
    }else{assert.equal(json(join(install,'resources/app/package.json')).version,'0.1.1');result.chosenInstallDirectory=true;}
    await stopAcceptance();
    if(edition==='portable'){
      const moved=join(run,'移动后文件夹');
      assert.ok(program.startsWith(run+'\\')&&moved.startsWith(run+'\\'));
      await until(async()=>{await rename(program,moved);return true;},'portable folder move');
      const movedProfile=join(moved,'data'),movedPort=await freePort();
      const movedProcess=launch(join(moved,'WanxiangUpgradeAcceptance.exe'),['--remote-debugging-port='+movedPort],movedProfile),movedPage=await connect(movedPort);
      assert.equal((await movedPage.call('getDesktopStatus')).dataDirectory,movedProfile);
      assert.deepEqual(contents(join(movedProfile,'library')),before);assert.deepEqual(images(join(movedProfile,'library')),beforeImages);
      await movedPage.call('quitApplication').catch(()=>{});movedPage.close();await until(()=>movedProcess.exitCode!==null,'moved app exit');result.folderMovePreservedData=true;
    }
    if(edition==='installed'){
      const uninstaller=readdirSync(install).find(n=>/^Uninstall.*\.exe$/.test(n));assert.ok(uninstaller);
      await execute(join(install,uninstaller),['/S','/currentuser'],profile);
      await until(()=>!existsSync(executable),'uninstall');assert.deepEqual(contents(directory),before);assert.deepEqual(images(directory),beforeImages);result.uninstallPreservedData=true;
      // NSIS relaunches its uninstaller from TEMP; the outer process may exit first.
      await until(()=>{const names=readdirSync(install);return names.length===1&&names[0]==='data';},'uninstaller completes program cleanup');result.dataBesideProgram=true;
    }
    report[edition]=result;writeFileSync(join(run,'report.json'),JSON.stringify(report,null,2));log(edition+': real 0.1.0 to 0.1.1 update passed');
  }
  assert.deepEqual(contents(source),sourceContents);assert.deepEqual(images(source),sourceImages);
  report.sourceContentUnchanged=true;report.servedFiles=[...new Set(served)];report.success=true;
  writeFileSync(join(run,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(project,'test-results/packaged-update-report.json'),JSON.stringify(report,null,2));
  log('All packaged update acceptance checks passed');
}catch(error){report.error=error.stack;writeFileSync(join(run,'report.json'),JSON.stringify(report,null,2));throw error;}
finally{
  feed.closeAllConnections();feed.close();await stopAcceptance();
  if(report.success){
    const expected=join(project,'test-results','packaged-update-acceptance');
    if(fixtures!==expected||lstatSync(fixtures).isSymbolicLink()||realpathSync(fixtures).toLowerCase()!==expected.toLowerCase())throw Error('Unsafe acceptance cleanup path');
    await rm(fixtures,{recursive:true,force:true,maxRetries:10,retryDelay:300});
    report.generatedFixturesCleaned=true;writeFileSync(join(project,'test-results/packaged-update-report.json'),JSON.stringify(report,null,2));
    log('Generated acceptance packages and extracted folders cleaned');
  }
}
