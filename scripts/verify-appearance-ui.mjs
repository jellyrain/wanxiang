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
const run=mkdtempSync(join(output,'appearance-ui-')),report={checks:[],screenshots:[]};
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
  const click=async(label,selector='button')=>{const point=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&(e.innerText?.trim()===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)}||e.querySelector('strong')?.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e||e.disabled)return false;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`),'click '+label);await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await sleep(180);if(selector==='[role=tab]')assert.equal(await activeTab(),label);};
  const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(120);};
  const screenshot=async name=>{await sleep(350);const path=join(output,(packaged?'appearance-release-':'appearance-')+name+'.png');writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));report.screenshots.push(path);};
  const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);};
  const activeTab=()=>evaluate(`document.querySelector('.settings-nav [data-state=active]')?.textContent.trim()`);
  const overflow=async label=>{const details=await evaluate(`(()=>{const e=document.querySelector('.settings-panel[data-state=active]');return {width:innerWidth,document:document.documentElement.scrollWidth,panel:e?.clientWidth,content:e?.scrollWidth};})()`);check(details.document<=details.width+1&&details.content<=details.panel+1,label+' has no horizontal overflow: '+JSON.stringify(details));};
  await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'initial interface');
  await call('completeOnboarding');await reload();await viewport(1440,810);
  await click('主题');
  const settings=async()=>(await call('snapshot')).themePreferences;
  const choose=(label,group)=>click(label,'[role="group"][aria-label="'+group+'"] button');
  const mode=()=>evaluate('document.documentElement.dataset.colorMode');
  const emulate=value=>send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]});
  check(await activeTab()==='外观','Toolbar opens appearance settings');
  check(await evaluate('document.querySelectorAll(".palette-choice").length')===11,'Eleven palette previews');
  await emulate('dark');await until(async()=>await mode()==='dark','system dark');await screenshot('theme-dark');
  await emulate('light');await until(async()=>await mode()==='light','system light');await screenshot('theme-light');
  check((await settings()).mode==='system','System changes preserve saved mode');
  for(const [name,expected] of [['Latte','light'],['Frappé','dark'],['Macchiato','dark'],['Mocha','dark'],['Rosé Pine','dark'],['Rosé Pine Moon','dark'],['Rosé Pine Dawn','light'],['Nord','dark'],['Everforest 暗','dark'],['Everforest 亮','light']]){
    await click(name,'.palette-choice');check(await mode()===expected,name+' applies its own mode');
  }
  await click('默认','.palette-choice');await choose('深色','显示模式');await choose('纯黑（OLED）','深色强度');
  check(await evaluate('getComputedStyle(document.body).backgroundColor')==='rgb(0, 0, 0)','OLED black canvas');
  await choose('仅侧栏','应用范围');const mainAccent=await evaluate('document.documentElement.style.getPropertyValue("--gold")');
  await choose('翡翠','强调色');check(await evaluate('document.documentElement.style.getPropertyValue("--gold")')===mainAccent,'Sidebar accent keeps main accent');
  await choose('浅色面板','侧栏样式');await choose('紧凑','显示密度');
  await input('input[aria-label="页面背景颜色"]','#242229');
  await until(async()=>(await settings()).colors.background==='#242229','custom canvas');
  await click('恢复页面背景');check(!(await settings()).colors.background,'Color override cleared');
  await choose('圆润','圆角');await choose('衬线','界面字体');
  check((await settings()).radius==='round'&&(await settings()).font==='serif','Corners and font persist');
  await input('input[aria-label="界面缩放"]','115');await evaluate('document.querySelector(\'input[aria-label="界面缩放"]\').dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowRight",bubbles:true}))');
  await until(async()=>(await settings()).scale===115,'interface zoom saved');
  await viewport(820,640);await overflow('820px settings');await screenshot('theme-narrow');
  await viewport(1920,1080);await overflow('Maximized settings');
  await reload();await click('主题');check((await settings()).scope==='sidebar'&&(await settings()).density==='compact','Preferences survive reload');
  await viewport(1440,810);await click('恢复默认主题');
  await choose('渐变','背景类型');await click('森野','.gradient-options button');check(await evaluate('document.querySelector(".app-background").style.background.includes("gradient")'),'Gradient applied');
  await choose('纯色','背景类型');await input('input[aria-label="背景颜色"]','#313245');
  await until(()=>evaluate('document.querySelector(".app-background")?.style.background==="rgb(49, 50, 69)"'),'solid canvas');
  await choose('图片 / 视频','背景类型');
  const imageBase64=await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=1440;c.height=900;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,1440,900);g.addColorStop(0,'#7864ab');g.addColorStop(.5,'#ddb8d6');g.addColorStop(1,'#90bbd6');x.fillStyle=g;x.fillRect(0,0,1440,900);for(let i=0;i<24;i++){x.fillStyle=i%2?'#ffffff44':'#ffffff22';x.beginPath();x.arc((i*173)%1440,(i*113)%900,40+i*5,0,Math.PI*2);x.fill();}return c.toDataURL('image/png').split(',')[1];})()`);
  const imageFile=join(run,'wallpaper.png');writeFileSync(imageFile,Buffer.from(imageBase64,'base64'));
  async function chooseFile(file){await until(()=>evaluate('Boolean(document.querySelector(\'input[aria-label="选择背景文件"]:not(:disabled)\'))'),'background file input ready');const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[aria-label="选择背景文件"]'});await send('DOM.setFileInputFiles',{nodeId,files:[file]});}
  await chooseFile(imageFile);await until(()=>evaluate('Boolean(document.querySelector(".app-background img")?.complete)'),'wallpaper loaded');
  await until(()=>evaluate('!document.querySelector("input[aria-label=选择背景文件]").disabled'),'wallpaper saved');
  await input('input[aria-label="背景模糊"]','5');await input('input[aria-label="遮罩强度"]','25');await input('input[aria-label="面板不透明度"]','75');await screenshot('background-settings');await click('创作概览');await screenshot('sakura-background');
  await reload();await until(()=>evaluate('Boolean(document.querySelector(".app-background img")?.complete)'),'background restored');
  check(await evaluate('document.documentElement.style.getPropertyValue("--panel-opacity")')==='75%','Image and readability settings persist after reload');
  await click('主题');
  const invalid=join(run,'invalid.png');writeFileSync(invalid,'<html>not a wallpaper</html>');await chooseFile(invalid);await until(()=>evaluate('Boolean(document.querySelector(".appearance-settings [role=alert]"))'),'invalid file warning');check(await evaluate('Boolean(document.querySelector(".app-background img"))'),'Invalid file keeps the previous background');
  const videoBase64=await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#66518c';x.fillRect(0,0,320,180);const stream=c.captureStream(8),chunks=[],r=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const finished=new Promise(resolve=>r.onstop=resolve);r.ondataavailable=e=>chunks.push(e.data);r.start();for(let i=0;i<12;i++){x.fillStyle=i%2?'#8d74b9':'#a39ccb';x.fillRect(0,0,320,180);x.fillStyle='#eed5ed';x.beginPath();x.arc(25+i*22,90,22,0,Math.PI*2);x.fill();await new Promise(r=>setTimeout(r,140));}r.stop();await finished;stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:'video/webm'});return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});})()`);
  const videoFile=join(run,'motion.webm');writeFileSync(videoFile,Buffer.from(videoBase64,'base64'));await chooseFile(videoFile);
  await until(()=>evaluate('Boolean(document.querySelector(".app-background video")?.currentTime>0)'),'video playback');
  check(await evaluate('(()=>{const v=document.querySelector(".app-background video");return v.muted&&v.loop&&!v.paused;})()'),'Video plays muted and loops');
  await click('暂停背景视频','[role=checkbox]');await until(()=>evaluate('document.querySelector(".app-background video").paused'),'paused');await click('创作概览');
  await reload();await until(()=>evaluate('Boolean(document.querySelector(".app-background video"))'),'video restored');check(await evaluate('document.querySelector(".app-background video").paused'),'Video and pause preference persist after reload');
  await click('主题');await click('暂停背景视频','[role=checkbox]');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await until(()=>evaluate('document.querySelector(".app-background video").paused'),'reduced motion');check(true,'System reduced-motion preference pauses video');await send('Emulation.setEmulatedMedia',{features:[]});
  await click('显示背景','[role=checkbox]');await until(()=>evaluate('!document.querySelector(".app-background")'),'background disabled');await click('显示背景','[role=checkbox]');await until(()=>evaluate('Boolean(document.querySelector(".app-background"))'),'background reenabled');check(true,'Background can be disabled without deleting the file');
  await chooseFile(imageFile);await until(()=>evaluate('Boolean(document.querySelector(".app-background img")?.complete)'),'image replaced');await click('创作概览');
  const snap=await call('snapshot'),work=snap.works.find(w=>!w.archived),character=snap.characters.find(c=>c.worldId===work.worldId&&!c.archived);
  // Run every main section at desktop and narrow widths; preserve a screenshot for visual review.
  for(const width of [1440,960]){await viewport(width,width===1440?810:720);for(const [label,id] of [['创作概览','overview'],['角色图鉴','characters'],['世界档案','world'],['地图探索','maps'],['关系图谱','relations'],['历史年表','timeline'],['剧情与章节','chapters'],['素材画廊','gallery'],['作品设置','works'],['软件设置','settings']]){
    await click(label);await sleep(250);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),label+' overflow at '+width);await screenshot(id+'-'+width);
  }}check(true,'All ten sections fit 1440px and 960px with a background');
  await viewport(1440,810);await click('角色图鉴');
  if(character){await evaluate(`document.querySelector('.cast-card')?.click()`);await until(()=>evaluate('Boolean(document.querySelector(".journey-reading"))'),'character detail');await screenshot('character-detail');await viewport(960,720);await screenshot('character-detail-narrow');check(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Character details remain readable at narrow width');}
  await viewport(960,720);await click('剧情与章节');await click('新建章节');await input('input[aria-label="章节名称"]','外观验收章节');await input('textarea[aria-label="章节正文"]','窗外，樱色的天光落在书页上。\n她合上手中的档案，走向新的故事。');await screenshot('chapter-edit-narrow');
  await click('保存');await until(async()=>(await call('snapshot')).chapters.some(c=>c.name==='外观验收章节'),'chapter saved');check(true,'Chapter editor creates and saves text with background enabled');
  const exported=await call('exportTransfer',{format:'package',scope:'library'});check(!exported.content.includes('wallpaper.png')&&!exported.content.includes('motion.webm'),'Export excludes device background files');
  const browserServer=createServer();await new Promise(r=>browserServer.listen(0,'127.0.0.1',r));const browserPort=browserServer.address().port;await new Promise(r=>browserServer.close(r));
  const browserEntry=join(run,'browser.cjs'),browserData=join(run,'browser-data'),browserUrl=(await call('getConnectionInfo')).baseUrl;
  writeFileSync(browserEntry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(browserData)});app.whenReady().then(()=>{const w=new BrowserWindow({width:1440,height:810,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL(${JSON.stringify(browserUrl)});});app.on('window-all-closed',()=>app.quit());`);
  const browserProcess=spawn(electronExecutable(),[browserEntry,'--remote-debugging-port='+browserPort],{env,windowsHide:true,stdio:'ignore'}),desktopContext={ws,send,evaluate,call};
  try{
    await connect(browserPort);await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'web interface');check(await evaluate('document.documentElement.dataset.platform')==='web','Browser mode runs without desktop preload');
    check(!await evaluate('Boolean(document.querySelector(".app-background"))'),'Browser uses its own device background');
    await choose('深色','快速切换显示模式');
    await until(async()=>await mode()==='dark'&&(await desktopContext.evaluate('document.documentElement.dataset.colorMode'))==='dark','browser to desktop sync');
    check((await desktopContext.call('snapshot')).themePreferences.mode==='dark','Quick mode change synchronizes from browser to desktop');
    await evaluate(`document.querySelector('.theme-trigger').click()`);await choose('图片 / 视频','背景类型');await chooseFile(videoFile);await until(()=>evaluate('Boolean(document.querySelector(".app-background video")?.readyState>=2)'),'web video decoded');await until(()=>evaluate('!document.querySelector("input[aria-label=选择背景文件]").disabled'),'web media saved');await click('创作概览');await reload();await until(()=>evaluate('Boolean(document.querySelector(".app-background video"))'),'web wallpaper persisted');check(true,'Web background file loads and persists under the browser CSP');
  }finally{ws?.close();browserProcess.kill();await until(()=>browserProcess.exitCode!==null||browserProcess.signalCode!==null,'browser exit').catch(()=>{});({ws,send,evaluate,call}=desktopContext);}
  check(await evaluate('Boolean(document.querySelector(".app-background img"))'),'Browser background changes do not replace desktop wallpaper');
  await call('quitApplication').catch(()=>{});ws.close();await until(()=>child.exitCode!==null,'desktop shutdown');if(packaged){const moved=join(run,'搬移后的程序');await until(async()=>{await rename(program,moved);return true;},'move portable folder');program=moved;}child=launch();await connect();await until(()=>evaluate('Boolean(document.querySelector(".app-background img")?.complete)'),'background after restart');check(await evaluate('document.documentElement.style.getPropertyValue("--panel-opacity")')==='75%','Background survives a complete desktop restart');
  const beforeRestore=await call('snapshot'),estimate=await call('estimateBackup'),baseline=await call('createBackupBaseline',estimate);
  const imported=await call('previewTransferImport',exported);await call('importTransfer',{token:imported.token});check((await call('snapshot')).works.length>beforeRestore.works.length,'Exported creative library imports as independent copies');
  const restore=await call('previewBackupRestore',baseline.point.id);await call('restoreBackup',restore.token);await reload();check((await call('snapshot')).works.length===beforeRestore.works.length,'Backup restores the creative library after import');await until(()=>evaluate('Boolean(document.querySelector(".app-background img")?.complete)'),'background after restore');check(true,'Creative library restore preserves device appearance');
  await click('主题');await click('移除','.background-file-row button');await until(()=>evaluate('!document.querySelector(".app-background")'),'remove background');await click('创作概览');await reload();await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'reload after remove');await sleep(300);check(!await evaluate('Boolean(document.querySelector(".app-background"))'),'Removing background persists');
  report.success=true;
}catch(e){report.error=e.stack;if(evaluate){report.screen=await evaluate('({theme:document.documentElement.dataset.theme,text:document.body.innerText.slice(-3500)})').catch(()=>null);writeFileSync(join(output,'appearance-failure.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}throw e;}
finally{
  writeFileSync(join(output,packaged?'appearance-release-report.json':'appearance-ui-report.json'),JSON.stringify(report,null,2));writeFileSync(join(output,'appearance-ui-process.log'),processLog.join(''));
  if(call){await evaluate(`document.querySelectorAll('[role=dialog] button,[role=alertdialog] button').forEach(e=>{if(['关闭外观设置','关闭编辑'].includes(e.getAttribute('aria-label'))||['继续编辑','取消'].includes(e.textContent.trim()))e.click();});`).catch(()=>{});await call('quitApplication').catch(()=>{});}
  ws?.close();await until(()=>child.exitCode!==null,'desktop exit',10000).catch(()=>{child.kill();});
  if(report.success){if(!run.startsWith(output+'\\appearance-ui-')||lstatSync(run).isSymbolicLink()||realpathSync(run).toLowerCase()!==run.toLowerCase())throw Error('Unsafe test cleanup path');await rm(run,{recursive:true,force:true,maxRetries:10,retryDelay:300});log('Disposable profile removed; screenshots retained');}
}
