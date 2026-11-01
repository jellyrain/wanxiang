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
const run=mkdtempSync(join(output,'catalog-ui-')),report={checks:[],screenshots:[]};
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
  ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.method==='Page.javascriptDialogOpening'){void send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}}});
  ws.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Renderer closed'));}pending.clear();});
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const v=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
  call=async(method,...args)=>{const r=await evaluate(`window.studio[${JSON.stringify(method)}](...${JSON.stringify(args)})`);assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
}
try{
  await connect();
  const reload=async()=>{await send('Page.enable');const loaded=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.removeEventListener('message',listener);reject(Error('reload timed out'));},15000);const listener=e=>{if(JSON.parse(e.data).method==='Page.loadEventFired'){clearTimeout(timeout);ws.removeEventListener('message',listener);resolve();}};ws.addEventListener('message',listener);});await send('Page.reload');await loaded;await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'reloaded interface');};
  const click=async(label,selector='button')=>{const point=await until(()=>evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&(e.innerText?.trim()===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)}||e.querySelector('strong,h2')?.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!e||e.disabled)return false;if(e.classList.contains('nav-item')){e.click();return {clicked:true};}e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`),'click '+label);if(point.clicked){await sleep(180);return;}await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await sleep(180);};
  const input=async(selector,value)=>{await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(120);};
  const screenshot=async name=>{await sleep(350);const path=join(output,(packaged?'catalog-release-':'catalog-')+name+'.png');writeFileSync(path,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));report.screenshots.push(path);};
  const viewport=async(width,height)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(200);};
  const activeTab=()=>evaluate(`document.querySelector('.settings-nav [data-state=active]')?.textContent.trim()`);
  const overflow=async label=>{const details=await evaluate(`(()=>{const e=document.querySelector('.settings-panel[data-state=active]');return {width:innerWidth,document:document.documentElement.scrollWidth,panel:e?.clientWidth,content:e?.scrollWidth};})()`);check(details.document<=details.width+1&&details.content<=details.panel+1,label+' has no horizontal overflow: '+JSON.stringify(details));};
  await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'initial interface');
  if(packaged){await call('completeOnboarding');await reload();}

  await call('completeOnboarding');await reload();await viewport(1440,810);


  const work=await call('createWork',{name:'资料库 UI 验证',world:{kind:'new',name:'验证世界',description:''}});
  await call('selectWork',work.id);
  const character=await call('saveCharacter',{worldId:work.worldId,expectedVersion:0,name:'验证人物',caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null});
  const map=await call('saveMap',{worldId:work.worldId,expectedVersion:0,name:'验证地图',description:'',backgroundId:null,stages:[{id:'start',name:'开篇'}],locations:[{id:'well',name:'古井',kind:'场地',description:'',x:35,y:40,unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false}],terrain:[]});
  const info=await call('getConnectionInfo'),descriptor=JSON.parse(readFileSync(info.descriptorPath,'utf8'));
  const upload=async(file,name)=>{const response=await fetch(info.baseUrl+'/api/v1/assets?worldId='+work.worldId+'&name='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Bearer '+descriptor.token,'Content-Type':'application/octet-stream','X-Wanxiang-Generation':(await call('snapshot')).generation},body:readFileSync(join(project,'tests/fixtures/seed',file))});const r=await response.json();assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
  const portrait=await upload('gu.png','特写验证.png'),design=await upload('mo.png','设定验证.png');
  const media=(await call('snapshot')).media,portraitName=media.find(m=>m.id===portrait.id).name,designName=media.find(m=>m.id===design.id).name;
  const tag=await call('saveTag',{worldId:work.worldId,name:'共有标签',color:'#77a993',expectedVersion:0});
  const template=await call('saveAttributeTemplate',{worldId:work.worldId,name:'统一战力',dimensions:[{id:'power',name:'威力',min:0,max:100,unit:'',enabled:true}],makeDefault:true,expectedDefaultVersion:0,expectedVersion:0});
  const farWork=await call('createWork',{name:'远方作品',world:{kind:'new',name:'远方世界',description:''}});
  const farItem=await call('saveItem',{kind:'item',worldId:farWork.worldId,expectedVersion:0,name:'雪境明灯',aliases:'',summary:'跨作品全局搜索',body:'',pending:'',source:'',status:'draft',imageId:null,entryIds:[],itemType:'prop',rarity:'',effect:'',usage:'',cost:'',holders:[]});
  await call('selectWork',work.id);await reload();
  let config=(await call('snapshot')).libraryConfigs.find(c=>c.worldId===work.worldId);
  await call('saveLibraryConfig',{...config,expectedVersion:config.version,groups:Object.fromEntries(Object.entries(config.groups).map(([kind,g])=>[kind,{...g,templateId:template.id}]))});await reload();
  const option=async(label,text)=>{await click(label,'[role=combobox]');await click(text,'[role=option]');};
  const verifyCatalogs=async(label)=>{
    const defs=[['item','物品','物品库','items'],['technique','功法','功法库','techniques'],['place','地点','地点库','places']];
    for(const [kind,name,page,collection] of defs){
      await click(page);await until(()=>evaluate('document.querySelector(".catalog-page h1")?.textContent==='+JSON.stringify(page)),'catalog page ready');
      check(!await evaluate('Boolean(document.querySelector(".delete-library-button,.preview-tag"))'),label+' removed redundant controls');
      check(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),label+' '+name+' filters fit');
      await screenshot(label+'-'+kind+'-list');
      await click('资料配置','.page-actions button');await click(name,'[role=tab]');check(await evaluate('Boolean(document.querySelector(".config-sections"))'),label+' unified configuration');await screenshot(label+'-'+kind+'-configuration');await click('取消','.journey-dialog .editor-footer button');
      await click('新建'+name);
      check(await evaluate('document.querySelectorAll(".catalog-editor-dialog [role=tab]").length===3'),label+' '+name+' three definition editor sections');
      const metrics=await evaluate('(()=>{const p=document.querySelector(".catalog-editor-dialog .editor-panels"),r=p.getBoundingClientRect();return {width:p.clientWidth,scroll:p.scrollWidth,children:[...p.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>r.left+p.clientWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,style:e.getAttribute("style")})).slice(0,10)};})()');log(JSON.stringify(metrics));check(metrics.scroll<=metrics.width+1,label+' editor has no horizontal overflow');await screenshot(label+'-'+kind+'-editor');await viewport(820,640);check(await evaluate('(()=>{const p=document.querySelector(".catalog-editor-dialog .editor-panels"),d=document.querySelector(".catalog-editor-dialog");return p.scrollWidth<=p.clientWidth+1&&d.getBoundingClientRect().right<=innerWidth;})()'),label+' narrow editor no overflow');await screenshot(label+'-'+kind+'-editor-narrow');await viewport(1440,810);
      await input('input[aria-label="名称"]',label+name);
      await input('textarea[aria-label="摘要"]','可编辑、可保存的'+name);
      if(kind==='item'){await click('图片');await click('从素材库选择','.image-field:nth-child(1) button');await click('选择素材 '+portraitName);await click('使用这张图片');await click('从素材库选择','.image-field:nth-child(2) button');await click('选择素材 '+designName);await click('使用这张图片');await screenshot(label+'-item-images');await click('基础资料');}
      await click('新增类别');await input('input[aria-label="新类别名称"]',label+name+'类别');await click('添加类别');
      if(kind==='item'){await input('input[aria-label="查找或新建标签"]',label+'标签');await click('新增“'+label+'标签”');}else await click(label+'标签','label');
      await click('详细设定');await input('input[aria-label="属性 威力"]','70');await click('添加字段');await input('.fact-editor-row input','境界限制');await input('.fact-editor-row textarea','不超过统一战力');
      await input('textarea[aria-label="详细说明"]','# 专属资料\n\n**独立保存**\n\n- 设定与状态分开');
      await click('预览 Markdown');check(await evaluate('Boolean(document.querySelector(".catalog-preview h1"))'),label+' '+name+' markdown preview');await click('继续编辑');
      check(!await evaluate('document.querySelector(".catalog-editor-dialog").textContent.includes("人物与关联")'),label+' '+name+' definition editor has no owner picker');
      await click('保存');await until(()=>evaluate('!document.querySelector(".journey-dialog")&&Boolean(document.querySelector(".catalog-detail"))'),'catalog saved');
      check(await evaluate('Boolean(document.querySelector(".catalog-detail h1"))'),label+' '+name+' markdown rendered');
      let saved=(await call('snapshot'))[collection].find(r=>r.name===label+name);check(Boolean(saved),label+' '+name+' persists');
      check(saved.attributes.values[template.id].power===70&&saved.tagIds.includes((await call('snapshot')).tags.find(t=>t.name===label+'标签').id)&&saved.facts[0].value==='不超过统一战力',label+' '+name+' attributes tags facts persist');
      if(kind==='item')check(saved.imageId===portrait.id&&saved.designImageId===design.id,label+' item independent images persist');
      if(kind==='item')check(saved.holders.length===0,label+' new item has no implicit owner');
      if(kind==='technique')check(saved.practitioners.length===0,label+' new technique has no implicit practitioner');
      if(kind==='place')check(saved.positions.length===0&&saved.characterIds.length===0,label+' new place has no implicit links');
      await click('编辑'+name);await input('textarea[aria-label="摘要"]','修改后摘要');await click('保存');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'edit saved');
      check((await call('snapshot'))[collection].find(r=>r.id===saved.id).summary==='修改后摘要',label+' '+name+' edits persist');
      await screenshot(label+'-'+kind);await viewport(820,640);
      check(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),label+' '+name+' narrow no overflow');await screenshot(label+'-'+kind+'-narrow');await viewport(1440,810);
      await click('归档');await until(()=>evaluate('document.querySelector(".catalog-detail header .tag")?.textContent.includes("已归档")'),'archived');await click('恢复');await until(()=>evaluate('!document.querySelector(".catalog-detail header .tag")?.textContent.includes("已归档")'),'restored');
    }
    await click('全局搜索');await option('搜索范围','全部世界');await input('input[aria-label="全局搜索关键词"]','雪境明灯');await click('雪境明灯','.global-search-results button');await until(()=>evaluate('document.querySelector(".catalog-detail header h2")?.textContent==="雪境明灯"'),'cross work search opens target');check(await evaluate('document.querySelector(".project-switch strong")?.textContent==="远方作品"'),label+' global search switches works');
    await click('全局搜索');await option('搜索范围','全部世界');await input('input[aria-label="全局搜索关键词"]','验证人物');await click('验证人物','.global-search-results button');await until(()=>evaluate('document.querySelector(".detail-intro h1")?.textContent==="验证人物"'),'search returns to character');
    await click('角色图鉴');check(await evaluate('document.querySelectorAll(".library-toolbar>.ui-select-trigger").length===3'),label+' character filters');await click('查看验证人物档案');await click('编辑基础档案');await click('从素材库选择','.portrait-picker button');await click('选择素材 '+portraitName);await click('使用这张图片');await click('从素材库选择','.image-field button');await click('选择素材 '+designName);await click('使用这张图片');await click('保存档案');await until(()=>evaluate('!document.querySelector(".editor-dialog")'),'character saved');const savedCharacter=(await call('snapshot')).characters.find(c=>c.id===character.id);check(savedCharacter.portraitId===portrait.id&&savedCharacter.designImageId===design.id,label+' character independent images persist');await click('物品、功法与地点');
    check(!await evaluate('document.body.textContent.includes("为新的角色留一个位置")'),label+' redundant character card removed');
    const choose=async name=>{await input('input[aria-label="搜索关联资料"]',label+name);await click(label+name,'.association-choices button');};
    const saveLink=async()=>{await click('保存关联');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'link saved');};
    for(const name of ['物品','功法','地点']){
      await click('关联'+name);await choose(name);
      if(name==='物品'){
        await input('input[aria-label="持有数量"]','3');await input('textarea[aria-label="关联备注"]','随身携带');
        await click('取消');check(await evaluate('Boolean(document.querySelector("[role=alertdialog]"))'),label+' link draft protected');await click('继续编辑','[role=alertdialog] button');
        await viewport(820,640);check(await evaluate('document.querySelector(".journey-dialog").getBoundingClientRect().right<=innerWidth'),label+' narrow link dialog fits');await screenshot(label+'-link-editor');await viewport(1440,810);
      }
      if(name==='功法')await input('input[aria-label="修习进度"]','第二层');
      await saveLink();
    }
    let linked=(await call('snapshot'));
    const linkedItem=linked.items.find(r=>r.name===label+'物品');
    check(linkedItem.holders[0].quantity===3&&linkedItem.holders[0].characterId===character.id,label+' character assigns item');
    check(linked.techniques.find(r=>r.name===label+'功法').practitioners[0].progress==='第二层',label+' character assigns technique');
    check(linked.places.find(r=>r.name===label+'地点').characterIds.includes(character.id),label+' character assigns place');
    for(const theme of ['ink','paper']){
      await call('setTheme',theme);await until(()=>evaluate('document.documentElement.dataset.theme==='+JSON.stringify(theme)),'theme applied');
      for(const width of [1440,1920,820]){await viewport(width,810);check(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),label+' '+theme+' character width '+width);await screenshot(label+'-character-'+theme+'-'+width);}
    }
    await viewport(1440,810);
    await click('编辑关联','.catalog-linked-record button.text-link');await input('input[aria-label="持有数量"]','4');await saveLink();
    linked=(await call('snapshot'));check(linked.items.find(r=>r.id===linkedItem.id).holders[0].id===linkedItem.holders[0].id,label+' editing relation keeps row id');
    await click('编辑关联','.catalog-linked-record button.text-link');await click('解除关联');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'unlinked');
    check(!(await call('snapshot')).items.find(r=>r.id===linkedItem.id).holders.length,label+' unlink affects only current owner');
    await click('关联物品');await choose('物品');await saveLink();
    check(await evaluate('document.querySelector(".catalog-character-links").textContent.includes('+JSON.stringify(label+'物品')+')'),label+' character backlinks');await screenshot(label+'-character');
    await click('地图探索');await click('古井','.atlas-location-list button');
    await click(await evaluate("Array.from(document.querySelectorAll('button')).find(e=>['收藏地点','取消地点收藏'].includes(e.getAttribute('aria-label'))).getAttribute('aria-label')"));check(await evaluate('document.querySelector(".map-catalog-links .catalog-link-actions button").disabled'),label+' map draft blocks catalog association');
    await click('保存地图');await until(()=>evaluate('!document.querySelector(".map-catalog-links .catalog-link-actions button").disabled'),'map saved');
    await click('关联地点');await choose('地点');await saveLink();
    check((await call('snapshot')).places.find(p=>p.name===label+'地点').positions.some(p=>p.mapId===map.id&&p.locationId==='well'),label+' map assigns place');
    await screenshot(label+'-map-link');await click(label+'地点','.catalog-linked-open');await click('验证地图 / 古井 →');
    await until(()=>evaluate('document.querySelector(".atlas-location-info")?.textContent.includes("古井")'),'map opens from place');
    await click(label+'地点','.catalog-linked-open');await click('← 返回地图探索');check(await evaluate('Boolean(document.querySelector(".atlas-location-info"))'),label+' return to source');await click(label+'地点','.catalog-linked-open');check(await evaluate('document.querySelector(".catalog-detail header h2").textContent')===label+'地点',label+' map backlink opens place');
    await click('编辑地点');await input('textarea[aria-label="摘要"]','关联后修改定义');await click('保存');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'definition saved');
    const retained=(await call('snapshot')).places.find(p=>p.name===label+'地点');check(retained.positions.length===1&&retained.characterIds.includes(character.id),label+' definition edit preserves links');
    check(!(await call('snapshot')).worldEntries.some(r=>r.worldId===work.worldId),label+' catalogs never create world entries');
    const category=await call('saveWorldCategory',{worldId:work.worldId,name:label+'规则',color:'#bda374',description:'',active:true,expectedVersion:0});
    const entry=await call('saveWorldEntry',{worldId:work.worldId,categoryId:category.id,expectedCategoryVersion:category.version,name:label+'世界规则',aliases:'',summary:'',body:'',pending:'',source:'',facts:[],status:'draft',imageId:null,links:[],expectedVersion:0});
    await reload();await click('世界档案');await click(label+'世界规则','.world-entry-card h3');
    await click('关联地点');await choose('地点');await saveLink();check((await call('snapshot')).places.find(p=>p.id===retained.id).entryIds.includes(entry.id),label+' world entry assigns place');await screenshot(label+'-world-link');
    await click('编辑关联','.catalog-linked-record button.text-link');await click('解除关联');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'unlinked');
    const deletion=await call('previewDeletion',{kind:'worldEntry',id:entry.id});await call('deleteContent',{token:deletion.token,name:entry.name});await reload();
    await click('物品库');await until(()=>evaluate('Boolean(document.querySelector(".catalog-page"))'),'item page loaded before returning to list');if(await evaluate('Boolean(document.querySelector(".catalog-detail"))'))await click('← 返回物品库','.catalog-actions button');log(JSON.stringify(await evaluate('({work:document.querySelector(".project-switch strong")?.textContent,page:document.querySelector("main h1")?.textContent,cards:[...document.querySelectorAll(".catalog-card h2,.catalog-page .list-row h3")].map(e=>e.textContent),filters:[...document.querySelectorAll(".catalog-page .library-toolbar input,.catalog-page .library-toolbar [role=combobox]")].map(e=>e.value??e.textContent)})')));await click(label+'物品','.catalog-card,.catalog-page .list-row');await click('删除');await click('预览删除范围');await input('input[aria-label="确认删除资料名称"]',label+'物品');await click('永久删除');await until(async()=>!(await call('snapshot')).items.some(r=>r.name===label+'物品'),'item deleted');await click('关闭','[role=dialog] button');
    check(!(await call('snapshot')).worldEntries.some(r=>r.worldId===work.worldId),label+' catalogs never create world entries');
  };
  async function verifyConfiguration(label){
    const reopen=async()=>{log(label+' reopening draft session');if(label==='desktop'){ws.close();child.kill();await until(()=>(child.exitCode!==null||child.signalCode!==null),'isolated desktop stopped');child=launch();await connect();await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'reopened desktop');await viewport(1440,810);}else await reload();};
    const w=await call('createWork',{name:label+'配置与草稿',world:{kind:'new',name:label+'自定义世界',description:''}});await call('selectWork',w.id);
    const seeded=await call('saveItem',{...farItem,id:undefined,worldId:w.worldId,name:label+'待转移物品',categoryId:'equipment',itemType:'equipment',expectedVersion:0});await reload();await viewport(1440,810);await click('物品库');
    await click('资料配置','.page-actions button');await click('物品','[role=tab]');await input('input[aria-label="类别名称 1"]',label+'兵器');await click('下移类别 '+label+'兵器');
    await click('添加字段');await input('.fact-editor-row input','所属年代');await input('.fact-editor-row textarea','上古');await click('人物','[role=tab]');await click('物品','[role=tab]');
    check(await evaluate('document.querySelector(".fact-editor-row textarea").value==="上古"'),label+' configuration tabs preserve draft');
    for(const theme of ['ink','paper']){await call('setTheme',theme);await evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme));for(const width of [1440,1920,820]){await viewport(width,810);check(await evaluate('document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector(".journey-editor-body").scrollWidth<=document.querySelector(".journey-editor-body").clientWidth+1'),label+' configuration '+theme+' width '+width);await screenshot(label+'-config-'+theme+'-'+width);}}
    await viewport(1440,810);await click('保存配置');await until(()=>evaluate('document.querySelector(".journey-dialog").textContent.includes("资料配置已保存")'),'config saved');
    let savedConfig=(await call('snapshot')).libraryConfigs.find(c=>c.worldId===w.worldId);check(savedConfig.groups.item.categories[1].name===label+'兵器',label+' initial category renamed and reordered');
    await click('取消','.journey-dialog .editor-footer button');await click('新建物品');await input('input[aria-label="名称"]',label+'模板物品');await click('详细设定');
    check(await evaluate('document.querySelector(".fact-editor-row textarea").value==="上古"'),label+' default text fields applied');await click('数值属性（选填）','summary');await click('新建数值模板');
    await input('.template-top input',label+'重量模板');await input('input[aria-label="维度 1 名称"]','重量');await click('保存模板');await until(()=>evaluate('!document.querySelector(".attribute-manager")'),'inline template saved');
    check(await evaluate('Boolean(document.querySelector(".catalog-editor-dialog"))'),label+' inline template leaves record draft open');await input('input[aria-label="属性 重量"]','15');await click('保存','.journey-dialog .editor-footer button');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'record saved');
    const created=(await call('snapshot')).items.find(r=>r.name===label+'模板物品');check(created.facts[0].value==='上古'&&created.attributes.templateId,label+' inline template and default fields persist');
    await click('资料配置','.page-actions button');await click('物品','[role=tab]');await click('删除','.config-category-row:nth-child(2) button');await option('删除类别后的归属','转移到 材料');await click('预览删除范围');
    check(await evaluate('document.querySelector(".deletion-preview").textContent.includes('+JSON.stringify(label+'待转移物品')+')'),label+' referenced category deletion preview');await screenshot(label+'-category-delete-preview');await input('input[aria-label="确认删除资料名称"]',label+'兵器');await click('永久删除');await until(async()=>!(await call('snapshot')).libraryConfigs.find(c=>c.worldId===w.worldId).groups.item.categories.some(c=>c.id==='equipment'),'category deleted');
    check((await call('snapshot')).items.find(r=>r.id===seeded.id).categoryId==='material',label+' deleting initial category transfers records');await click('关闭','.deletion-dialog button');await click('取消','.journey-dialog .editor-footer button');
    await click('← 返回物品库');await input('input[aria-label="搜索物品"]','上古');check(await evaluate('document.querySelectorAll(".catalog-card").length===1'),label+' list searches supplementary fields');await click('列表视图');await click('角色图鉴');await click('物品库');check(await evaluate('document.querySelector("input[aria-label=搜索物品]").value==="上古"&&Boolean(document.querySelector(".catalog-page .list-row"))'),label+' list query and view remembered');
    await click('地图探索');const m=await call('saveMap',{worldId:w.worldId,expectedVersion:0,name:label+'地图',description:'',backgroundId:null,stages:[{id:'start',name:'起始'}],locations:[{id:'marker',name:'标记',kind:'城镇',description:'',x:400,y:300,unlockStageId:'start',imageId:null,entryIds:[],characterIds:[],favorite:false,archived:false}],terrain:[]});await reload();await click('地图探索');await click('标记','.atlas-location-list button');await click('编辑地图标记');await input('.journey-editor-body textarea','直接保存标记内容');await click('保存地图','.journey-dialog .editor-footer button');await until(()=>evaluate('!document.querySelector(".journey-dialog")'),'map saved from editor');check((await call('snapshot')).maps.find(r=>r.id===m.id).locations[0].description==='直接保存标记内容',label+' marker directly saves map');
    log(label+' beginning chapter recovery');await click('剧情与章节');await click('新建章节');await input('input[aria-label="章节名称"]',label+'恢复章节');await input('textarea[aria-label="章节正文"]','未保存的章节正文');await until(()=>evaluate('document.querySelector(".chapter-workspace-head").textContent.includes("草稿已暂存本机")'),'draft durable');await reopen();await click('剧情与章节');await click('继续草稿');check(await evaluate('document.querySelector("textarea[aria-label=章节正文]").value==="未保存的章节正文"'),label+' chapter draft recovered after reload');await click('保存章节');await until(()=>evaluate('!document.querySelector(".chapter-body-input")'),'chapter saved');
    let snap=await call('snapshot'),chapter=snap.chapters.find(c=>c.name===label+'恢复章节');check(chapter.body==='未保存的章节正文',label+' recovered chapter saved');await click('编辑章节');await input('textarea[aria-label="章节正文"]','旧草稿待核对');await until(()=>evaluate('document.querySelector(".chapter-workspace-head").textContent.includes("草稿已暂存本机")'),'stale draft durable');await call('saveChapter',{...chapter,body:'外部新正文',expectedVersion:chapter.version,expectedOutlineVersion:snap.outlines.find(o=>o.workId===w.id).version});await reopen();await click('剧情与章节');await click('查看旧草稿');check(await evaluate('document.querySelector("textarea[aria-label=旧草稿正文]").readOnly&&document.querySelector("textarea[aria-label=旧草稿正文]").value==="旧草稿待核对"'),label+' stale draft opens read-only');check((await call('snapshot')).chapters.find(c=>c.id===chapter.id).body==='外部新正文',label+' stale recovery never overwrites newer chapter');await screenshot(label+'-chapter-recovery');await click('关闭','.draft-recovery-dialog button');await click('清除','.chapter-draft-notice button');await click('清除草稿','[role=alertdialog] button');
  }
  if(!process.argv.includes('--config-only')&&!process.argv.includes('--browser-only'))await verifyCatalogs('desktop');
  if(!process.argv.includes('--catalog-only')&&!process.argv.includes('--browser-only'))await verifyConfiguration('desktop');
  const desktop={ws,send,evaluate,call};let chrome;
  try{
    const connection=await call('getConnectionInfo');
    const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const browserPort=listener.address().port;await new Promise(r=>listener.close(r));
    chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port='+browserPort,'--user-data-dir='+join(run,'browser-profile'),'--no-first-run','--no-default-browser-check',connection.baseUrl],{windowsHide:true,stdio:'ignore'});
    await connect(browserPort);await until(()=>evaluate('Boolean(document.querySelector(".sidebar"))'),'browser connection');await viewport(1440,810);if(!process.argv.includes('--config-only')){await call('selectWork',work.id);await reload();}
    if(!process.argv.includes('--config-only'))await verifyCatalogs('browser');
    if(!process.argv.includes('--catalog-only'))await verifyConfiguration('browser');
  }catch(e){report.browserScreen=await evaluate('({text:document.body.innerText.slice(-4500)})').catch(()=>null);await screenshot('browser-failure').catch(()=>{});throw e;}finally{if(chrome){await send('Browser.close').catch(()=>{});ws?.close();await until(()=>chrome.exitCode!==null,'browser exit',10000).catch(()=>chrome.kill());}({ws,send,evaluate,call}=desktop);}
  report.success=true;
}catch(e){report.error=e.stack;if(evaluate&&ws?.readyState===1){report.screen=await evaluate('({theme:document.documentElement.dataset.theme,text:document.body.innerText.slice(-3500)})').catch(()=>null);writeFileSync(join(output,'catalog-failure.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}throw e;}
finally{
  writeFileSync(join(output,packaged?'catalog-packaged-report.json':process.argv.includes('--config-only')?'config-extra-ui-report.json':'catalog-ui-report.json'),JSON.stringify(report,null,2));writeFileSync(join(output,'catalog-ui-process.log'),processLog.join(''));
  if(call&&ws?.readyState===1){await evaluate(`document.querySelectorAll('[role=dialog] button,[role=alertdialog] button').forEach(e=>{if(['关闭外观设置','关闭编辑'].includes(e.getAttribute('aria-label'))||['继续编辑','取消'].includes(e.textContent.trim()))e.click();});`).catch(()=>{});await call('quitApplication').catch(()=>{});}
  ws?.close();await until(()=>(child.exitCode!==null||child.signalCode!==null),'desktop exit',10000).catch(()=>{child.kill();});
  if(report.success){if(!run.startsWith(output+'\\catalog-ui-')||lstatSync(run).isSymbolicLink()||realpathSync(run).toLowerCase()!==run.toLowerCase())throw Error('Unsafe test cleanup path');await rm(run,{recursive:true,force:true,maxRetries:10,retryDelay:300});log('Disposable profile removed; screenshots retained');}
}
