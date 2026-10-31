import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, extname, join, basename } from 'node:path';
import { ContentError, type LibraryStore } from './store.ts';
import type { ContentCommands } from './commands.ts';
import type { LocalConnection } from '../shared/api.ts';
import type { BackupService } from './backups.ts';
import { BACKUP_CHANNELS } from '../shared/backup.ts';
import {ConnectionAccess,equalSecret as same,isLoopback,lanAddresses} from './connection-access.ts';
import {createMcpHandler} from './mcp.ts';
import {readSkillPackage} from './skill-packages.ts';

const JSON_LIMIT=16*1024*1024,IMAGE_LIMIT=25*1024*1024;
const inside=(root:string,path:string)=>{const p=relative(root,path);return p!== '..'&&!p.startsWith(`..${process.platform==='win32'?'\\':'/'}`)&&!isAbsolute(p);};
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
type Options={store:LibraryStore;commands:ContentCommands;backups?:BackupService;access?:ConnectionAccess;uiDirectory:string;skillDirectory?:string;descriptorPath:string;contract:unknown;port?:number;decodeImage:(bytes:Buffer)=>{width:number;height:number}};

function reply(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));}
const success=(r:ServerResponse,value:unknown)=>reply(r,200,{ok:true,value:value===undefined?null:value});
function fail(response:ServerResponse,error:unknown){
  const known=error instanceof ContentError,code=known?error.code:'INTERNAL';
  const status=({VALIDATION:400,UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,RESTORED:409,BUSY:409,BASELINE_REQUIRED:409,SCHEMA_CHANGED:409,DEPENDENCY:409,BACKUP_INVALID:422,JOURNAL_GAP:422,TOO_LARGE:413,UNAVAILABLE:503} as Record<string,number>)[code]??500;
  if(!known)console.error('[本地接口]',error);
  if(!response.headersSent)reply(response,status,{ok:false,error:{code,message:known?error.message:'操作未完成，请重试。'}});else response.end();
}
async function body(req:IncomingMessage,limit:number){
  if(Number(req.headers['content-length'])>limit)throw new ContentError('TOO_LARGE','提交内容超过大小限制。');
  return new Promise<Buffer>((done,reject)=>{
    const parts:Buffer[]=[];let size=0;
    const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
    const error=(e:Error)=>{cleanup();reject(e);};
    const aborted=()=>error(new ContentError('VALIDATION','上传已中断。'));
    const end=()=>{cleanup();done(Buffer.concat(parts));};
    const data=(chunk:Buffer)=>{size+=chunk.length;if(size>limit){cleanup();req.resume();reject(new ContentError('TOO_LARGE','提交内容超过大小限制。'));return;}parts.push(chunk);};
    req.on('data',data);req.on('end',end);req.on('error',error);req.on('aborted',aborted);
  });
}

export async function startLocalServer(options:Options) {
  const {store,commands}=options,token=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex');
  const access=options.access??new ConnectionAccess();
  const cookieName=`wanxiang_${access.id}`;
  let baseUrl='',closed=false,changing=false,listenHost=access.lanEnabled?'0.0.0.0':'127.0.0.1';
  const lanUrls=()=>access.lanEnabled?lanAddresses().map(ip=>`http://${ip}:${new URL(baseUrl).port}`):[];
  const info=():LocalConnection=>({available:!closed,baseUrl,apiUrl:`${baseUrl}/api/v1`,descriptorPath:options.descriptorPath,lanEnabled:access.lanEnabled,listenHost,lanUrls:lanUrls(),mcpUrl:`${baseUrl}/mcp`,browserAccessMode:access.accessMode,rememberedDeviceCount:access.rememberedDeviceCount});
  const invoke=async(name:string,args:unknown[],generation?:string)=>{
    if(Object.hasOwn(BACKUP_CHANNELS,name)){
      if(!options.backups)throw new ContentError('UNAVAILABLE','备份服务尚未启用。');
      return options.backups.invoke(name,args);
    }
    return commands.invoke(name,args,generation);
  };
  const mcp=createMcpHandler({contract:options.contract,invoke,importImage:(worldId,name,bytes,generation)=>{
    store.gallery.catalog(worldId);const dimensions=options.decodeImage(bytes);store.assertWritable(generation);
    const asset=store.importImage(worldId,bytes,basename(name),dimensions);commands.changed();return asset;
  }});
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',csp);
    void (async()=>{
      if(closed)throw new ContentError('UNAVAILABLE','服务已关闭。');
      // Exact Host plus Origin checks protect localhost data against DNS rebinding and cross-site requests.
      const origin=`http://${req.headers.host}`;
      if(![baseUrl,...lanUrls()].includes(origin))throw new ContentError('FORBIDDEN','请使用软件显示的连接地址。');
      if(req.headers.origin&&req.headers.origin!==origin)throw new ContentError('FORBIDDEN','请求来源不允许访问此资料库。');
      if(req.headers['sec-fetch-site']==='cross-site')throw new ContentError('FORBIDDEN','请求来源不允许访问此资料库。');
      const rawPath=(req.url??'/').split('?')[0];
      let path:string;try{path=decodeURIComponent(rawPath);}catch{throw new ContentError('VALIDATION','地址格式不正确。');}
      if(!path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(p=>p==='..'||p==='.'))throw new ContentError('FORBIDDEN','地址不允许访问。');
      const url=new URL(req.url??'/',baseUrl),method=req.method??'GET';
      const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
      const cookie=(req.headers.cookie??'').split(';').map(p=>p.trim()).find(p=>p.startsWith(`${cookieName}=`))?.slice(cookieName.length+1)??'';
      const local=isLoopback(req.socket.remoteAddress)&&origin===baseUrl;
      const browserAuthorized=(local&&same(cookie,session))||access.acceptsSession(cookie);
      const bearerAuthorized=(local&&same(bearer,token))||access.acceptsKey(bearer);
      if(path==='/mcp'){
        if(!bearerAuthorized){res.setHeader('WWW-Authenticate','Bearer realm="wanxiang-workshop"');return reply(res,401,{jsonrpc:'2.0',error:{code:-32001,message:'Bearer token required'}});}
        return await mcp(req,res);
      }
      if(path==='/api/v1/health'&&method==='GET')return success(res,{name:'万象工坊',apiVersion:1,instanceId:commands.instanceId});
      if(path==='/api/v1/session'&&method==='POST'){
        if((req.headers['sec-fetch-site']!=='same-origin'&&req.headers.origin!==origin)||req.headers['x-wanxiang-client']!=='browser')throw new ContentError('FORBIDDEN','请从万象工坊网页内建立连接。');
        if(browserAuthorized)return success(res,null);
        let value=session,maxAge:number|undefined;
        if(!local){
          let input:unknown;try{input=JSON.parse((await body(req,1024)).toString('utf8')||'{}');}catch{throw new ContentError('VALIDATION','登录信息格式不正确。');}
          if(!input||typeof input!=='object'||Array.isArray(input))throw new ContentError('VALIDATION','登录信息格式不正确。');
          const credentials=input as {password?:unknown;remember?:unknown};
          const login=access.login(credentials.password,credentials.remember??false);value=login.token;maxAge=login.maxAge;
        }
        res.setHeader('Set-Cookie',`${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api/${maxAge===undefined?'':`; Max-Age=${maxAge}`}`);return success(res,null);
      }
      if(path.startsWith('/api/')){
        if(!bearerAuthorized&&!browserAuthorized)throw new ContentError('UNAUTHORIZED','登录已过期，请刷新网页或重新输入临时密码。');
        if(path.startsWith('/api/v1/skills/')&&method==='GET'){
          const pack=readSkillPackage(options.skillDirectory,path.slice('/api/v1/skills/'.length));
          res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${pack.fileName}"`,'Content-Length':pack.bytes.length});res.end(pack.bytes);return;
        }
        if(path==='/api/v1/info'&&method==='GET')return success(res,{...info(),baseUrl:origin,apiUrl:`${origin}/api/v1`,mcpUrl:`${origin}/mcp`,descriptorPath:local?options.descriptorPath:''});
        if(path==='/api/v1/revision'&&method==='GET')return success(res,commands.revision());
        if(path==='/api/v1/schema'&&method==='GET')return success(res,options.contract);
        if(path==='/api/v1/snapshot'&&method==='GET')return success(res,commands.invoke('snapshot',[]));
        if(path.startsWith('/api/v1/commands/')&&method==='POST'){
          if(!req.headers['content-type']?.startsWith('application/json'))throw new ContentError('VALIDATION','请使用 application/json。');
          let data:unknown;try{data=JSON.parse((await body(req,path==='/api/v1/commands/previewTransferImport'?128*1024*1024:JSON_LIMIT)).toString('utf8'));}catch(e){if(e instanceof ContentError)throw e;throw new ContentError('VALIDATION','JSON 内容无法读取。');}
          if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,'args'))throw new ContentError('VALIDATION','请传入 {args:[...]}。');
          const name=path.slice('/api/v1/commands/'.length),input=data as {args:unknown;generation?:string};
          if(Object.hasOwn(BACKUP_CHANNELS,name)){
            if(!options.backups)throw new ContentError('UNAVAILABLE','备份服务尚未启用。');
            return success(res,await options.backups.invoke(name,input.args));
          }
          return success(res,commands.invoke(name,input.args,input.generation));
        }
        if(path==='/api/v1/assets'&&method==='POST'){
          const worldId=url.searchParams.get('worldId')??'',name=url.searchParams.get('name')??'image';
          if(!name||name.length>250)throw new ContentError('VALIDATION','图片文件名过长或为空。');
          store.gallery.catalog(worldId);
          const bytes=await body(req,IMAGE_LIMIT),dimensions=options.decodeImage(bytes);
          store.assertWritable(typeof req.headers['x-wanxiang-generation']==='string'?req.headers['x-wanxiang-generation']:undefined);
          const asset=store.importImage(worldId,bytes,basename(name),dimensions);commands.changed();return success(res,asset);
        }
        if(path.startsWith('/api/v1/assets/')&&method==='GET'){
          const asset=store.getAsset(path.slice('/api/v1/assets/'.length));
          if(!asset)throw new ContentError('NOT_FOUND','图片不存在。');
          let bytes:Buffer;try{bytes=readFileSync(join(store.mediaDir,asset.fileName));}catch{throw new ContentError('NOT_FOUND','图片文件无法读取。');}
          res.writeHead(200,{'Content-Type':asset.mime});res.end(bytes);return;
        }
        throw new ContentError('NOT_FOUND','没有这个接口。');
      }
      if(method!=='GET'&&method!=='HEAD')throw new ContentError('NOT_FOUND','没有这个页面。');
      const root=resolve(options.uiDirectory),target=resolve(root,'.'+(path==='/'?'/index.html':path));
      if(!inside(root,target)||!existsSync(target)||!statSync(target).isFile()||!inside(realpathSync(root),realpathSync(target)))throw new ContentError('NOT_FOUND','页面尚未构建，或文件不存在。');
      res.writeHead(200,{'Content-Type':mime[extname(target).toLowerCase()]??'application/octet-stream'});res.end(method==='HEAD'?undefined:readFileSync(target));
    })().catch(error=>{if(!req.complete&&!res.headersSent)res.setHeader('Connection','close');fail(res,error);});
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  const listen=(port:number,host:string)=>new Promise<void>((done,reject)=>{
    const error=(e:Error)=>{server.off('listening',listening);reject(e);};
    const listening=()=>{server.off('error',error);done();};
    server.once('error',error);server.once('listening',listening);server.listen(port,host);
  });
  const first=options.port??43127;
  if(!Number.isInteger(first)||first<0||first>65535)throw new ContentError('VALIDATION','本地服务端口设置不正确。');
  for(let attempt=0;attempt<10;attempt++){
    try{await listen(first===0?0:first+attempt,listenHost);break;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='EADDRINUSE'||attempt===9||first===0)throw e;}
  }
  const address=server.address();if(!address||typeof address==='string')throw Error('Local server did not bind');
  baseUrl=`http://127.0.0.1:${address.port}`;
  const writeDescriptor=()=>{mkdirSync(dirname(options.descriptorPath),{recursive:true});writeFileSync(options.descriptorPath,JSON.stringify({...info(),token,instanceId:commands.instanceId,pid:process.pid},null,2),{mode:0o600});};
  try{writeDescriptor();}
  catch(e){server.closeAllConnections();server.close();throw e;}
  const close=()=>{
    if(closed)return;closed=true;server.closeAllConnections();server.close();
    try{const saved=JSON.parse(readFileSync(options.descriptorPath,'utf8'));if(saved.instanceId===commands.instanceId)unlinkSync(options.descriptorPath);}catch{/* Stale descriptors are rejected by the health/instance check in clients. */}
  };
  const setLanEnabled=async(enabled:boolean)=>{
    if(typeof enabled!=='boolean')throw new ContentError('VALIDATION','请选择有效的连接模式。');
    if(closed||changing)throw new ContentError('BUSY','连接模式正在切换，请稍候。');
    if(access.lanEnabled===enabled)return info();
    changing=true;const previous=listenHost;
    try{
      // Let active saves/uploads finish before changing the listening socket.
      await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()));
      if(closed)throw new ContentError('UNAVAILABLE','服务已关闭。');
      listenHost=enabled?'0.0.0.0':'127.0.0.1';
      await listen(address.port,listenHost);
      access.saveMode(enabled);writeDescriptor();return info();
    }catch(error){
      if(!closed){
        if(server.listening)await new Promise<void>(done=>server.close(()=>done()));
        listenHost=previous;access.saveMode(previous==='0.0.0.0');await listen(address.port,previous);writeDescriptor();
      }
      throw error;
    }finally{changing=false;}
  };
  return {info,close,setLanEnabled,setBrowserAccessMode:(mode:import('../shared/api.ts').BrowserAccessMode)=>{access.setAccessMode(mode);writeDescriptor();return info();},clearBrowserSessions:()=>{access.clearBrowserSessions();return info();},createPairing:()=>access.createPairing(),rotateCredentials:()=>access.rotate(),mcpConfig:()=>({url:`${baseUrl}/mcp`,headers:{Authorization:access.credentials().authorization}})};
}
