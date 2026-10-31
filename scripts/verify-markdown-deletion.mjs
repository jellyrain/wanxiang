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
const run=mkdtempSync(join(output,'markdown-deletion-ui-')),report={checks:[],screenshots:[]};
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
  const screenshot=async name=>{await sleep(350);const path=join(output,(packaged?'markdown-deletion-release-':'markdown-deletion-')+name+'.png');writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));report.screenshots.push(path);};
  const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);};
  const activeTab=()=>evaluate(`document.querySelector('.settings-nav [data-state=active]')?.textContent.trim()`);
  const overflow=async label=>{const details=await evaluate(`(()=>{const e=document.querySelector('.settings-panel[data-state=active]');return {width:innerWidth,document:document.documentElement.scrollWidth,panel:e?.clientWidth,content:e?.scrollWidth};})()`);check(details.document<=details.width+1&&details.content<=details.panel+1,label+' has no horizontal overflow: '+JSON.stringify(details));};
  await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'initial interface');
  if(packaged){await call('completeOnboarding');await reload();}

  await call('completeOnboarding');await reload();await viewport(1440,810);
  const work=await call('createWork',{name:'Markdown 与删除验收',world:{kind:'new',name:'验收世界',description:'# 世界简介\n\n**Markdown** 说明'}});
  const body='# 第一幕\n\n**加粗**与*斜体*，保留换行。\n下一行。\n\n> 引用说明\n\n- 人物出场\n- [x] 已完成\n\n| 人物 | 状态 |\n| --- | --- |\n| 主角 | 出场 |\n\n'+'```js\n<script>alert(1)</script>\n```'+'\n\n[链接](https://example.com)\n<script>window.mdUnsafe=true</script>';
  const chapter=await call('saveChapter',{workId:work.id,expectedVersion:0,expectedOutlineVersion:0,volumeId:null,name:'渲染验收',summary:'## 梗概\n\n**冲突开始**',body,notes:'- 伏笔一',status:'draft',participants:[],events:[],entryIds:[],mapProgress:[]});
  await call('selectWork',work.id);await reload();await click('剧情与章节');await click('阅读章节 渲染验收');
  check(await evaluate('Boolean(document.querySelector(".chapter-prose h1")&&document.querySelector(".chapter-prose table")&&document.querySelector(".chapter-prose strong")&&document.querySelector(".chapter-prose blockquote"))'),'Saved Markdown renders headings, tables, emphasis and quotes');
  check(await evaluate('!window.mdUnsafe&&!document.querySelector(".markdown-body script")'),'Raw HTML is inert');await screenshot('reading');
  await click('编辑章节');await click('Markdown 预览','[role=tab]');check(await evaluate('Boolean(document.querySelector(".chapter-preview h1"))'),'Editor preview renders draft');await click('取消');
  check((await call('snapshot')).chapters.find(c=>c.id===chapter.id).body===body,'Preview preserves Markdown source');
  await click('作品设置');await click('删除作品 Markdown 与删除验收');await click('预览删除范围');
  check(await evaluate('document.querySelector(".deletion-preview").textContent.includes("渲染验收")'),'Deletion preview includes owned chapter');
  check(await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent=== "永久删除").disabled'),'Deletion requires exact name');await screenshot('confirmation');
  await input('[aria-label="确认删除资料名称"]',work.name);await click('永久删除');
  await until(async()=>!(await call('snapshot')).works.some(w=>w.id===work.id),'work deleted');
  check(!(await call('snapshot')).chapters.some(c=>c.id===chapter.id),'Desktop deletion removes chapters');
  for(const w of (await call('snapshot')).works){const p=await call('previewDeletion',{kind:'work',id:w.id});await call('deleteContent',{token:p.token,name:p.target.name});}
  await reload();await until(()=>evaluate('Boolean(document.querySelector(".work-settings"))'),'empty shelf ready');check(await evaluate('document.body.innerText.includes("暂无作品")&&document.body.innerText.includes("新建作品")'),'Empty library remains usable');await screenshot('empty-library');
  await call('quitApplication');ws.close();await until(()=>child.exitCode!==null,'restart after empty library');child=launch();await connect();await until(()=>evaluate('Boolean(document.querySelector(".work-settings"))'),'empty shelf after restart');check((await call('snapshot')).works.length===0,'Restart keeps the library empty');
  await click('新建作品');await input('input[placeholder="输入小说或故事的名称"]','删除后新建');await input('input[placeholder="例如：群岛世界"]','新世界');await click('创建作品');
  await until(async()=>(await call('snapshot')).works.some(w=>w.name==='删除后新建'),'create from empty library');check(true,'Create a new work after deleting last work');
  await click('删除资料');await click('关闭删除资料');

  const desktop={ws,send,evaluate,call};let chrome;
  try{
    const connection=await call('getConnectionInfo');
    const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const browserPort=listener.address().port;await new Promise(r=>listener.close(r));
    chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port='+browserPort,'--user-data-dir='+join(run,'browser-profile'),'--no-first-run','--no-default-browser-check',connection.baseUrl],{windowsHide:true,stdio:'ignore'});
    await connect(browserPort);await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'browser connection');await viewport(1280,800);
    const browserWork=await call('createWork',{name:'浏览器删除验收',world:{kind:'existing',id:work.worldId}});
    await call('saveChapter',{workId:browserWork.id,expectedVersion:0,expectedOutlineVersion:0,volumeId:null,name:'网页正文',summary:'',body,notes:'',status:'draft',participants:[],events:[],entryIds:[],mapProgress:[]});
    await call('selectWork',browserWork.id);await reload();await click('剧情与章节');await click('阅读章节 网页正文');check(await evaluate('Boolean(document.querySelector(".chapter-prose table"))'),'Browser Markdown renders through HTTP runtime');await screenshot('browser-reading');
    await click('作品设置');await click('删除作品 浏览器删除验收');await click('预览删除范围');await input('[aria-label="确认删除资料名称"]',browserWork.name);await click('永久删除');
    await until(async()=>!(await call('snapshot')).works.some(w=>w.id===browserWork.id),'browser deletion');check(true,'Browser confirms permanent deletion through HTTP runtime');
  }finally{if(chrome){await send('Browser.close').catch(()=>{});ws?.close();await until(()=>chrome.exitCode!==null,'browser exit',10000).catch(()=>chrome.kill());}({ws,send,evaluate,call}=desktop);}
  report.success=true;

}catch(e){report.error=e.stack;if(evaluate){report.screen=await evaluate('({theme:document.documentElement.dataset.theme,text:document.body.innerText.slice(-3500)})').catch(()=>null);writeFileSync(join(output,'markdown-deletion-failure.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}throw e;}
finally{
  writeFileSync(join(output,packaged?'markdown-deletion-packaged-report.json':'markdown-deletion-ui-report.json'),JSON.stringify(report,null,2));writeFileSync(join(output,'markdown-deletion-ui-process.log'),processLog.join(''));
  if(call){await evaluate(`document.querySelectorAll('[role=dialog] button,[role=alertdialog] button').forEach(e=>{if(['关闭外观设置','关闭编辑'].includes(e.getAttribute('aria-label'))||['继续编辑','取消'].includes(e.textContent.trim()))e.click();});`).catch(()=>{});await call('quitApplication').catch(()=>{});}
  ws?.close();await until(()=>child.exitCode!==null,'desktop exit',10000).catch(()=>{child.kill();});
  if(report.success){if(!run.startsWith(output+'\\markdown-deletion-ui-')||lstatSync(run).isSymbolicLink()||realpathSync(run).toLowerCase()!==run.toLowerCase())throw Error('Unsafe test cleanup path');await rm(run,{recursive:true,force:true,maxRetries:10,retryDelay:300});log('Disposable profile removed; screenshots retained');}
}
