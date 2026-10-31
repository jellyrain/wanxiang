// Exercise the delivered desktop UI with disposable, program-local data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const project=resolve(import.meta.dirname,'..'),output=join(project,'test-results');
const run=mkdtempSync(join(output,'settings-ui-')),report={checks:[],screenshots:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=message=>console.log(new Date().toISOString()+' '+message);
const check=(condition,label)=>{assert.ok(condition,label);report.checks.push(label);log(label);};
async function until(action,label,timeout=30000){let last;for(const end=Date.now()+timeout;Date.now()<end;){try{const value=await action();if(value)return value;}catch(e){last=e;}await sleep(150);}throw Error(label+': '+(last?.message??'timed out'));}
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const seven=await builder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
const extract=spawnSync(seven,['x','-y','-o'+run,join(project,'release/windows/WanxiangWorkshop-0.1.0-win-x64-Portable.zip')],{windowsHide:true,encoding:'utf8'});
assert.equal(extract.status,0,extract.stderr);
const program=join(run,'WanxiangWorkshop'),data=join(program,'data'),cache=join(data,'update-cache/p-ui');
mkdirSync(join(cache,'previous'),{recursive:true});writeFileSync(join(cache,'update.zip'),Buffer.alloc(1024*1024));writeFileSync(join(cache,'previous/app.exe'),'protected previous program');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env,WANXIANG_HTTP_PORT:'0'};for(const key of ['ELECTRON_RUN_AS_NODE','WANXIANG_DEV_URL','OC_STUDIO_DEV_URL','PORTABLE_EXECUTABLE_FILE','PORTABLE_EXECUTABLE_DIR'])delete env[key];
const processLog=[];
const child=spawn(join(program,'万象工坊.exe'),['--remote-debugging-port='+port],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',v=>processLog.push(String(v)));child.stderr.on('data',v=>processLog.push(String(v)));
let ws,send,evaluate,call;
try{
  const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();return pages.find(p=>p.type==='page'&&p.url.startsWith('file:'));},'renderer',60000);
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  const pending=new Map();let sequence=0;
  ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}}});
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Renderer closed'));}pending.clear();});
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
  call=async(method,...args)=>{const r=await evaluate(`window.studio[${JSON.stringify(method)}](...${JSON.stringify(args)})`);assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
  const click=async(label,selector='button')=>{const point=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&(e.textContent.trim()===${JSON.stringify(label)}||e.querySelector('strong')?.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e||e.disabled)return false;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`),'click '+label);await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await sleep(180);if(selector==='[role=tab]')assert.equal(await activeTab(),label);};
  const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(120);};
  const screenshot=async name=>{await sleep(350);const path=join(output,'settings-'+name+'.png');writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));report.screenshots.push(path);};
  const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);};
  const activeTab=()=>evaluate(`document.querySelector('.settings-nav [data-state=active]')?.textContent.trim()`);
  const overflow=async label=>{const details=await evaluate(`(()=>{const e=document.querySelector('.settings-panel[data-state=active]');return {width:innerWidth,document:document.documentElement.scrollWidth,panel:e?.clientWidth,content:e?.scrollWidth};})()`);check(details.document<=details.width+1&&details.content<=details.panel+1,label+' has no horizontal overflow: '+JSON.stringify(details));};
  await until(()=>evaluate('Boolean(document.querySelector(".getting-started"))'),'first launch guide');
  await viewport(1440,810);await screenshot('welcome');
  check(!(await call('getDesktopStatus')).onboardingComplete,'Fresh profile opens onboarding');
  await click('新建作品','.welcome-choices button');
  await input('input[placeholder="作品名称"]','布局验收作品');await input('input[placeholder="世界名称"]','布局验收世界');await click('开始创作');
  await until(()=>evaluate('!document.querySelector("[role=dialog]")'),'new work closes guide');
  const snapshot=await call('snapshot');check(snapshot.works.length===1&&snapshot.works[0].name==='布局验收作品'&&snapshot.worlds[0].name==='布局验收世界','New work reuses the blank starter without duplication');
  check((await call('getDesktopStatus')).onboardingComplete,'Onboarding completion is persisted');
  await send('Page.reload');await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'reload UI');await sleep(500);
  check(!await evaluate('Boolean(document.querySelector(".getting-started"))'),'Completed guide stays closed after reload');
  await click('软件设置');await until(()=>evaluate('Boolean(document.querySelector(".settings-data-path code")?.textContent.includes("settings-ui-"))'),'settings data status');
  check(await activeTab()==='通用','General is the default settings tab');
  check(await evaluate('document.querySelectorAll(".settings-nav [role=tab]").length===4'),'Settings has four categories');
  check((await call('getDesktopStatus')).dataDirectory===data,'Data folder points to this portable program');
  await call('openDataDirectory');report.checks.push('Data directory opens successfully');
  await screenshot('general');await overflow('Wide general');
  await click('备份与恢复','[role=tab]');await until(()=>evaluate('Boolean(document.querySelector("input[aria-label=备份保存目录]"))'),'backup loaded');
  const backupSelector='input[aria-label="备份保存目录"]',originalDirectory=await evaluate(`document.querySelector(${JSON.stringify(backupSelector)}).value`);
  await input(backupSelector,join(data,'draft-not-saved'));await click('连接','[role=tab]');await screenshot('connection');await overflow('Wide connection');
  await click('备份与恢复','[role=tab]');check(await evaluate(`document.querySelector(${JSON.stringify(backupSelector)}).value`)===join(data,'draft-not-saved'),'Backup draft survives category switches');
  await click('创作概览');await until(()=>evaluate('Boolean(document.querySelector("[role=alertdialog]"))'),'unsaved guard');
  check(true,'Leaving settings protects unsaved input');await click('继续编辑');await input(backupSelector,originalDirectory);await screenshot('backup');
  await click('更新','[role=tab]');await until(()=>evaluate('!document.querySelector("input[aria-label=更新源地址]").disabled'),'update loaded');
  await input('input[aria-label="更新源地址"]','http://127.0.0.1:9/test-only/');await click('通用','[role=tab]');await click('更新','[role=tab]');
  check(await evaluate('document.querySelector("input[aria-label=更新源地址]").value')==='http://127.0.0.1:9/test-only/','Update draft survives category switches');await input('input[aria-label="更新源地址"]','');
  check((await call('getUpdateCache')).bytes===1024*1024,'Download cache size excludes previous program backup');await click('清理下载缓存');
  await until(()=>!existsSync(join(cache,'update.zip')),'cache removed');check(readFileSync(join(cache,'previous/app.exe'),'utf8')==='protected previous program'&&existsSync(join(data,'library/library.sqlite')),'Cache cleanup preserves previous program and library');await screenshot('update');
  await click('通用','[role=tab]');await click('新建或导入作品');await click('导入已有资料','.welcome-choices button');
  check(await evaluate('document.querySelector(".transfer-tabs [aria-selected=true]")?.textContent')==='导入文件','Import onboarding opens the import tab');await screenshot('import');await click('关闭导入导出');await click('先看看');
  // Check narrow windows in both dark and light themes using the actual theme control.
  await viewport(960,720);for(const tab of ['通用','备份与恢复','连接','更新']){await click(tab,'[role=tab]');await overflow('960px '+tab);await screenshot('narrow-'+({'通用':'general','备份与恢复':'backup','连接':'connection','更新':'update'}[tab]));}
  await click('主题');await evaluate(`[...document.querySelectorAll('.theme-option')].find(e=>e.textContent.includes('月白')).click()`);await sleep(300);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await click('通用','[role=tab]');await screenshot('light-general');await overflow('Light general');
  await viewport(1280,800);await screenshot('light-wide');
  await click('作品设置');await until(()=>evaluate('Boolean(document.querySelector(".work-settings"))'),'work settings');
  const icon=await evaluate(`(()=>{const b=[...document.querySelectorAll('.sidebar button')].find(e=>e.textContent.trim()==='作品设置');return b?.querySelector('svg')?.outerHTML;})()`);check(icon&&icon.includes('M4 3v6'),'Work settings displays sliders, not a single dot');await screenshot('work');
  report.success=true;
}catch(e){report.error=e.stack;throw e;}
finally{
  writeFileSync(join(output,'settings-ui-report.json'),JSON.stringify(report,null,2));writeFileSync(join(output,'settings-ui-process.log'),processLog.join(''));
  if(call){await call('completeOnboarding').catch(()=>{});await evaluate(`document.querySelectorAll('[role=dialog] button,[role=alertdialog] button').forEach(e=>{if(e.textContent.trim()==='取消'||e.textContent.trim()==='先看看')e.click();});`).catch(()=>{});await call('quitApplication').catch(()=>{});}
  ws?.close();await until(()=>child.exitCode!==null,'desktop exit',10000).catch(()=>{child.kill();});
  if(report.success){if(!run.startsWith(output+'\\settings-ui-')||lstatSync(run).isSymbolicLink()||realpathSync(run).toLowerCase()!==run.toLowerCase())throw Error('Unsafe test cleanup path');await rm(run,{recursive:true,force:true,maxRetries:10,retryDelay:300});log('Disposable app and data removed; screenshots and report retained');}
}
