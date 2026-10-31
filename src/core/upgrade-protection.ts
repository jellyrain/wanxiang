import DB from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,statSync,statfsSync,unlinkSync,writeFileSync} from 'node:fs';
import {copyFile,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {ContentError,LibraryStore} from './store.ts';
import {assertLibraryVersion,markLibraryVersion,LIBRARY_FORMAT_VERSION,LIBRARY_SCHEMA} from './library-version.ts';
import {schemaFingerprint} from './schema-format.ts';
import type {UpgradePoint} from '../shared/update.ts';

type FileRecord={path:string;bytes:number;sha256:string};
interface Manifest extends UpgradePoint {format:1;files:FileRecord[]}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const mediaName=/^[a-f0-9]{64}\.(png|jpg|webp)$/;
const failure=(message:string):never=>{throw new ContentError('UPGRADE_PROTECTION',message);};
export const protectionDirectory=(directory:string)=>join(resolve(directory),'upgrade-recovery');
const markerPath=(directory:string)=>join(directory,'library-state.json');
const journalPath=(directory:string)=>join(directory,'upgrade-switch.json');
function safeDirectory(path:string){mkdirSync(path,{recursive:true});if(lstatSync(path).isSymbolicLink())failure('升级保护目录不能是目录链接。');}
function plainFile(path:string){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())failure('资料中存在无法保护的文件或链接。');return stat;}
function atomicJson(path:string,value:unknown){
  const temporary=path+'.'+randomUUID()+'.partial';
  try{writeFileSync(temporary,JSON.stringify(value)+'\n',{encoding:'utf8',flag:'wx',flush:true});renameSync(temporary,path);}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
}
async function fileHash(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function durableCopy(source:string,destination:string){
  plainFile(source);await copyFile(source,destination);const handle=await open(destination,'r+');try{await handle.sync();}finally{await handle.close();}
}
function integrity(db:DB.Database){
  if(db.pragma('quick_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)failure('资料库完整性或关联校验未通过，升级已停止。');
}
function pointPath(directory:string,id:string){
  if(!uuid.test(id))return failure('升级保护点编号无效。');
  const root=protectionDirectory(directory);if(existsSync(root)&&lstatSync(root).isSymbolicLink())failure('升级保护目录不能是目录链接。');
  const point=join(root,id);if(existsSync(point)&&lstatSync(point).isSymbolicLink())failure('升级保护点不能是目录链接。');return point;
}
function manifest(directory:string,id:string):Manifest{
  const point=pointPath(directory,id),value=JSON.parse(readFileSync(join(point,'manifest.json'),'utf8')) as Manifest;
  if(value.format!==1||value.id!==id||!Number.isInteger(value.libraryVersion)||value.libraryVersion<0||typeof value.appVersion!=='string'||typeof value.targetVersion!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!Number.isSafeInteger(value.bytes)||value.bytes<0||!Array.isArray(value.files))failure('升级保护点记录无效。');
  const names=new Set<string>();
  for(const file of value.files){
    if(!file||typeof file.path!=='string'||!(file.path==='source.sqlite'||file.path.startsWith('media/')&&mediaName.test(file.path.slice(6)))||names.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))failure('升级保护点文件清单无效。');
    names.add(file.path);
  }
  if(!names.has('source.sqlite'))failure('升级保护点缺少资料库。');return value;
}
export function listProtectionPoints(directory:string):UpgradePoint[]{
  const root=protectionDirectory(directory);if(!existsSync(root))return [];
  if(lstatSync(root).isSymbolicLink())return [];
  return readdirSync(root).filter(id=>uuid.test(id)).flatMap(id=>{try{const {format,files,...point}=manifest(directory,id);return [point];}catch{return [];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function verifyProtectionPoint(directory:string,id:string){
  const point=pointPath(directory,id),value=manifest(directory,id);
  if(existsSync(join(point,'media'))&&lstatSync(join(point,'media')).isSymbolicLink())failure('升级保护点的图片目录无效。');
  for(const file of value.files){const path=join(point,file.path);if(plainFile(path).size!==file.bytes||await fileHash(path)!==file.sha256)failure('升级保护点校验失败，现有资料未被替换。');}
  const db=new DB(join(point,'source.sqlite'),{readonly:true,fileMustExist:true});try{integrity(db);if(db.pragma('user_version',{simple:true})!==value.libraryVersion)failure('保护点的资料版本与记录不一致。');}finally{db.close();}
  return value;
}

/** Independent upgrade checkpoints never modify the user's incremental backup chain. */
export async function createProtectionPoint(directory:string,appVersion:string,targetVersion:string):Promise<UpgradePoint>{
  directory=resolve(directory);const source=join(directory,'library.sqlite');plainFile(source);
  const root=protectionDirectory(directory);safeDirectory(root);
  const media=join(directory,'media');if(existsSync(media)&&lstatSync(media).isSymbolicLink())failure('图片目录不能是目录链接。');
  const images=existsSync(media)?readdirSync(media):[];
  let required=statSync(source).size*3+16*1024*1024;
  for(const name of images){if(!mediaName.test(name))failure('图片目录中有未识别的文件，升级保护已停止。');required+=plainFile(join(media,name)).size;}
  const space=statfsSync(directory);if(space.bavail*space.bsize<required)failure('磁盘空间不足，无法建立完整的升级保护点。请释放空间后重试。');
  const id=randomUUID(),point=pointPath(directory,id);safeDirectory(point);safeDirectory(join(point,'media'));
  const db=new DB(source,{readonly:true,fileMustExist:true});
  let libraryVersion:number;
  try{
    integrity(db);libraryVersion=db.pragma('user_version',{simple:true}) as number;
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'").get()){
      for(const row of db.prepare('SELECT file_name FROM assets').all() as {file_name:string}[])if(!mediaName.test(row.file_name)||!images.includes(row.file_name))failure('资料引用的图片缺失，升级已停止。');
    }
    await db.backup(join(point,'source.sqlite'));
  }finally{db.close();}
  const files:FileRecord[]=[];
  for(const name of images){
    const path='media/'+name,sourceImage=join(media,name),target=join(point,path);await durableCopy(sourceImage,target);
    const sha256=await fileHash(target);if(sha256!==name.slice(0,64)||sha256!==await fileHash(sourceImage))failure('图片校验失败，升级保护点尚未完成。');
    files.push({path,bytes:statSync(target).size,sha256});
  }
  const sourceCopy=join(point,'source.sqlite');const handle=await open(sourceCopy,'r+');try{await handle.sync();}finally{await handle.close();}
  files.unshift({path:'source.sqlite',bytes:statSync(sourceCopy).size,sha256:await fileHash(sourceCopy)});
  const value:Manifest={format:1,id,appVersion,targetVersion,libraryVersion,createdAt:new Date().toISOString(),bytes:files.reduce((sum,file)=>sum+file.bytes,0),files};
  atomicJson(join(point,'manifest.json'),value);await verifyProtectionPoint(directory,id);
  const {format,files:_,...result}=value;return result;
}

function moveDatabase(source:string,destination:string){
  renameSync(source,destination);
  for(const suffix of ['-wal','-shm'])if(existsSync(source+suffix))renameSync(source+suffix,destination+suffix);
}
async function rollbackSwitch(directory:string,id:string){
  const point=pointPath(directory,id),previous=join(point,'previous.sqlite'),current=join(directory,'library.sqlite');
  await verifyProtectionPoint(directory,id);
  if(existsSync(previous)){
    if(existsSync(current))moveDatabase(current,join(point,'failed-'+randomUUID()+'.sqlite'));
    moveDatabase(previous,current);
  }else if(!existsSync(current)){await durableCopy(join(point,'source.sqlite'),current);}
  const original=manifest(directory,id);atomicJson(markerPath(directory),{version:1,appVersion:original.appVersion,libraryVersion:original.libraryVersion});
  if(existsSync(journalPath(directory)))unlinkSync(journalPath(directory));
}
export async function recoverInterruptedUpgrade(directory:string){
  const path=journalPath(directory);if(!existsSync(path))return false;
  const journal=JSON.parse(readFileSync(path,'utf8')) as {version:number;id:string;phase:string};
  if(journal.version!==1||!uuid.test(journal.id)||!['prepared','committed'].includes(journal.phase))failure('升级切换记录无法读取，请保留资料目录并使用恢复入口。');
  if(journal.phase==='committed'){
    if(!existsSync(join(directory,'library.sqlite')))failure('升级后的资料库缺失，请从保护点恢复。');
    unlinkSync(path);return false;
  }
  await rollbackSwitch(directory,journal.id);return true;
}
async function switchDatabase<T>(directory:string,id:string,finish:()=>T,close:(value:T)=>void):Promise<T>{
  const point=pointPath(directory,id),current=join(directory,'library.sqlite');
  // Flatten WAL only after the candidate and the protection point have passed validation.
  const checkpoint=new DB(current,{fileMustExist:true});
  try{
    const result=checkpoint.pragma('wal_checkpoint(TRUNCATE)') as {busy:number}[];
    if(result.some(r=>r.busy))failure('仍有程序正在使用资料库，请关闭其他实例后重试。');
    checkpoint.pragma('journal_mode=DELETE');
  }finally{checkpoint.close();}
  atomicJson(journalPath(directory),{version:1,id,phase:'prepared'});
  let value:T|undefined;
  try{
    moveDatabase(current,join(point,'previous.sqlite'));
    renameSync(join(point,'candidate.sqlite'),current);
    value=finish();atomicJson(journalPath(directory),{version:1,id,phase:'committed'});
  }catch(error){if(value!==undefined)close(value);await rollbackSwitch(directory,id);throw error;}
  try{unlinkSync(journalPath(directory));}catch{/* A committed journal is safely cleared at the next launch. */}
  return value;
}
function validateLibrary(db:DB.Database,store:LibraryStore){
  integrity(db);if(schemaFingerprint(db)!==LIBRARY_SCHEMA)failure('资料结构与此版本不匹配，升级已停止。');
  store.snapshot();
}
function openStore(directory:string){
  const db=new DB(join(directory,'library.sqlite'),{fileMustExist:true});
  try{assertLibraryVersion(db);const store=new LibraryStore(db,directory);validateLibrary(db,store);return {db,store};}
  catch(error){db.close();throw error;}
}
export async function openProtectedLibrary(directory:string,appVersion:string){
  directory=resolve(directory);safeDirectory(directory);await recoverInterruptedUpgrade(directory);
  const current=join(directory,'library.sqlite');
  if(!existsSync(current)){
    const temporary=join(directory,'library-new-'+randomUUID()+'.sqlite'),db=new DB(temporary);
    try{const store=new LibraryStore(db,directory);markLibraryVersion(db);validateLibrary(db,store);db.pragma('journal_mode=DELETE');}finally{db.close();}
    renameSync(temporary,current);const opened=openStore(directory);
    try{atomicJson(markerPath(directory),{version:1,appVersion,libraryVersion:LIBRARY_FORMAT_VERSION});return opened;}catch(error){opened.store.close();throw error;}
  }
  plainFile(current);const original=new DB(current,{readonly:true,fileMustExist:true});
  let version:number,schema:string;
  try{
    assertLibraryVersion(original);integrity(original);version=original.pragma('user_version',{simple:true}) as number;schema=schemaFingerprint(original);
    if((version===LIBRARY_FORMAT_VERSION&&schema!==LIBRARY_SCHEMA)||(version===2&&schema!=='f417631c1be19013b9d05d1f889a861e99deaa300b07ff5bb2437f9f78e1389e')||(version===1&&schema!=='92d64e779c9dda2d93e5993b7f9d524d2c9faa1eabe5219fa26ab72cc2d9304c'))failure('资料结构无法识别，原库已保留，未尝试修改。');
    if(version===0&&['worlds','works','characters'].some(name=>!original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)))failure('这不是可识别的万象工坊旧资料库，原文件已保留。');
  }finally{original.close();}
  let previous:{appVersion?:string;libraryVersion?:number}={};
  if(existsSync(markerPath(directory)))try{previous=JSON.parse(readFileSync(markerPath(directory),'utf8'));}catch{}
  if(version===LIBRARY_FORMAT_VERSION&&previous.appVersion===appVersion)return openStore(directory);
  const protection=await createProtectionPoint(directory,previous.appVersion??'旧版本',appVersion),point=pointPath(directory,protection.id);
  await durableCopy(join(point,'source.sqlite'),join(point,'candidate.sqlite'));
  const candidate=new DB(join(point,'candidate.sqlite'));
  try{
    // Migrate 0/1/2 -> 3 on the protected copy: retain existing tables and add
    // catalogs and character_images as needed; no creative records move or change.
    const store=new LibraryStore(candidate,point);markLibraryVersion(candidate);validateLibrary(candidate,store);candidate.pragma('journal_mode=DELETE');
  }finally{candidate.close();}
  await verifyProtectionPoint(directory,protection.id);
  return switchDatabase(directory,protection.id,()=>{
    const opened=openStore(directory);
    try{atomicJson(markerPath(directory),{version:1,appVersion,libraryVersion:LIBRARY_FORMAT_VERSION});return opened;}catch(error){opened.store.close();throw error;}
  },opened=>opened.store.close());
}

/** Called only after an explicit restore confirmation, before any live store opens. */
export async function restoreProtectionPoint(directory:string,id:string,appVersion:string){
  await recoverInterruptedUpgrade(directory);const target=await verifyProtectionPoint(directory,id);
  if(target.libraryVersion>LIBRARY_FORMAT_VERSION)failure('这个保护点需要较新版软件，当前版本不能恢复。');
  const sourcePoint=pointPath(directory,id),current=join(directory,'library.sqlite');
  if(!existsSync(current))failure('当前资料库缺失，请保留恢复目录并使用保护点中的 source.sqlite 恢复。');
  const preserved=await createProtectionPoint(directory,appVersion,'恢复前保留'),destination=pointPath(directory,preserved.id);
  await durableCopy(join(sourcePoint,'source.sqlite'),join(destination,'candidate.sqlite'));
  safeDirectory(join(directory,'media'));
  for(const file of target.files.filter(f=>f.path.startsWith('media/'))){
    const live=join(directory,file.path),temporary=live+'.'+randomUUID()+'.partial';
    if(existsSync(live)&&await fileHash(live)===file.sha256)continue;
    await durableCopy(join(sourcePoint,file.path),temporary);renameSync(temporary,live);
  }
  await switchDatabase(directory,preserved.id,()=>{atomicJson(markerPath(directory),{version:1,appVersion:target.appVersion,libraryVersion:target.libraryVersion});return true;},()=>{});
  return preserved;
}
