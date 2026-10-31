// Exercise the delivered desktop UI with disposable, program-local data.
import assert from 'node:assert/strict';
import {electronExecutable} from './electron-path.mjs';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {rm,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const project=resolve(import.meta.dirname,'..'),output=join(project,'test-results'),packaged=process.argv.includes('--packaged');
const run=mkdtempSync(join(output,'about-ui-')),report={checks:[],screenshots:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=message=>console.log(new Date().toISOString()+' '+message);
const check=(condition,label)=>{assert.ok(condition,label);report.checks.push(label);log(label);};
async function until(action,label,timeout=30000){let last;for(const end=Date.now()+timeout;Date.now()<end;){try{const value=await action();if(value)return value;}catch(e){last=e;}await sleep(150);}throw Error(label+': '+(last?.message??'timed out'));}
let program=project;
if(packaged){const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder')),seven=await builder('app-builder-lib/out/toolsets/7zip.js').getPath7za();const extracted=spawnSync(seven,['x','-y','-o'+run,join(project,'release/windows/WanxiangWorkshop-'+JSON.parse(readFileSync(join(project,'package.json'),'utf8')).version+'-win-x64-Portable.zip')],{windowsHide:true,encoding:'utf8'});assert.equal(extracted.status,0);program=join(run,'WanxiangWorkshop');}
const data=join(packaged?program:run,'data');mkdirSync(data,{recursive:true});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env,WANXIANG_HTTP_PORT:'0'};for(const key of ['ELECTRON_RUN_AS_NODE','WANXIANG_DEV_URL','OC_STUDIO_DEV_URL','PORTABLE_EXECUTABLE_FILE','PORTABLE_EXECUTABLE_DIR'])delete env[key];
const processLog=[];
env.WANXIANG_USER_DATA_DIR=data;env.WANXIANG_DATA_DIR=join(data,'library');
function launch(){const p=spawn(packaged?join(program,'万象工坊.exe'):electronExecutable(),[...(packaged?[]:[project]),'--remote-debugging-port='+port],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',v=>processLog.push(String(v)));p.stderr.on('data',v=>processLog.push(String(v)));return p;}
let child=launch();
let ws,send,evaluate,call;
async function connect(debugPort=port){
  const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();return pages.find(p=>p.type==='page'&&p.url!=='about:blank');},'renderer',60000);
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  const pending=new Map();let sequence=0;
  ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}}});
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Renderer closed'));}pending.clear();});
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
  call=async(method,...args)=>{const r=await evaluate(`window.studio[${JSON.stringify(method)}](...${JSON.stringify(args)})`);assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
}
try{
  await connect();
  const reload=async()=>{await send('Page.enable');const loaded=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.removeEventListener('message',listener);reject(Error('reload timed out'));},15000);const listener=e=>{if(JSON.parse(e.data).method==='Page.loadEventFired'){clearTimeout(timeout);ws.removeEventListener('message',listener);resolve();}};ws.addEventListener('message',listener);});await send('Page.reload');await loaded;await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'reloaded interface');};
  const click=async(label,selector='button')=>{const point=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&(e.innerText?.trim()===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)}||e.querySelector('strong')?.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e||e.disabled)return false;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`),'click '+label);await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await sleep(180);};
  const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(120);};
  const screenshot=async name=>{await sleep(350);const path=join(output,(packaged?'about-release-':'about-')+name+'.png');writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));report.screenshots.push(path);};
  const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);};
  const activeTab=()=>evaluate(`document.querySelector('.settings-nav [data-state=active]')?.textContent.trim()`);
  const overflow=async label=>{const details=await evaluate(`(()=>{const e=document.querySelector('.settings-panel[data-state=active]');return {width:innerWidth,document:document.documentElement.scrollWidth,panel:e?.clientWidth,content:e?.scrollWidth};})()`);check(details.document<=details.width+1&&details.content<=details.panel+1,label+' has no horizontal overflow: '+JSON.stringify(details));};
  await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'initial interface');
  if(packaged){await call('completeOnboarding');await reload();}

  await call('completeOnboarding');await reload();await viewport(1440,810);

  const expectedVersion=JSON.parse(readFileSync(join(project,'package.json'),'utf8')).version;
  const verifyAbout=async(label)=>{
    await click('软件设置');await click('关于','[role=tab]');
    check(await activeTab()==='关于',label+' About tab selected');
    check(await evaluate('document.querySelector("[aria-label=软件版本]")?.textContent')==='版本 '+expectedVersion,label+' version matches package');
    check(await evaluate('document.querySelector(".about-settings").textContent.includes("软件说明")&&document.querySelector(".about-settings").textContent.includes("本次更新")&&document.querySelector(".about-settings").textContent.includes("Markdown")'),label+' description and release notes visible');
    await overflow(label+' wide');await screenshot(label+'-wide');
    await viewport(820,640);await overflow(label+' narrow');await screenshot(label+'-narrow');await viewport(1440,810);
    await click('通用','[role=tab]');check(await activeTab()==='通用',label+' can return to general settings');await click('关于','[role=tab]');
  };
  await verifyAbout('desktop');
  check((await call('getDesktopStatus')).version===expectedVersion,'About version matches running desktop');
  await call('setTheme','paper');await reload();await click('软件设置');await click('关于','[role=tab]');await screenshot('desktop-paper');
  const desktop={ws,send,evaluate,call};let chrome;
  try{
    const connection=await call('getConnectionInfo');
    const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const browserPort=listener.address().port;await new Promise(r=>listener.close(r));
    chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port='+browserPort,'--user-data-dir='+join(run,'browser-profile'),'--no-first-run','--no-default-browser-check',connection.baseUrl],{windowsHide:true,stdio:'ignore'});
    await connect(browserPort);await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'browser connection');await viewport(1440,810);
    await verifyAbout('browser');check(await evaluate('document.querySelector(".about-badges").textContent.includes("浏览器端")'),'Browser edition label');
  }finally{if(chrome){await send('Browser.close').catch(()=>{});ws?.close();await until(()=>chrome.exitCode!==null,'browser exit',10000).catch(()=>chrome.kill());}({ws,send,evaluate,call}=desktop);}
  report.success=true;
}catch(e){report.error=e.stack;if(evaluate){report.screen=await evaluate('({theme:document.documentElement.dataset.theme,text:document.body.innerText.slice(-3500)})').catch(()=>null);writeFileSync(join(output,'about-failure.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}throw e;}
finally{
  writeFileSync(join(output,packaged?'about-packaged-report.json':'about-ui-report.json'),JSON.stringify(report,null,2));writeFileSync(join(output,'about-ui-process.log'),processLog.join(''));
  if(call){await evaluate(`document.querySelectorAll('[role=dialog] button,[role=alertdialog] button').forEach(e=>{if(['关闭外观设置','关闭编辑'].includes(e.getAttribute('aria-label'))||['继续编辑','取消'].includes(e.textContent.trim()))e.click();});`).catch(()=>{});await call('quitApplication').catch(()=>{});}
  ws?.close();await until(()=>child.exitCode!==null,'desktop exit',10000).catch(()=>{child.kill();});
  if(report.success){if(!run.startsWith(output+'\\about-ui-')||lstatSync(run).isSymbolicLink()||realpathSync(run).toLowerCase()!==run.toLowerCase())throw Error('Unsafe test cleanup path');await rm(run,{recursive:true,force:true,maxRetries:10,retryDelay:300});log('Disposable profile removed; screenshots retained');}
}
