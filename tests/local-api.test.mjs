import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {request} from 'node:http';
import Database from 'better-sqlite3';
import {LibraryStore,ContentError} from '../src/core/store.ts';
import {contentCommands} from '../src/core/commands.ts';
import {startLocalServer} from '../src/core/local-server.ts';
import {CONTENT_CHANNELS} from '../src/shared/api.ts';
import {BACKUP_CHANNELS} from '../src/shared/backup.ts';
import {BackupService} from '../src/core/backups.ts';
import {ConnectionAccess} from '../src/core/connection-access.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {blankCatalog} from '../src/shared/catalogs.ts';

test('新资料库通过 HTTP 与 MCP 保存、编辑、归档和恢复，契约完整且不写世界条目',async t=>{
  const f=await fixture(t),generation=f.store.snapshot().generation;
  const client=new Client({name:'catalog-test',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${f.connection.token}`}}});
  await client.connect(transport);t.after(()=>client.close());
  assert.equal(client.getServerVersion().version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
  const parse=r=>{assert.equal(r.isError,false,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
  for(const kind of ['item','technique','place']){
    const cap=kind[0].toUpperCase()+kind.slice(1),operation='save'+cap;
    const schema=parse(await client.callTool({name:'describe_operations',arguments:{operation}}));assert.equal(schema.operations[0].name,operation);assert.match(schema.definitions,new RegExp('interface '+cap+'Input'));
    const saved=await value(await f.command(operation,[{...blankCatalog(kind,'a'),name:'AI '+kind}]));
    const updated=parse(await client.callTool({name:'call_operation',arguments:{operation,args:[{...saved,expectedVersion:saved.version,body:'## 修订内容'}],generation}}));assert.equal(updated.version,2);
    const archived=parse(await client.callTool({name:'call_operation',arguments:{operation:'archive'+cap,args:[saved.id,updated.version,true],generation}}));assert.equal(archived.archived,true);
    const restored=await value(await f.command('archive'+cap,[saved.id,archived.version,false]));assert.equal(restored.archived,false);assert.equal(restored.body,'## 修订内容');
    assert.equal((await f.command(operation,[{...saved,expectedVersion:1}],{auth:false})).status,401);
  }
  assert.equal(f.store.snapshot().worldEntries.length,0);
});

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
// Mode switching intentionally closes existing sockets. This test client opens
// one connection per request and consumes its body; no retries hide failures.
function fetchFresh(url,init={}){
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:init.method??'GET',headers:init.headers,agent:false},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>{const headers=new Headers();for(const [name,value] of Object.entries(res.headers))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])headers.append(name,item);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
    });
    req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('HTTP request timed out')));req.end(init.body);
  });
}

async function fixture(t,overrides={},fetchRequest=fetch){
  const directory=mkdtempSync(join(tmpdir(),'oc-api-')),db=new Database(join(directory,'library.sqlite')),store=new LibraryStore(db,directory),uiDirectory=join(directory,'web'),descriptorPath=join(directory,'connection.json');
  db.exec("INSERT INTO worlds VALUES('a','甲世界'),('b','乙世界');INSERT INTO works VALUES('work-a','a','甲作品'),('work-b','b','乙作品')");
  mkdirSync(uiDirectory);writeFileSync(join(uiDirectory,'index.html'),'<html>万象工坊测试</html>');writeFileSync(join(uiDirectory,'app.js'),'window.test=true;');
  const commands=contentCommands(store),contract=JSON.parse(readFileSync(new URL('../resources/api-contract.json',import.meta.url),'utf8'));
  const backups=new BackupService({store,directory,openDatabase:path=>new Database(path),onRestored:commands.changed});
  const options={store,commands,backups,access:new ConnectionAccess(join(directory,'connection-settings.json')),uiDirectory,descriptorPath,port:0,contract,decodeImage:bytes=>{if(!bytes.equals(png))throw new ContentError('VALIDATION','无法解码图片');return {width:1,height:1};},...overrides};
  const server=await startLocalServer(options),connection=JSON.parse(readFileSync(descriptorPath,'utf8')),base=connection.baseUrl,authorization=`Bearer ${connection.token}`;
  const call=async(path,{auth=true,headers={},...init}={})=>fetchRequest(base+path,{...init,headers:{...(auth?{authorization}:{}),...headers}});
  const command=(name,args,options={})=>call('/api/v1/commands/'+name,{method:'POST',body:JSON.stringify({args}),headers:{'Content-Type':'application/json'},...options});
  t.after(()=>{server.close();store.close();const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('oc-api-'))throw Error('Unexpected cleanup path');rmSync(target,{recursive:true,force:true});});
  return {directory,store,commands,server,connection,base,call,command,options};
}
async function value(response){assert.equal(response.status,200,await response.clone().text());return (await response.json()).value;}

test('从角色关联资料经 HTTP 与 MCP 共用版本、认证和恢复代次校验',async t=>{
  const f=await fixture(t),generation=f.store.snapshot().generation;
  const character=await value(await f.command('saveCharacter',[{worldId:'a',expectedVersion:0,name:'关联人物',caption:'',status:'',quote:'',intro:'',body:'',pending:'',facts:[],tagIds:[],portraitId:null}]));
  const item=await value(await f.command('saveItem',[{...blankCatalog('item','a'),name:'道具'}]));
  const input={target:{kind:'character',id:character.id,expectedVersion:character.version},kind:'item',catalogId:item.id,expectedVersion:item.version,linked:true,holding:{quantity:2,state:'stored',notes:'保留备注'}};
  assert.equal((await f.command('saveCatalogLink',[input],{auth:false})).status,401);
  const linked=await value(await f.command('saveCatalogLink',[input]));assert.equal(linked.holders[0].characterId,character.id);
  assert.equal((await f.command('saveCatalogLink',[input])).status,409);
  const client=new Client({name:'catalog-links-test',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${f.connection.token}`}}}));t.after(()=>client.close());
  const parse=r=>{assert.equal(r.isError,false,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
  const schema=parse(await client.callTool({name:'describe_operations',arguments:{operation:'saveCatalogLink'}}));assert.equal(schema.operations[0].name,'saveCatalogLink');assert.match(schema.definitions,/interface CatalogLinkInput/);
  const edited=parse(await client.callTool({name:'call_operation',arguments:{operation:'saveCatalogLink',args:[{...input,expectedVersion:linked.version,holding:{...input.holding,quantity:5}}],generation}}));
  assert.equal(edited.holders[0].id,linked.holders[0].id);assert.equal(edited.holders[0].quantity,5);
  const remove={...input,expectedVersion:edited.version,linked:false};
  assert.equal((await f.command('saveCatalogLink',[remove],{body:JSON.stringify({args:[remove],generation:'stale'})})).status,409);
  assert.deepEqual((await value(await f.command('saveCatalogLink',[remove]))).holders,[]);
});

test('导入导出经 HTTP 和官方 MCP 客户端共用预览令牌、认证、代次及事务',async t=>{
  const f=await fixture(t),generation=f.store.snapshot().generation;
  assert.equal((await f.command('exportTransfer',[{format:'package',scope:'library'}],{auth:false})).status,401);
  const file=await value(await f.command('exportTransfer',[{format:'package',scope:'work',id:'work-a'}]));
  const p=await value(await f.command('previewTransferImport',[file]));assert.equal(f.store.snapshot().works.length,2);
  const result=await value(await f.command('importTransfer',[{token:p.token}]));assert.equal(result.workIds.length,1);assert.equal(f.store.snapshot().works.length,3);
  assert.equal((await f.command('importTransfer',[{token:p.token}])).status,409);
  const client=new Client({name:'transfer-test',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:f.authorization??`Bearer ${f.connection.token}`}}});
  await client.connect(transport);t.after(()=>client.close());
  const parse=r=>{assert.equal(r.isError,false,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
  const schema=parse(await client.callTool({name:'describe_operations',arguments:{operation:'previewTransferImport'}}));assert.match(schema.definitions,/interface TransferImportInput/);
  const preview=parse(await client.callTool({name:'call_operation',arguments:{operation:'previewTransferImport',args:[{name:'稿.txt',content:'第一章 起\n正文\n第二章 终\n尾声',workId:'work-a'}],generation}}));assert.equal(preview.chapters,2);
  const imported=parse(await client.callTool({name:'call_operation',arguments:{operation:'importTransfer',args:[{token:preview.token}],generation}}));assert.equal(imported.chapterIds.length,2);
  const stale=await f.command('previewTransferImport',[{name:'旧.txt',content:'旧草稿',workId:'work-a'}],{body:JSON.stringify({args:[{name:'旧.txt',content:'旧草稿',workId:'work-a'}],generation:'old'})});assert.equal(stale.status,409);
});

test('Skill 下载仅提供两个随软件打包的 ZIP，复用浏览器认证并拒绝任意文件路径',async t=>{
  const skillDirectory=resolve('resources/skills'),f=await fixture(t,{skillDirectory});
  assert.equal((await f.call('/api/v1/skills/api',{auth:false})).status,401);
  const login=await f.call('/api/v1/session',{auth:false,method:'POST',headers:{Origin:f.base,'X-Wanxiang-Client':'browser'}});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  for(const kind of ['api','mcp']){
    const downloaded=await f.call('/api/v1/skills/'+kind,{auth:false,headers:{cookie}});
    assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'application/zip');
    assert.equal(downloaded.headers.get('content-disposition'),`attachment; filename="wanxiang-workshop-${kind}.zip"`);
    const bytes=Buffer.from(await downloaded.arrayBuffer());
    assert.ok(bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])));
    assert.deepEqual(bytes,readFileSync(join(skillDirectory,`wanxiang-workshop-${kind}.zip`)));
    assert.ok(!bytes.includes(Buffer.from(f.connection.token)));
  }
  assert.equal((await f.call('/api/v1/skills/mcp',{headers:{Origin:'https://untrusted.example'}})).status,403);
  for(const kind of ['connection.json','__proto__','mcp.zip','mcp%2Fextra'])assert.equal((await f.call('/api/v1/skills/'+kind)).status,404);
  assert.equal((await f.call('/api/v1/skills/api',{method:'POST'})).status,404);
  const missing=await fixture(t,{skillDirectory:join(f.directory,'missing')});
  assert.equal((await missing.call('/api/v1/skills/api')).status,503);
});

test('服务只绑定回环地址，页面可访问，资料与连接信息需要授权',async t=>{
  const f=await fixture(t);assert.match(f.base,/^http:\/\/127\.0\.0\.1:\d+$/);
  const page=await f.call('/',{auth:false});assert.equal(page.status,200);assert.match(await page.text(),/万象工坊/);assert.equal(page.headers.get('x-frame-options'),'DENY');
  assert.equal((await f.call('/api/v1/snapshot',{auth:false})).status,401);assert.equal((await f.call('/api/v1/info',{auth:false})).status,401);
  assert.equal((await f.call('/api/v1/snapshot',{auth:false,headers:{authorization:'Bearer wrong'}})).status,401);
  const health=await value(await f.call('/api/v1/health',{auth:false})),info=await value(await f.call('/api/v1/info'));
  assert.equal(health.instanceId,f.connection.instanceId);assert.equal(info.baseUrl,f.base);assert.ok(!JSON.stringify({health,info}).includes(f.connection.token));
  assert.equal((await f.call('/connection.json')).status,404);assert.equal((await f.call('/library.sqlite')).status,404);
});

test('浏览器同源会话可读写，跨站、伪造 Host、无来源配对被拒绝',async t=>{
  const f=await fixture(t),path='/api/v1/session';
  assert.equal((await f.call(path,{auth:false,method:'POST',headers:{'X-Wanxiang-Client':'browser'}})).status,403);
  for(const headers of [{Origin:'https://example.com'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.call('/api/v1/snapshot',{headers})).status,403,JSON.stringify(headers));
  const badHost=await new Promise((done,reject)=>{const req=request(f.base+'/api/v1/health',{headers:{Host:'malicious.test'}},res=>{res.resume();res.on('end',()=>done(res.statusCode));});req.on('error',reject);req.end();});assert.equal(badHost,403);
  assert.equal((await f.call('/api/v1/snapshot',{method:'OPTIONS',auth:false,headers:{Origin:'https://example.com'}})).headers.get('access-control-allow-origin'),null);
  const session=await f.call(path,{auth:false,method:'POST',headers:{'X-Wanxiang-Client':'browser','Sec-Fetch-Site':'same-origin',Origin:f.base}});
  assert.equal(session.status,200);const setCookie=session.headers.get('set-cookie');assert.match(setCookie,/HttpOnly; SameSite=Strict/);assert.ok(!setCookie.includes(f.connection.token));
  const cookie=setCookie.split(';')[0],snapshot=await value(await f.call('/api/v1/snapshot',{auth:false,headers:{cookie,Origin:f.base}}));assert.equal(snapshot.worlds.length,2);
  const saved=await value(await f.command('saveWork',[{id:'work-a',name:'网页修改',expectedVersion:0}],{auth:false,headers:{cookie,Origin:f.base,'Content-Type':'application/json'}}));assert.equal(saved.name,'网页修改');
  assert.equal((await f.command('saveWork',[{id:'work-a',name:'跨站覆盖',expectedVersion:1}],{auth:false,headers:{cookie,Origin:'https://example.com','Content-Type':'application/json'}})).status,403);
  assert.equal(f.store.workspace.getWork('work-a').name,'网页修改');
});

test('HTTP 和桌面命令共用内容、版本检查和更新标识',async t=>{
  const f=await fixture(t),before=await value(await f.call('/api/v1/revision'));
  const saved=await value(await f.command('saveWorld',[{id:'a',name:'同一世界',description:'两端共享',expectedVersion:0}]));assert.equal(saved.version,1);assert.equal(f.store.workspace.getWorld('a').description,'两端共享');
  assert.notEqual(await value(await f.call('/api/v1/revision')),before);
  f.commands.invoke('saveWork',[{id:'work-a',name:'桌面更新',expectedVersion:0}]);
  const snapshot=await value(await f.call('/api/v1/snapshot'));assert.equal(snapshot.works.find(w=>w.id==='work-a').name,'桌面更新');
  const conflict=await f.command('saveWorld',[{id:'a',name:'过期覆盖',description:'不应覆盖',expectedVersion:0}]);assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'CONFLICT');assert.equal(f.store.workspace.getWorld('a').name,'同一世界');
});

test('并发保存只有一个成功，不会静默覆盖他人修改',async t=>{
  const f=await fixture(t),responses=await Promise.all(['甲','乙'].map(name=>f.command('saveWork',[{id:'work-a',name,expectedVersion:0}])));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(f.store.workspace.getWork('work-a').version,1);
});

test('退出等待期间拒绝新写入和备份，仍能读取；桌面生命周期不开放给 HTTP',async t=>{
  const f=await fixture(t);
  for(const name of ['quitApplication','hideToTray','setCloseToTray','getDesktopStatus'])assert.equal((await f.command(name,[])).status,404);
  f.store.closing=true;
  assert.equal((await f.call('/api/v1/snapshot')).status,200);
  assert.equal((await f.command('getBackupStatus',[])).status,200);
  assert.equal((await f.command('saveWork',[{id:'work-a',name:'不可写入',expectedVersion:0}])).status,409);
  assert.equal((await f.command('runIncrementalBackup',[])).status,409);
  assert.equal((await f.call('/api/v1/assets?worldId=a&name=a.png',{method:'POST',body:png,headers:{'Content-Type':'application/octet-stream'}})).status,409);
  f.store.writesPaused=false;
  assert.throws(()=>f.store.assertWritable(),e=>e.code==='BUSY');
  assert.equal(f.store.workspace.getWork('work-a').name,'甲作品');
});

test('API 覆盖全部内容命令，契约提供输入类型与参数顺序',async t=>{
  const f=await fixture(t),schema=await value(await f.call('/api/v1/schema'));
  assert.deepEqual(schema.operations.map(o=>o.name).sort(),Object.keys({...CONTENT_CHANNELS,...BACKUP_CHANNELS}).sort());assert.match(schema.definitions,/interface CharacterInput/);assert.match(schema.definitions,/expectedOutlineVersion/);
  assert.deepEqual(schema.operations.find(o=>o.name==='archiveWork').parameters.map(p=>p.name),['id','version','archived']);
});

test('备份接口复用认证，恢复后网页和 AI 的旧代次写入被拒绝',async t=>{
  const f=await fixture(t),before=await value(await f.call('/api/v1/snapshot'));
  assert.equal((await f.command('getBackupStatus',[],{auth:false})).status,401);
  assert.equal((await value(await f.command('getBackupStatus',[]))).needsBaseline,true);
  assert.equal((await f.command('runIncrementalBackup',[])).status,409);
  const estimate=await value(await f.command('estimateBackup',[])),baseline=await value(await f.command('createBackupBaseline',[estimate]));
  await value(await f.command('saveWork',[{id:'work-a',name:'恢复前',expectedVersion:0}]));
  const preview=await value(await f.command('previewBackupRestore',[baseline.point.id]));await value(await f.command('restoreBackup',[preview.token]));
  const restored=await value(await f.call('/api/v1/snapshot'));assert.notEqual(restored.generation,before.generation);assert.equal(restored.works.find(w=>w.id==='work-a').name,'甲作品');
  assert.equal((await f.command('saveWork',[{id:'work-a',name:'过期',expectedVersion:0}])).status,409);
  const send=generation=>f.call('/api/v1/commands/saveWork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({generation,args:[{id:'work-a',name:'恢复后',expectedVersion:0}]})});
  assert.equal((await send(before.generation)).status,409);assert.equal((await value(await send(restored.generation))).name,'恢复后');
  const upload=await f.call('/api/v1/assets?worldId=a&name=old.png',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Wanxiang-Generation':before.generation},body:png});assert.equal(upload.status,409);
});

test('不开放任意执行，参数错误不写库也不增加更新标识',async t=>{
  const f=await fixture(t),before=f.commands.revision();
  for(const name of ['__proto__','constructor','close','exec','pickPortrait'])assert.equal((await f.command(name,[])).status,404);
  for(const [name,args] of [['saveWork',[]],['saveWorld',[null]],['archiveWork',['work-a',0,'false']],['deleteTag',['x',-1]],['selectWork',[{}]]])assert.equal((await f.command(name,args)).status,400);
  assert.equal((await f.call('/api/v1/commands/saveWork',{method:'POST',headers:{'Content-Type':'application/json'},body:'invalid'})).status,400);
  assert.equal((await f.call('/api/v1/commands/saveWork',{method:'POST',body:'{}'})).status,400);
  assert.equal(f.commands.revision(),before);assert.equal(f.store.workspace.getWork('work-a').name,'甲作品');
});

test('图片上传、鉴权读取、重复导入和世界隔离',async t=>{
  const f=await fixture(t),upload=(world,name='测试 图片.png')=>f.call(`/api/v1/assets?worldId=${world}&name=${encodeURIComponent(name)}`,{method:'POST',body:png});
  const a=await value(await upload('a')),again=await value(await upload('a')),b=await value(await upload('b'));assert.equal(a.id,again.id);assert.notEqual(a.id,b.id);
  assert.equal(a.sourceName,'测试 图片.png');assert.equal((await f.call('/api/v1/assets/'+a.id,{auth:false})).status,401);
  const bytes=await f.call('/api/v1/assets/'+a.id);assert.equal(bytes.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),png);
  assert.equal((await f.call('/api/v1/assets/no-such-id')).status,404);assert.equal((await upload('missing')).status,400);
  assert.equal((await f.call('/api/v1/assets?worldId=a&name=x.png',{method:'POST',body:'not an image'})).status,400);
  const snapshot=await value(await f.call('/api/v1/snapshot'));assert.equal(snapshot.media.length,2);assert.equal(snapshot.media[0].width,1);
});

test('超大请求提前拒绝，编码目录穿越不能读取连接文件',async t=>{
  const f=await fixture(t);
  const raw=(path,headers={},method='GET')=>new Promise((done,reject)=>{const req=request(f.base+path,{method,headers:{authorization:`Bearer ${f.connection.token}`,...headers}},res=>{res.resume();res.on('end',()=>done(res.statusCode));});req.on('error',e=>reject(Error(path+': '+e.message)));req.end();});
  assert.equal(await raw('/api/v1/assets?worldId=a&name=x.png',{'Content-Length':26*1024*1024},'POST'),413);
  assert.equal(await raw('/%2e%2e%2fconnection.json'),403);assert.equal(await raw('/%5c..%5cconnection.json'),403);
});

test('占用端口自动换号，退出清理连接文件，旧令牌不能用于新服务',async t=>{
  const f=await fixture(t),port=new URL(f.base).port,descriptor=join(f.directory,'second.json');
  const next=await startLocalServer({...f.options,descriptorPath:descriptor,port:Number(port)});
  try{assert.notEqual(next.info().baseUrl,f.base);assert.equal((await fetch(next.info().apiUrl+'/snapshot',{headers:{authorization:`Bearer ${f.connection.token}`}})).status,401);}finally{next.close();}
  assert.equal(existsSync(descriptor),false);f.server.close();assert.equal(existsSync(f.options.descriptorPath),false);
});

test('局域网直接访问无需密码；切换密码保护会撤销旧登录，MCP 始终需要密钥',async t=>{
  const f=await fixture(t,{},fetchFresh),local=await f.call('/api/v1/session',{auth:false,method:'POST',headers:{'X-Wanxiang-Client':'browser','Sec-Fetch-Site':'same-origin',Origin:f.base}});
  const localCookie=local.headers.get('set-cookie').split(';')[0];
  const info=await f.server.setLanEnabled(true);assert.equal(info.listenHost,'0.0.0.0');assert.equal(info.baseUrl,f.base);
  assert.equal((await f.call('/api/v1/snapshot')).status,200);
  assert.ok(info.lanUrls.length,'This LAN integration test requires an IPv4 network interface');
  const lan=info.lanUrls[0],remote=(path,init={})=>fetchFresh(lan+path,{...init,headers:{Origin:lan,...init.headers}});
  assert.equal((await remote('/')).status,200);
  assert.equal((await remote('/api/v1/snapshot')).status,401);
  assert.equal((await remote('/api/v1/snapshot',{headers:{authorization:'Bearer '+f.connection.token,cookie:localCookie}})).status,401);
  const direct=await remote('/api/v1/session',{method:'POST',headers:{'X-Wanxiang-Client':'browser'}});assert.equal(direct.status,200);const directCookie=direct.headers.get('set-cookie').split(';')[0];
  assert.equal((await remote('/api/v1/snapshot',{headers:{cookie:directCookie}})).status,200);
  assert.equal((await remote('/mcp',{method:'POST',headers:{cookie:directCookie}})).status,401);
  const lanClient=new Client({name:'wanxiang-lan-sdk-test',version:'1'});
  await lanClient.connect(new StreamableHTTPClientTransport(new URL(lan+'/mcp'),{requestInit:{headers:f.server.mcpConfig().headers}}));
  assert.equal((await lanClient.listTools()).tools.length,4);await lanClient.close();
  f.server.setBrowserAccessMode('password');assert.equal((await remote('/api/v1/snapshot',{headers:{cookie:directCookie}})).status,401);
  assert.equal((await remote('/api/v1/session',{method:'POST',headers:{'X-Wanxiang-Client':'browser'}})).status,401);
  const pairing=f.server.createPairing(),pair=password=>remote('/api/v1/session',{method:'POST',headers:{'X-Wanxiang-Client':'browser','Content-Type':'application/json'},body:JSON.stringify({password,remember:false})});
  const paired=await pair(pairing.code);assert.equal(paired.status,200);assert.ok(!paired.headers.get('set-cookie').includes('Max-Age'));const cookie=paired.headers.get('set-cookie').split(';')[0];
  assert.equal((await pair(pairing.code)).status,401);
  assert.equal((await remote('/api/v1/snapshot',{headers:{cookie}})).status,200);
  const remoteInfo=await value(await remote('/api/v1/info',{headers:{cookie}}));assert.equal(remoteInfo.baseUrl,lan);assert.equal(remoteInfo.descriptorPath,'');assert.ok(!JSON.stringify(remoteInfo).includes(f.server.mcpConfig().headers.Authorization));
  assert.equal((await remote('/api/v1/session',{method:'POST',headers:{cookie,'X-Wanxiang-Client':'browser'}})).status,200);
  const disabled=await f.server.setLanEnabled(false);assert.equal(disabled.listenHost,'127.0.0.1');assert.deepEqual(disabled.lanUrls,[]);
  await f.server.setLanEnabled(true);assert.equal((await remote('/api/v1/snapshot',{headers:{cookie}})).status,401);
  assert.equal((await f.call('/api/v1/snapshot',{auth:false,headers:{cookie:localCookie}})).status,200);
});

test('官方 MCP 客户端完成真实 HTTP 握手、工具发现、编辑、冲突检查和图片导入',async t=>{
  const f=await fixture(t),config=f.server.mcpConfig();
  const client=new Client({name:'wanxiang-sdk-test',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}});
  await client.connect(transport);t.after(()=>client.close());
  assert.equal(client.getServerVersion().name,'wanxiang-workshop');assert.ok(client.getServerCapabilities().tools);
  await client.ping();
  const list=await client.listTools();assert.deepEqual(list.tools.map(t=>t.name),['read_library','describe_operations','call_operation','import_image']);
  const call=(name,args)=>client.callTool({name,arguments:args});
  const read=await call('read_library',{}),snapshot=JSON.parse(read.content[0].text);assert.equal(snapshot.worlds.length,2);
  const schema=await call('describe_operations',{operation:'saveWork'});assert.deepEqual(JSON.parse(schema.content[0].text).operations.map(o=>o.name),['saveWork']);
  const args={operation:'saveWork',args:[{id:'work-a',name:'MCP 编辑',expectedVersion:0}],generation:snapshot.generation};
  assert.equal((await call('call_operation',args)).isError,false);assert.equal(f.store.workspace.getWork('work-a').name,'MCP 编辑');
  const conflict=await call('call_operation',args);assert.equal(conflict.isError,true);assert.equal(JSON.parse(conflict.content[0].text).code,'CONFLICT');
  const image=await call('import_image',{worldId:'a',name:'mcp.png',base64:png.toString('base64'),generation:snapshot.generation});assert.equal(image.isError,false);assert.ok(f.store.getAsset(JSON.parse(image.content[0].text).id));
  const estimate=await value(await f.command('estimateBackup',[])),baseline=await value(await f.command('createBackupBaseline',[estimate])),preview=await value(await f.command('previewBackupRestore',[baseline.point.id]));await value(await f.command('restoreBackup',[preview.token]));
  const stale=await call('call_operation',{...args,args:[{id:'work-a',name:'旧代次',expectedVersion:1}]});assert.equal(stale.isError,true);assert.equal(JSON.parse(stale.content[0].text).code,'RESTORED');
});

test('HTTP 与官方 MCP 共用历史读取、预览和回退，读取不广播修改',async t=>{
  const f=await fixture(t),config=f.server.mcpConfig(),generation=f.store.snapshot().generation;
  const first=f.store.workspace.saveWork({id:'work-a',name:'初版名称',expectedVersion:0});f.store.workspace.saveWork({id:'work-a',name:'当前名称',expectedVersion:first.version});
  const selection={kind:'work',entityId:'work-a',version:first.version},revision=f.commands.revision(),sequence=f.store.journal.sequence();
  const page=await value(await f.command('listHistory',[selection]));assert.equal(page.records.length,2);
  const detail=await value(await f.command('getHistory',[selection]));assert.ok(detail.differences.some(d=>d.field==='name'));
  assert.equal((await f.command('listHistory',[selection],{auth:false})).status,401);
  const client=new Client({name:'wanxiang-history-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}}));t.after(()=>client.close());
  const schema=await client.callTool({name:'describe_operations',arguments:{operation:'restoreHistory'}});assert.equal(JSON.parse(schema.content[0].text).operations[0].name,'restoreHistory');
  const raw=await client.callTool({name:'call_operation',arguments:{operation:'previewHistoryRestore',args:[selection],generation}});assert.equal(raw.isError,false);const preview=JSON.parse(raw.content[0].text);
  assert.equal(f.commands.revision(),revision);assert.equal(f.store.journal.sequence(),sequence);
  const restored=await value(await f.command('restoreHistory',[{token:preview.token}]));assert.equal(restored.version,3);assert.equal(f.store.workspace.getWork('work-a').name,'初版名称');
  assert.notEqual(f.commands.revision(),revision);assert.equal((await f.command('restoreHistory',[{token:preview.token}])).status,409);
});

test('MCP 拒绝缺少认证、恶意来源和无效协议；错误使用 JSON-RPC 返回',async t=>{
  const f=await fixture(t),config=f.server.mcpConfig(),headers={...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body=JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'});
  assert.equal((await fetch(config.url,{method:'POST',body})).status,401);
  assert.equal((await fetch(config.url,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body})).status,403);
  assert.equal((await fetch(config.url,{headers:config.headers})).status,405);
  assert.equal((await fetch(config.url,{method:'DELETE',headers:config.headers})).status,405);
  assert.equal((await fetch(config.url,{method:'POST',headers:{...headers,'MCP-Protocol-Version':'bad'},body})).status,400);
  assert.equal((await fetch(config.url,{method:'POST',headers:{...headers,Accept:'application/json'},body})).status,406);
  for(const input of ['{',JSON.stringify({jsonrpc:'2.0',id:1}),JSON.stringify({jsonrpc:'2.0',id:1,method:'bad'})]){
    const response=await fetch(config.url,{method:'POST',headers,body:input});assert.equal(typeof (await response.json()).error.code,'number');
  }
  const invalid=await fetch(config.url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'call_operation',arguments:{operation:'saveWork',args:[]}}})});assert.equal((await invalid.json()).result.isError,true);
  for(const operation of ['setLanEnabled','setBrowserAccessMode','clearBrowserSessions','getMcpConfig','createConnectionPairing','rotateConnectionCredentials'])assert.equal((await f.command(operation,[])).status,404);
  f.server.rotateCredentials();assert.equal((await fetch(config.url,{method:'POST',headers,body})).status,401);
  assert.equal((await fetch(config.url,{method:'POST',headers:{...headers,...f.server.mcpConfig().headers},body})).status,200);
});

test('记住登录的 HTTP cookie 跨服务重启有效；清除登录立即撤销，密码和原始凭证不落盘',async t=>{
  const f=await fixture(t),file=join(f.directory,'connection-settings.json');
  await f.server.setLanEnabled(true);f.server.setBrowserAccessMode('password');
  const lan=f.server.info().lanUrls[0],password=f.server.createPairing().code;
  const response=await fetch(lan+'/api/v1/session',{method:'POST',headers:{Origin:lan,'X-Wanxiang-Client':'browser','Content-Type':'application/json'},body:JSON.stringify({password,remember:true})});
  assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie'),cookie=setCookie.split(';')[0];
  assert.match(setCookie,/Max-Age=2592000/);assert.ok(!readFileSync(file,'utf8').includes(cookie.split('=')[1]));assert.ok(!readFileSync(file,'utf8').includes(password));
  f.server.close();
  const restarted=await startLocalServer({...f.options,access:new ConnectionAccess(file),descriptorPath:join(f.directory,'restart.json')});t.after(()=>restarted.close());
  const address=restarted.info().lanUrls[0];
  assert.equal((await fetch(address+'/api/v1/snapshot',{headers:{cookie}})).status,200);
  const reconnect=await fetch(address+'/api/v1/session',{method:'POST',headers:{Origin:address,'X-Wanxiang-Client':'browser',cookie}});assert.equal(reconnect.status,200);
  restarted.createPairing();assert.equal((await fetch(address+'/api/v1/snapshot',{headers:{cookie}})).status,200);
  restarted.clearBrowserSessions();assert.equal((await fetch(address+'/api/v1/snapshot',{headers:{cookie}})).status,401);
  assert.equal(new ConnectionAccess(file).rememberedDeviceCount,0);
});

test('旧连接配置升级保留 MCP 密钥，已开放的局域网不会被静默改成免密码',async t=>{
  const f=await fixture(t),file=join(f.directory,'legacy.json'),key='a'.repeat(64);
  writeFileSync(file,JSON.stringify({version:1,lanEnabled:true,key}));
  const access=new ConnectionAccess(file);assert.equal(access.accessMode,'password');assert.equal(access.acceptsKey(key),true);assert.equal(JSON.parse(readFileSync(file,'utf8')).version,2);
  assert.throws(()=>access.login(undefined),e=>e.code==='UNAUTHORIZED');
  access.setAccessMode('direct');const direct=access.login(undefined).token;assert.equal(access.acceptsSession(direct),true);
  access.setAccessMode('password');assert.equal(access.acceptsSession(direct),false);
  writeFileSync(file,'{"version":2,"lanEnabled":true,"key":"broken"}');assert.throws(()=>new ConnectionAccess(file),e=>e.code==='VALIDATION');
});

test('切换监听地址会等待正在上传的资料保存完成',async t=>{
  const f=await fixture(t),bytes=Buffer.from(JSON.stringify({args:[{id:'work-a',name:'切换中保存',expectedVersion:0}]}));
  const requestDone=new Promise((done,reject)=>{
    const req=request(f.base+'/api/v1/commands/saveWork',{method:'POST',headers:{Authorization:'Bearer '+f.connection.token,'Content-Type':'application/json','Content-Length':bytes.length}},res=>{res.resume();res.on('end',()=>done(res.statusCode));});req.on('error',reject);req.write(bytes.subarray(0,8));
    f.upload=req;
  });
  await new Promise(done=>setTimeout(done,30));
  let switched=false;const switching=f.server.setLanEnabled(true).then(()=>{switched=true;});
  await new Promise(done=>setTimeout(done,30));assert.equal(switched,false);
  f.upload.end(bytes.subarray(8));assert.equal(await requestDone,200);await switching;
  assert.equal(f.store.workspace.getWork('work-a').name,'切换中保存');
});

test('临时密码限时限次；记住登录跨重启保留 30 天，清除登录与 MCP 密钥相互独立',async t=>{
  const f=await fixture(t),file=join(f.directory,'access.json');let now=1000;
  const access=new ConnectionAccess(file,()=>now);assert.equal(access.lanEnabled,false);
  assert.throws(()=>access.createPairing(),e=>e.code==='VALIDATION');
  access.saveMode(true);access.setAccessMode('password');const credential=access.credentials().authorization.slice(7);
  const restarted=new ConnectionAccess(file,()=>now);assert.equal(restarted.lanEnabled,true);assert.equal(restarted.acceptsKey(credential),true);
  const one=access.createPairing(),session=access.login(one.code,true).token;assert.equal(access.acceptsSession(session),true);assert.throws(()=>access.login(one.code),e=>e.code==='UNAUTHORIZED');
  const restartedWithLogin=new ConnectionAccess(file,()=>now);assert.equal(restartedWithLogin.id,access.id);assert.equal(restartedWithLogin.acceptsSession(session),true);assert.equal(restartedWithLogin.rememberedDeviceCount,1);assert.ok(!readFileSync(file,'utf8').includes(session));
  const temporary=access.login(access.createPairing().code,false).token;assert.equal(new ConnectionAccess(file,()=>now).acceptsSession(temporary),false);
  const expired=access.createPairing();now+=300001;assert.throws(()=>access.login(expired.code),e=>e.code==='UNAUTHORIZED');
  const limited=access.createPairing();for(let i=0;i<10;i++)assert.throws(()=>access.login('bad'),e=>e.code==='UNAUTHORIZED');assert.throws(()=>access.login(limited.code),e=>e.code==='UNAUTHORIZED');
  access.rotate();assert.equal(access.acceptsKey(credential),false);assert.equal(access.acceptsSession(session),true);
  access.createPairing();assert.equal(access.acceptsSession(session),true);
  now+=29*86400000;assert.equal(access.acceptsSession(session),true);now+=86400000;assert.equal(access.acceptsSession(session),false);
  const fresh=access.login(access.createPairing().code,true).token,key=access.credentials().authorization;access.clearBrowserSessions();assert.equal(access.acceptsSession(fresh),false);assert.equal(access.credentials().authorization,key);assert.equal(new ConnectionAccess(file,()=>now).acceptsSession(fresh),false);
  access.saveMode(false);assert.equal(new ConnectionAccess(file).lanEnabled,false);
});


test('永久删除通过 HTTP 与 MCP 共用预览、认证、代次及一次性令牌',async t=>{
 const f=await fixture(t),generation=f.store.snapshot().generation;
 assert.equal((await f.command('previewDeletion',[{kind:'work',id:'work-a'}],{auth:false})).status,401);
 const p=await value(await f.command('previewDeletion',[{kind:'work',id:'work-a'}]));assert.equal(p.target.name,'甲作品');assert.deepEqual(p.blockers,[]);
 const client=new Client({name:'deletion-test',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+f.connection.token}}});
 await client.connect(transport);t.after(()=>client.close());
 const parse=r=>{assert.equal(r.isError,false,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
 const contract=parse(await client.callTool({name:'describe_operations',arguments:{operation:'deleteContent'}}));assert.match(contract.definitions,/interface DeletionTarget/);assert.equal(contract.operations[0].name,'deleteContent');
 const result=parse(await client.callTool({name:'call_operation',arguments:{operation:'deleteContent',args:[{token:p.token,name:p.target.name}],generation}}));assert.equal(result.activeWorkId,'work-b');
 assert.equal((await f.command('deleteContent',[{token:p.token,name:p.target.name}])).status,409);
 const stale=await f.command('previewDeletion',[{kind:'work',id:'work-b'}],{body:JSON.stringify({args:[{kind:'work',id:'work-b'}],generation:'old'})});assert.equal(stale.status,409);
 const p2=parse(await client.callTool({name:'call_operation',arguments:{operation:'previewDeletion',args:[{kind:'work',id:'work-b'}],generation}}));
 const gone=await value(await f.command('deleteContent',[{token:p2.token,name:p2.target.name}]));assert.equal(gone.activeWorkId,null);assert.deepEqual(f.store.snapshot().works,[]);
});

test('资料配置和类别删除在 HTTP、MCP 共用版本、认证、恢复代次与预览规则',async t=>{
  const f=await fixture(t),generation=f.store.snapshot().generation,c=f.store.config.get('a');
  const input={...c,expectedVersion:c.version,groups:{...c.groups,item:{...c.groups.item,categories:[...c.groups.item.categories,{id:'new-category',name:'自定类别',active:true}]}}};
  assert.equal((await f.command('saveLibraryConfig',[input],{auth:false})).status,401);
  const saved=await value(await f.command('saveLibraryConfig',[input]));assert.equal(saved.groups.item.categories.at(-1).name,'自定类别');
  assert.equal((await f.command('saveLibraryConfig',[input])).status,409);
  const client=new Client({name:'config-test',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+f.connection.token}}});await client.connect(transport);t.after(()=>client.close());
  const parse=r=>{assert.equal(r.isError,false,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
  const contract=parse(await client.callTool({name:'describe_operations',arguments:{operation:'saveLibraryConfig'}}));assert.match(contract.definitions,/interface LibraryConfigInput/);
  const updated=parse(await client.callTool({name:'call_operation',arguments:{operation:'saveLibraryConfig',args:[{...saved,expectedVersion:saved.version,groups:{...saved.groups,item:{...saved.groups.item,categories:saved.groups.item.categories.map(c=>c.id==='new-category'?{...c,name:'改名类别'}:c)}}}],generation}}));
  const item=await value(await f.command('saveItem',[{...blankCatalog('item','a'),name:'引用类别',categoryId:'new-category'}]));
  const p=parse(await client.callTool({name:'call_operation',arguments:{operation:'previewDeletion',args:[{kind:'catalogCategory',catalogKind:'item',parentId:'a',id:'new-category',replacementId:'prop'}],generation}}));
  await value(await f.command('deleteContent',[{token:p.token,name:'改名类别'}]));assert.equal(f.store.catalogs.get('item',item.id).categoryId,'prop');
  assert.equal((await f.command('saveLibraryConfig',[{...updated,expectedVersion:updated.version}],{body:JSON.stringify({args:[{...updated,expectedVersion:updated.version}],generation:'old'})})).status,409);
});
