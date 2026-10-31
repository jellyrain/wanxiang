import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, screen, shell, Tray, Menu } from 'electron';
import BetterSqlite3 from 'better-sqlite3';
import {updateCache as inspectUpdateCache} from './update-cache.ts';
import { mkdirSync, readFileSync, statSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import {writeFile} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContentError, LibraryStore } from '../src/core/store.ts';
import type { Result, MediaImportReport } from '../src/shared/types.ts';
import { BRAND } from '../src/shared/brand.ts';
import { contentCommands } from '../src/core/commands.ts';
import { startLocalServer } from '../src/core/local-server.ts';
import { CONTENT_CHANNELS, type LocalConnection } from '../src/shared/api.ts';
import { THEMES } from '../src/shared/themes.ts';
import { BackupService } from '../src/core/backups.ts';
import { BACKUP_CHANNELS } from '../src/shared/backup.ts';
import { DesktopLifecycle } from './lifecycle.ts';
import { DesktopSettings } from './desktop-settings.ts';
import type { DesktopStatus } from '../src/shared/desktop.ts';
import {ConnectionAccess} from '../src/core/connection-access.ts';
import {readSkillPackage} from '../src/core/skill-packages.ts';
import {TRANSFER_LIMIT,type TransferExportInput} from '../src/shared/transfer.ts';
import {openProtectedLibrary,createProtectionPoint,listProtectionPoints,restoreProtectionPoint,protectionDirectory} from '../src/core/upgrade-protection.ts';
import {UpdatePreferences} from './update-settings.ts';
import {UpdateCoordinator} from './updater.ts';
import {createInstalledDriver} from './platform-update.ts';
import {readReleaseConfig} from './release-config.ts';
import {createPortableDriver,previousPortableError} from './portable-update.ts';
import {runtimeConfig} from './runtime-config.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const runtime = runtimeConfig(app.getPath('appData'),process.env,app.isPackaged?{executable:process.execPath}:undefined);
const devUrl = runtime.devUrl;
const releaseConfig=readReleaseConfig(join(app.getAppPath(),'resources/release-config.json'));
app.setName(BRAND.name);
app.setPath('userData', runtime.userData);
let storageError:Error|undefined;
try{
  mkdirSync(runtime.userData,{recursive:true});
  const probe=join(runtime.userData,'.write-check-'+process.pid);writeFileSync(probe,'',{flag:'wx'});unlinkSync(probe);
  if(app.isPackaged){
    app.setPath('sessionData',runtime.userData);
    for(const [key,folder] of [['temp','temp'],['crashDumps','crashes'],['logs','logs']] as const){const path=join(runtime.userData,folder);mkdirSync(path,{recursive:true});app.setPath(key,path);}
    process.env.TEMP=process.env.TMP=join(runtime.userData,'temp');
  }
}catch{storageError=Error('资料目录无法写入。请检查目录权限和可用空间后重新启动。\n资料位置：'+runtime.userData);}
// Stable Windows identity: renaming the project must not create a second installed app.
if(process.platform==='win32')app.setAppUserModelId('local.oc-studio');
protocol.registerSchemesAsPrivileged([{ scheme: 'ocasset', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window: BrowserWindow | null = null;
let store: LibraryStore | undefined;
let backups:BackupService|undefined;
let localServer:Awaited<ReturnType<typeof startLocalServer>>|undefined;
let tray:Tray|undefined;
let desktop:DesktopSettings|undefined;
let lifecycle:DesktopLifecycle|undefined;
let updates:UpdateCoordinator|undefined;
const portableExecutable=process.platform==='win32'&&app.isPackaged&&existsSync(join(runtime.programDirectory!,'wanxiang-portable.json'))?process.execPath:undefined;
const edition=app.isPackaged?(portableExecutable?'portable':'installed'):'development';
const launchPath=portableExecutable??process.execPath;
const loginAtStartupSupported=app.isPackaged&&process.platform!=='linux';
const loginOptions=process.platform==='win32'?{path:launchPath,args:['--background']}:{};
let creatingWindow:Promise<void>|undefined;
let trayError:string|null=null;
let wantForeground=!process.argv.includes('--background');
let systemEnding=false;
let updateTray=()=>{};

function desktopStatus():DesktopStatus {
  return {closeToTray:desktop?.closeToTray??true,trayAvailable:Boolean(tray&&!tray.isDestroyed()),phase:lifecycle?.phase??'running',error:trayError??desktop?.error??null,
    version:app.getVersion(),packaged:app.isPackaged,edition,dataDirectory:app.isPackaged?runtime.userData:runtime.directory,onboardingComplete:desktop?.onboardingComplete??true,loginAtStartupSupported,loginAtStartup:loginAtStartupSupported&&app.getLoginItemSettings(loginOptions).openAtLogin};
}
async function showMainWindow(){
  if(creatingWindow)await creatingWindow;
  if(!window){
    creatingWindow=createWindow();
    try{await creatingWindow;}finally{creatingWindow=undefined;}
  }
  if(window?.isMinimized())window.restore();
  window?.show();window?.focus();updateTray();
}
function openMainWindow(){void showMainWindow().catch(error=>{console.error(error);dialog.showErrorBox('窗口未能打开','请从托盘退出软件后重新启动。已保存的资料不会丢失。');});}

function registerHandler(name: string, action: (...args: any[]) => unknown) {
  ipcMain.handle(name, async (event, ...args): Promise<Result<unknown>> => {
    const frame = event.senderFrame;
    const allowed = frame && frame === event.sender.mainFrame && (devUrl
      ? new URL(frame.url).origin === new URL(devUrl).origin
      : frame.url.split('#')[0] === pathToFileURL(join(app.getAppPath(),'dist-ui/index.html')).href);
    // Check the exact main window as well as its origin; child frames cannot use the content API.
    if (!window || event.sender !== window.webContents || !allowed) {
      return { ok: false, error: { code: 'FORBIDDEN', message: '当前窗口不能访问资料库。' } };
    }
    try { return { ok: true, value: await action(...args) }; }
    catch (error) {
      if (error instanceof ContentError) return { ok: false, error: { code: error.code, message: error.message } };
      console.error(error);
      return { ok: false, error: { code: 'INTERNAL', message: '操作未完成，请重试。你的输入仍保留在编辑窗口。' } };
    }
  });
}

async function createWindow() {
  const icon = join(app.getAppPath(), 'public/brand', BRAND.iconFile);
  const theme = THEMES.find(t => t.id === store!.getTheme())!;
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize;
  const width = Math.floor(Math.min(1440,workArea.width-32,(workArea.height-32)*16/9)/16)*16;
  const minWidth = Math.min(1024,width);
  window = new BrowserWindow({ show:false, width, height: width*9/16, minWidth, minHeight: minWidth*9/16,
    backgroundColor: theme.background, title: BRAND.name, ...(existsSync(icon) ? { icon } : {}),
    ...(process.platform==='darwin'?{}:{titleBarStyle:'hidden' as const,titleBarOverlay:{color:theme.background,symbolColor:theme.foreground,height:38}}),
    webPreferences: { preload: join(here,'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.once('ready-to-show',()=>window?.show());
  window.setAspectRatio(16/9);
  if(process.platform!=='darwin')window.removeMenu();
  window.webContents.on('console-message',details=>{
    if(details.level==='error')console.error(`[界面错误] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  window.webContents.on('render-process-gone',(_event,details)=>console.error('[界面进程退出]',details.reason));
  window.webContents.on('preload-error',(_event,_path,error)=>console.error('[界面接口加载失败]',error));
  window.webContents.on('did-fail-load',(_event,code,description)=>console.error('[界面加载失败]',code,description));
  window.webContents.setWindowOpenHandler(({url}) => {
    try {if(['https:','http:','mailto:'].includes(new URL(url).protocol))void shell.openExternal(url).catch(error=>console.error('[打开链接]',error));}catch{}
    return {action:'deny'};
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close',event=>{if(!systemEnding)lifecycle?.onClose(event);});
  window.webContents.on('will-prevent-unload',event=>{
    if(window?.isMinimized())window.restore();window?.show();window?.focus();
    if(updates?.installRequested){
      dialog.showMessageBoxSync(window!,{type:'info',title:'请先保存编辑',message:'更新已暂缓，请保存并关闭当前编辑窗口后，再点击“重启并更新”。',buttons:['继续编辑'],noLink:true});
      lifecycle?.cancelQuit();return;
    }
    const response=dialog.showMessageBoxSync(window!,{type:'question',title:'编辑尚未结束',message:'当前有编辑窗口或尚未保存的修改。',detail:'可以继续编辑并保存，或放弃这些修改后离开。'+(lifecycle?.phase==='checking'?'退出软件也会停止网页版、AI 连接和自动备份。':''),buttons:['继续编辑','放弃修改并离开'],defaultId:0,cancelId:0,noLink:true});
    if(response===1)event.preventDefault();
    else lifecycle?.cancelQuit();
  });
  window.on('session-end',()=>{systemEnding=true;backups?.stop();if(store)store.closing=true;});
  window.on('closed', () => { window = null;if(!systemEnding)void lifecycle?.windowClosed(); });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(join(app.getAppPath(),'dist-ui/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event,argv) => {if(!argv.includes('--background')){wantForeground=true;lifecycle?.show();}});
  app.on('activate',()=>lifecycle?.show());
  app.whenReady().then(async () => {
    if(storageError)throw storageError;
    if(process.platform==='darwin'&&app.isPackaged&&app.getLoginItemSettings().wasOpenedAtLogin)wantForeground=false;
    if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
    const directory = runtime.directory;
    mkdirSync(directory,{ recursive: true });
    const firstRun=app.isPackaged&&!existsSync(join(directory,'library.sqlite'));
    try{store=(await openProtectedLibrary(directory,app.getVersion())).store;}
    catch(error){
      const points=listProtectionPoints(directory).slice(0,5);
      const choice=await dialog.showMessageBox({type:'error',title:'资料升级未完成',message:String((error as Error).message),
        detail:'原资料和升级保护点已保留。可以打开目录检查，或选择保护点恢复；恢复前会另存当前资料。',
        buttons:['退出','打开保护目录',...points.map(p=>`恢复 ${new Date(p.createdAt).toLocaleString('zh-CN')} · ${p.appVersion}`)],defaultId:0,cancelId:0,noLink:true});
      if(choice.response===1){await shell.openPath(existsSync(protectionDirectory(directory))?protectionDirectory(directory):directory);throw error;}
      if(choice.response<2)throw error;
      const point=points[choice.response-2];
      const confirm=await dialog.showMessageBox({type:'warning',title:'恢复升级前资料',message:'恢复到所选保护点？',detail:'当前资料会先建立另一份保护点；所选时间之后的内容不会直接合入恢复结果。',buttons:['取消','保留当前资料并恢复'],defaultId:0,cancelId:0,noLink:true});
      if(confirm.response!==1)throw error;
      await restoreProtectionPoint(directory,point.id,app.getVersion());store=(await openProtectedLibrary(directory,app.getVersion())).store;
    }
    // Development fixtures never ship in a release or appear in a fresh install.
    if(!app.isPackaged&&existsSync(join(app.getAppPath(),'resources/seed/characters.json')))store.seed(join(app.getAppPath(),'resources/seed'));
    if(!store.journal.get('starter-initialized')&&store.snapshot().works.length===0)store.workspace.createWork({name:'我的第一部作品',world:{kind:'new',name:'我的世界',description:''}});
    store.journal.set('starter-initialized','1');
    desktop=new DesktopSettings(join(directory,'desktop-settings.json'),firstRun);
    if(firstRun)desktop.save(desktop.closeToTray);
    lifecycle=new DesktopLifecycle({
      getWindow:()=>window,canHide:()=>Boolean(tray&&!tray.isDestroyed()),closeToTray:()=>desktop!.closeToTray,
      showWindow:openMainWindow,changed:()=>{if(lifecycle?.phase==='running')updates?.cancelInstall();updateTray();},
      stopWork:async()=>{store!.closing=true;backups?.stop();await backups?.waitIdle();await updates?.prepare();},
      resumeWork:()=>{store!.closing=false;backups?.start();},
      finishQuit:async()=>{if(updates?.installRequested)await updates.finish();else app.quit();},failed:error=>{console.error(error);dialog.showErrorBox('操作未完成',String((error as Error).message)+'\n软件已保持运行，资料可继续编辑。');}
    });
    const updateCache=join(runtime.userData,'update-cache');
    updates=new UpdateCoordinator({version:app.getVersion(),edition,preferences:new UpdatePreferences(join(directory,'update-settings.json'),app.isPackaged?releaseConfig.updateUrl:''),
      driver:portableExecutable?createPortableDriver({version:app.getVersion(),executable:portableExecutable,cache:updateCache,helper:join(app.getAppPath(),'resources/updater/portable-install.ps1'),quit:()=>app.quit()}):createInstalledDriver(updateCache,releaseConfig.macSigned),
      protect:target=>createProtectionPoint(directory,app.getVersion(),target),requestQuit:()=>setImmediate(()=>lifecycle!.requestQuit())});
    if(portableExecutable)updates.state.error??=previousPortableError(updateCache);
    registerHandler('update:status',()=>updates!.status());
    registerHandler('update:cache',()=>inspectUpdateCache(updateCache));
    registerHandler('update:clear-cache',()=>{
      if(lifecycle!.phase!=='running'||!['idle','unconfigured','error'].includes(updates!.state.phase)||updates!.installRequested)throw new ContentError('BUSY','请先完成当前更新，再清理下载缓存。');
      return inspectUpdateCache(updateCache,true);
    });
    const activeUpdates=()=>{if(lifecycle!.phase!=='running')throw new ContentError('BUSY','软件正在退出，请稍候。');return updates!;};
    registerHandler('update:settings',input=>activeUpdates().save(input));
    registerHandler('update:check',()=>activeUpdates().check());
    registerHandler('update:download',()=>activeUpdates().download());
    registerHandler('update:install',()=>activeUpdates().requestInstall());
    registerHandler('update:recovery-folder',async()=>{const path=protectionDirectory(directory);mkdirSync(path,{recursive:true});const error=await shell.openPath(path);if(error)throw new ContentError('UNAVAILABLE',error);});
    registerHandler('desktop:status',desktopStatus);
    registerHandler('desktop:data-directory',async()=>{const error=await shell.openPath(app.isPackaged?runtime.userData:runtime.directory);if(error)throw new ContentError('UNAVAILABLE',error);});
    registerHandler('desktop:onboarding-complete',()=>{desktop!.completeOnboarding();return desktopStatus();});
    registerHandler('desktop:login-at-startup',(enabled:unknown)=>{
      if(!loginAtStartupSupported||typeof enabled!=='boolean')throw new ContentError('VALIDATION','当前系统或运行方式不支持在软件内设置登录启动。');
      app.setLoginItemSettings({name:'WanxiangWorkshop',openAtLogin:enabled,...loginOptions});return desktopStatus();
    });
    registerHandler('desktop:close-to-tray',(enabled:unknown)=>{
      if(typeof enabled!=='boolean')throw new ContentError('VALIDATION','请选择有效的关闭行为。');
      if(lifecycle!.phase!=='running')throw new ContentError('BUSY','软件正在退出，请稍候。');
      desktop!.save(enabled);updateTray();return desktopStatus();
    });
    registerHandler('desktop:hide',()=>{if(!lifecycle!.hide())throw new ContentError('UNAVAILABLE','托盘暂不可用，窗口保持打开。');});
    registerHandler('desktop:quit',()=>{setImmediate(()=>lifecycle!.requestQuit());});
    protocol.handle('ocasset', request => {
      const url = new URL(request.url);
      const asset = url.hostname === 'asset' ? store!.getAsset(url.pathname.slice(1)) : undefined;
      if (!asset) return new Response('Not found',{ status:404 });
      try {
        const bytes = readFileSync(join(store!.mediaDir,asset.fileName));
        return new Response(new Uint8Array(bytes),{ headers: { 'Content-Type':asset.mime, 'Cache-Control':'private, max-age=31536000, immutable', 'X-Content-Type-Options':'nosniff' } });
      } catch { return new Response('Not found',{ status:404 }); }
    });
    const commands=contentCommands(store,()=>{
      if(!window)return;
      const theme=THEMES.find(t=>t.id===store!.getTheme())!;
      window.setBackgroundColor(theme.background);
      if(process.platform!=='darwin')window.setTitleBarOverlay({color:theme.background,symbolColor:theme.foreground,height:38});
    });
    registerHandler('transfer:pick-file',async()=>{
      const result=await dialog.showOpenDialog(window!,{title:'选择资料包或章节正文',properties:['openFile'],filters:[{name:'资料包与 UTF-8 正文',extensions:['wanxiang','txt','md']}]});
      if(result.canceled||!result.filePaths[0])return null;
      const path=result.filePaths[0];if(statSync(path).size>TRANSFER_LIMIT)throw new ContentError('TOO_LARGE','文件不能超过 64 MB。');
      let content:string;try{content=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path));}catch{throw new ContentError('VALIDATION','文件无法读取，请另存为 UTF-8 编码后重试。');}
      return {name:basename(path),content};
    });
    registerHandler('transfer:save-file',async(input:TransferExportInput)=>{
      const file=store!.transfer.export(input);
      const result=await dialog.showSaveDialog(window!,{title:'导出资料',defaultPath:join(app.getPath('downloads'),file.name),filters:[{name:'万象工坊导出文件',extensions:[file.name.split('.').at(-1)!]}]});
      if(result.canceled||!result.filePath)return null;
      await writeFile(result.filePath,file.content,'utf8');return result.filePath;
    });
    for(const [method,channel] of Object.entries(CONTENT_CHANNELS))registerHandler(channel,envelope=>commands.invoke(method,envelope?.args,envelope?.generation));
    backups=new BackupService({store,directory,openDatabase:path=>new BetterSqlite3(path),onRestored:()=>commands.changed()});
    for(const [method,channel] of Object.entries(BACKUP_CHANNELS))registerHandler(channel,(...args)=>backups!.invoke(method,args));
    registerHandler('backup:directory',async()=>{
      const selected=await dialog.showOpenDialog(window!,{title:'选择备份目录',properties:['openDirectory','createDirectory']});
      return selected.canceled?null:selected.filePaths[0]??null;
    });
    const descriptorPath=runtime.descriptorPath;
    const skillDirectory=join(app.getAppPath(),'resources/skills');
    registerHandler('connection:download-skill',async kind=>{
      const pack=readSkillPackage(skillDirectory,kind);
      const selected=await dialog.showSaveDialog(window!,{title:`保存 ${pack.name}`,defaultPath:join(app.getPath('downloads'),pack.fileName),filters:[{name:'Skill 压缩包',extensions:['zip']}]});
      if(selected.canceled||!selected.filePath)return null;
      await writeFile(selected.filePath,pack.bytes);
      return selected.filePath;
    });
    let connection:LocalConnection={available:false,baseUrl:null,apiUrl:null,descriptorPath};
    const decodeImage=(bytes:Buffer)=>{
      const image=nativeImage.createFromBuffer(bytes);
      if(image.isEmpty())throw new ContentError('VALIDATION','这张图片无法读取，请换一张。');
      return image.getSize();
    };
    try{
      localServer=await startLocalServer({store,commands,backups,access:new ConnectionAccess(join(directory,'connection-settings.json')),uiDirectory:join(app.getAppPath(),'dist-ui'),descriptorPath,skillDirectory,
        contract:JSON.parse(readFileSync(join(app.getAppPath(),'resources/api-contract.json'),'utf8')),
        port:runtime.port,decodeImage});
      connection=localServer.info();
      console.log('[本机浏览器]',connection.baseUrl);
    }catch(error){console.error('[本地服务启动失败]',error);connection.error='本地服务未能启动，请检查端口或连接文件目录后重启软件。';}
    registerHandler('connection:info',()=>localServer?.info()??connection);
    const activeServer=()=>{if(!localServer||lifecycle!.phase!=='running')throw new ContentError('UNAVAILABLE','连接服务暂不可用，请稍后重试。');return localServer;};
    registerHandler('connection:lan',async enabled=>{connection=await activeServer().setLanEnabled(enabled);updateTray();return connection;});
    registerHandler('connection:browser-mode',mode=>activeServer().setBrowserAccessMode(mode));
    registerHandler('connection:clear-sessions',()=>activeServer().clearBrowserSessions());
    registerHandler('connection:pairing',()=>activeServer().createPairing());
    registerHandler('connection:mcp-config',()=>activeServer().mcpConfig());
    registerHandler('connection:rotate',()=>activeServer().rotateCredentials());
    registerHandler('connection:revision',()=>commands.revision());
    registerHandler('connection:open',async()=>{
      if(!connection.baseUrl)throw new ContentError('UNAVAILABLE','本地服务尚未启动。');
      await shell.openExternal(connection.baseUrl);
    });
    const importImageFile=(worldId:string,path:string,generation?:string)=>{
      store!.assertWritable(generation);
      const stat=statSync(path);
      if(!stat.isFile()||stat.size>25*1024*1024)throw new ContentError('VALIDATION','请选择不超过 25 MB 的图片文件。');
      const bytes=readFileSync(path),dimensions=decodeImage(bytes);
      const asset=store!.importImage(worldId,bytes,basename(path),dimensions);commands.changed();return asset;
    };
    const pickImage = async (worldId:string,title:string,generation?:string) => {
      const result = await dialog.showOpenDialog(window!,{ title, properties:['openFile'], filters:[{ name:'图片', extensions:['png','jpg','jpeg','webp'] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      return importImageFile(worldId,result.filePaths[0],generation);
    };
    registerHandler('media:import',async(worldId:string,generation?:string)=>{
      store!.gallery.catalog(worldId);
      const result=await dialog.showOpenDialog(window!,{title:'导入图片素材',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});
      if(result.canceled||!result.filePaths.length)return null;
      if(result.filePaths.length>50)throw new ContentError('VALIDATION','每次最多导入 50 张图片。');
      const known=new Set(store!.gallery.snapshot().media.map(m=>m.id));
      const report:MediaImportReport={importedIds:[],existingIds:[],errors:[]};
      for(const path of result.filePaths){
        try{const asset=importImageFile(worldId,path,generation);const group=known.has(asset.id)?report.existingIds:report.importedIds;if(!group.includes(asset.id))group.push(asset.id);}
        catch(error){report.errors.push({name:basename(path),message:error instanceof ContentError?error.message:'文件读取失败，请检查文件是否完整。'});}
        await new Promise<void>(resolve=>setImmediate(resolve));
      }
      return report;
    });
    registerHandler('portrait:pick',(worldId,generation)=>pickImage(worldId,'选择人物特写',generation));
    registerHandler('world-image:pick',(worldId,generation)=>pickImage(worldId,'选择设定条目图片',generation));
    registerHandler('map-image:pick',(worldId,generation)=>pickImage(worldId,'选择地图底图或地点图片',generation));
    const openWeb=()=>{if(connection.baseUrl)void shell.openExternal(connection.baseUrl).catch(error=>{console.error(error);dialog.showErrorBox('浏览器未能打开','请在浏览器中手动输入软件设置里的本机地址。');});};
    updateTray=()=>{
      if(!tray||tray.isDestroyed())return;
      const running=lifecycle!.phase==='running';
      tray.setToolTip(`${BRAND.name} · ${running?'后台服务运行中':lifecycle!.phase==='checking'?'等待结束编辑':'正在完成后台操作'}`);
      tray.setContextMenu(Menu.buildFromTemplate([
        {label:running?'万象工坊 · 正在运行':'正在退出，请稍候…',enabled:false},
        {type:'separator'},
        {label:'打开万象工坊',enabled:running,click:()=>lifecycle!.show()},
        {label:'打开网页版',enabled:running&&connection.available,click:openWeb},
        {label:connection.available?'本机服务已启动':'本机服务未就绪',enabled:false},
        {type:'separator'},
        {label:'退出软件',enabled:running,click:()=>lifecycle!.requestQuit()}
      ]));
    };
    try{
      const icon=nativeImage.createFromPath(join(app.getAppPath(),'public/brand',BRAND.iconFile));
      if(icon.isEmpty())throw Error('托盘图标无法读取');
      tray=new Tray(icon.resize({width:20,height:20}));
      tray.on('double-click',()=>lifecycle!.show());
      updateTray();
    }catch(error){console.error('[托盘启动失败]',error);tray?.destroy();tray=undefined;trayError='系统托盘未能启动，关闭窗口将正常退出。重新启动软件可重试。';}
    if(wantForeground||!tray)await showMainWindow();
    backups.start();
    if(app.isPackaged&&updates.state.settings.checkOnStartup&&updates.state.settings.url)void updates.check().catch(console.error);
  }).catch(error => { console.error(error); dialog.showErrorBox('启动失败',String(error.message));if(lifecycle)lifecycle.requestQuit();else app.quit(); });
  app.on('window-all-closed', () => {if(!lifecycle)app.quit();});
  app.on('before-quit',event=>{
    if(lifecycle&&lifecycle.phase!=='ready'&&!systemEnding){event.preventDefault();lifecycle.requestQuit();}
  });
  app.on('will-quit', () => {backups?.stop();tray?.destroy();tray=undefined;localServer?.close();store?.close();});
}
