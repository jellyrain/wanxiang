import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';

const root=resolve('test-results/skill-connection-tests');mkdirSync(root,{recursive:true});
const scripts=resolve(process.env.WANXIANG_TEST_SKILL_SCRIPTS??'skills/wanxiang-workshop/scripts');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const runtimes=process.platform==='win32'?['powershell.exe','pwsh.exe'].filter(shell=>spawnSync(shell,['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{windowsHide:true,encoding:'utf8'}).status===0):[];
assert.ok(process.platform!=='win32'||runtimes.includes('powershell.exe'),'Windows PowerShell 5.1 must be tested');
function run(shell,body){return new Promise((resolve,reject)=>{
  const source="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"+body;
  const p=spawn(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{p.kill();reject(Error('PowerShell test timed out'));},20000);
  p.stdout.on('data',v=>stdout+=v.toString('utf8'));p.stderr.on('data',v=>stderr+=v.toString('utf8'));p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);if(code!==0){reject(Error(`PowerShell exited ${code}: ${stderr}\n${stdout}`));return;}try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(Error(`Invalid test output: ${stdout}\n${stderr}`));}});
});}
function fixture(t){
  const directory=mkdtempSync(join(root,'case-')),token='cd'.repeat(32),instanceId=randomUUID(),path=join(directory,'connection.json'),args=join(directory,'arguments.json');
  writeFileSync(args,JSON.stringify([{name:'test-only',expectedVersion:1}]));
  t.after(()=>{const target=realpathSync(directory);if(dirname(target).toLowerCase()!==realpathSync(root).toLowerCase()||!basename(target).startsWith('case-'))throw Error('Unsafe test cleanup');rmSync(target,{recursive:true,force:true});});
  const descriptor=baseUrl=>writeFileSync(path,JSON.stringify({baseUrl,token,instanceId}));
  return {directory,path,args,token,instanceId,descriptor};
}
async function server(t,f,handler){
  const requests=[];const s=createServer((req,res)=>{requests.push({url:req.url,authorization:req.headers.authorization,method:req.method});handler(req,res);});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${s.address().port}`;f.descriptor(base);
  t.after(()=>{s.closeAllConnections();s.close();});return {base,requests,s};
}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
const health=f=>({ok:true,value:{name:'万象工坊',instanceId:f.instanceId}});
function invoke(shell,f,extra='',before=''){
  return run(shell,`${before};try{$v=& ${quote(join(scripts,'invoke-workshop.ps1'))} -DescriptorPath ${quote(f.path)} ${extra};[pscustomobject]@{ok=$true;value=($v|ConvertFrom-Json)}|ConvertTo-Json -Depth 20 -Compress}catch{[pscustomobject]@{ok=$false;message=$_.Exception.Message}|ConvertTo-Json -Compress}`);
}
function failure(result,code,f){assert.equal(result.ok,false);assert.match(result.message,new RegExp('\\['+code+'\\]'));assert.ok(!result.message.includes(f.token),'Do not expose connection token');assert.ok(!result.message.includes('SENSITIVE_SENTINEL'),'Do not expose exception/HTTP content');}

for(const shell of runtimes){
  test(`${shell}: 按异常链识别权限、拒绝、超时及取消，未知错误不猜测且不泄露原文`,async()=>{
    const rows=await run(shell,`. ${quote(join(scripts,'connection-errors.ps1'))};Add-Type -AssemblyName System.Net.Http;
      $secret='SENSITIVE_SENTINEL Bearer '+('cd'*32);$cases=@();
      $cases+=@{want='CONNECTION_ACCESS_DENIED';error=[Net.Http.HttpRequestException]::new($secret,[Net.Sockets.SocketException]::new(10013))};
      $cases+=@{want='CONNECTION_ACCESS_DENIED';error=[Net.WebException]::new($secret,[Net.Sockets.SocketException]::new(10013),[Net.WebExceptionStatus]::ConnectFailure,$null)};
      $cases+=@{want='CONNECTION_ACCESS_DENIED';error=[AggregateException]::new($secret,[Exception[]]@([Net.Sockets.SocketException]::new(10061),[Net.Sockets.SocketException]::new(10013)))};
      $cases+=@{want='CONNECTION_ACCESS_DENIED';error=[UnauthorizedAccessException]::new($secret)};
      $cases+=@{want='CONNECTION_ACCESS_DENIED';error=[ComponentModel.Win32Exception]::new(5,$secret)};
      $cases+=@{want='CONNECTION_REFUSED';error=[Net.Http.HttpRequestException]::new($secret,[Net.Sockets.SocketException]::new(10061))};
      $cases+=@{want='CONNECTION_TIMEOUT';error=[Net.Sockets.SocketException]::new(10060)};
      $cases+=@{want='CONNECTION_TIMEOUT';error=[Net.WebException]::new($secret,[Net.WebExceptionStatus]::Timeout)};
      $cases+=@{want='CONNECTION_TIMEOUT';error=[TimeoutException]::new($secret)};
      $cases+=@{want='CONNECTION_CANCELLED';error=[Threading.Tasks.TaskCanceledException]::new($secret)};
      $cases+=@{want='CONNECTION_FAILED';error=[Exception]::new('AccessDenied ConnectionRefused '+$secret)};
      $results=@(foreach($case in $cases){$record=[Management.Automation.ErrorRecord]::new($case.error,'Synthetic',[Management.Automation.ErrorCategory]::NotSpecified,$null);[pscustomobject]@{want=$case.want;actual=(Get-WorkshopTransportFailure $record)}});ConvertTo-Json -InputObject $results -Depth 6 -Compress`);
    assert.equal(rows.length,11);for(const row of rows){assert.equal(row.actual.Code,row.want);assert.ok(!JSON.stringify(row.actual).includes('SENSITIVE_SENTINEL'));assert.ok(!JSON.stringify(row.actual).includes('cd'.repeat(32)));assert.match(row.actual.Diagnostics,/异常类型=/);}
    assert.match(rows[0].actual.Diagnostics,/SocketError=AccessDenied/);assert.match(rows[0].actual.Diagnostics,/NativeError=10013/);
  });
  test(`${shell}: 健康检查访问受限时立即停止，后续认证与内容请求不发送`,async t=>{
    const f=fixture(t);f.descriptor('http://127.0.0.1:1');
    const r=await invoke(shell,f,'',`Add-Type -AssemblyName System.Net.Http;function Invoke-RestMethod {param($Uri) if(-not $Uri.EndsWith('/health')){throw 'unexpected authenticated request'};throw [Net.Http.HttpRequestException]::new('SENSITIVE_SENTINEL',[Net.Sockets.SocketException]::new(10013))}`);
    failure(r,'CONNECTION_ACCESS_DENIED',f);assert.match(r.message,/健康检查/);
  });
  test(`${shell}: 正常读取保留 JSON 返回和认证，健康检查不携带密钥`,async t=>{
    const f=fixture(t);const {requests}=await server(t,f,(req,res)=>json(res,req.url.endsWith('/health')?health(f):{ok:true,value:{generation:'example',works:[]}}));
    const r=await invoke(shell,f);assert.equal(r.ok,true,r.message);assert.equal(r.value.value.generation,'example');assert.deepEqual(requests.map(r=>r.url),['/api/v1/health','/api/v1/snapshot']);assert.equal(requests[0].authorization,undefined);assert.equal(requests[1].authorization,'Bearer '+f.token);
  });
  test(`${shell}: 真实端口拒绝连接单独分类`,async t=>{
    const f=fixture(t),s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));f.descriptor(`http://127.0.0.1:${s.address().port}`);await new Promise(r=>s.close(r));failure(await invoke(shell,f),'CONNECTION_REFUSED',f);
  });
  test(`${shell}: 真实健康请求超时保留类型，不转述为软件退出`,async t=>{
    const f=fixture(t),{requests}=await server(t,f,()=>{});const r=await invoke(shell,f);assert.equal(r.ok,false);assert.match(r.message,/\[CONNECTION_(TIMEOUT|CANCELLED)\]/);assert.match(r.message,/异常类型=/);assert.equal(requests.length,1);assert.ok(!r.message.includes(f.token));
  });
  for(const mode of ['instance','invalid','http'])test(`${shell}: ${mode} 健康失败不发送认证请求`,async t=>{
    const f=fixture(t),{requests}=await server(t,f,(_req,res)=>mode==='instance'?json(res,{ok:true,value:{name:'万象工坊',instanceId:randomUUID()}}):mode==='invalid'?json(res,{ok:false,error:{message:'SENSITIVE_SENTINEL '+f.token}}):json(res,{message:'SENSITIVE_SENTINEL '+f.token},403));
    const r=await invoke(shell,f);failure(r,mode==='instance'?'CONNECTION_INSTANCE_MISMATCH':mode==='invalid'?'CONNECTION_HEALTH_INVALID':'CONNECTION_HTTP_ERROR',f);assert.equal(requests.length,1);assert.equal(requests[0].authorization,undefined);if(mode==='http')assert.match(r.message,/HTTP=403/);
  });
  test(`${shell}: 内容请求收到 HTTP 错误时保留状态，不泄露正文或请求头`,async t=>{
    const f=fixture(t);await server(t,f,(req,res)=>req.url.endsWith('/health')?json(res,health(f)):(res.writeHead(401,{'Content-Type':'text/plain'}),res.end('SENSITIVE_SENTINEL Bearer '+f.token)));
    const r=await invoke(shell,f);failure(r,'CONNECTION_HTTP_ERROR',f);assert.match(r.message,/HTTP=401/);assert.match(r.message,/接口请求/);
  });
  test(`${shell}: CONFLICT 业务错误原样保留错误码并隐去连接密钥`,async t=>{
    const f=fixture(t);await server(t,f,(req,res)=>json(res,req.url.endsWith('/health')?health(f):{ok:false,error:{code:'CONFLICT',message:'资料已有新修改 '+f.token}},req.url.endsWith('/health')?200:409));
    const r=await invoke(shell,f);assert.equal(r.ok,false);assert.match(r.message,/^CONFLICT:/);assert.match(r.message,/资料已有新修改/);assert.ok(!r.message.includes(f.token));
  });
  test(`${shell}: 保存后响应断开不会重发写入，并提示先读回核对`,async t=>{
    const f=fixture(t),generation=randomUUID();let received;
    const {requests}=await server(t,f,(req,res)=>{if(req.url.endsWith('/health'))return json(res,health(f));let body='';req.on('data',v=>body+=v);req.on('end',()=>{received=JSON.parse(body);res.socket.destroy();});});
    const r=await invoke(shell,f,`-Endpoint command -Operation saveWorld -ArgumentsFile ${quote(f.args)} -Generation ${quote(generation)}`);
    failure(r,'CONNECTION_FAILED',f);assert.match(r.message,/请求可能已经送达/);assert.match(r.message,/不自动重发/);assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.equal(received.generation,generation);assert.equal(received.args[0].name,'test-only');
  });
  test(`${shell}: 连接文件缺失与损坏不再推断软件未运行，错误中不含原文`,async t=>{
    const f=fixture(t);failure(await invoke(shell,f),'CONNECTION_DESCRIPTOR_MISSING',f);writeFileSync(f.path,'{"token":"'+f.token+'" SENSITIVE_SENTINEL');failure(await invoke(shell,f),'CONNECTION_DESCRIPTOR_INVALID',f);
  });
}
