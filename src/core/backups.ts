import {LEGACY_PACKAGE_SCHEMAS} from './schema-format.ts';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, realpathSync, statSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { open, rename, unlink, readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { ContentError, LibraryStore, type Database } from './store.ts';
import { digest, quote, type RowChange } from './backup-journal.ts';
import type { BackupSettings, BackupStatus, BackupPoint, BackupEstimate, BackupRun, RestorePreview } from '../shared/backup.ts';

type Repository={format:1;id:string;libraryId:string};
type ImageRecord={fileName:string;size:number;hash:string};
type Manifest=BackupPoint & {format:1;libraryId:string;repositoryId:string;parentHash:string|null;stream:string;from:number;through:number;dataHash:string;images:ImageRecord[]};
type Checkpoint={repositoryId:string;id:string;hash:string;cursor:number;schema:string};
type Loaded={manifest:Manifest;hash:string};
type PreviewState={id:string;root:string;hash:string;sequence:number;generation:string;expires:number};
type Options={store:LibraryStore;directory:string;openDatabase:(path:string)=>Database;onRestored?:()=>void};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hashPattern=/^[0-9a-f]{64}$/;
const imageName=/^[0-9a-f]{64}\.(png|jpg|webp)$/;
const fail=(code:string,message:string):never=>{throw new ContentError(code,message);};
const iso=()=>new Date().toISOString();
const contains=(root:string,path:string)=>{const p=relative(resolve(root),resolve(path));return !p||p!=='..'&&!p.startsWith('..'+sep)&&!isAbsolute(p);};

/** Files are flushed and renamed before the database cursor can advance. */
async function durableFile(path:string,bytes:Buffer|string) {
  const temporary=path+'.'+randomUUID()+'.partial';
  try {const handle=await open(temporary,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await rename(temporary,path);}
  finally {await unlink(temporary).catch(()=>{});}
}
function safeRead(root:string,path:string):Buffer {
  if(!existsSync(path)||!contains(realpathSync(root),realpathSync(path))||!statSync(path).isFile())fail('BACKUP_INVALID','备份文件缺失或路径无效，请检查备份目录。');
  return readFileSync(path);
}

export class BackupService {
  private readonly store:LibraryStore;
  private readonly directory:string;
  private readonly openDatabase:Options['openDatabase'];
  private readonly onRestored:()=>void;
  private busy=false;
  private phase='';
  private previews=new Map<string,PreviewState>();
  private timer:ReturnType<typeof setInterval>|undefined;
  private nextAutomatic=0;
  constructor(options:Options) {this.store=options.store;this.directory=resolve(options.directory);this.openDatabase=options.openDatabase;this.onRestored=options.onRestored??(()=>{});}
  private get journal(){return this.store.journal;}
  private get db(){return this.journal.db;}
  private get settings():BackupSettings {
    const saved=this.journal.get('settings');
    return saved?JSON.parse(saved):{directory:join(this.directory,'backups'),automatic:false,intervalMinutes:30,retentionDays:0};
  }
  private checkpoint():Checkpoint|null {const raw=this.journal.get('checkpoint');return raw?JSON.parse(raw):null;}
  private repository(root=this.settings.directory):Repository|null {
    if(!existsSync(join(root,'repository.json')))return null;
    try {const value=JSON.parse(safeRead(root,join(root,'repository.json')).toString('utf8')) as Repository;
      if(value.format!==1||!uuid.test(value.id)||!uuid.test(value.libraryId))throw Error();return value;
    } catch {return fail('BACKUP_INVALID','这个目录中的备份库信息无法读取。请选择完整的万象工坊备份目录。');}
  }
  private ensureDirectory(root:string) {
    if(!isAbsolute(root)||contains(this.store.mediaDir,root))fail('VALIDATION','备份目录必须是绝对路径，且不能放在素材目录内。');
    mkdirSync(root,{recursive:true});
    if(contains(realpathSync(this.store.mediaDir),realpathSync(root)))fail('VALIDATION','备份目录不能指向素材目录。');
    for(const name of ['points','objects']) {
      const path=join(root,name);mkdirSync(path,{recursive:true});
      if(!contains(realpathSync(root),realpathSync(path)))fail('BACKUP_INVALID','备份子目录不能指向目录外。');
    }
  }
  private manifest(id:string,root=this.settings.directory):Loaded {
    if(!uuid.test(id))return fail('VALIDATION','恢复点编号无效。');
    try {
      const value=JSON.parse(safeRead(root,join(root,'points',id,'manifest.json')).toString('utf8')) as {manifest:Manifest;hash:string};
      const m=value.manifest;
      if(!m||m.format!==1||m.id!==id||value.hash!==digest(JSON.stringify(m))||!hashPattern.test(m.dataHash)||!hashPattern.test(m.schema)||!uuid.test(m.stream)||!uuid.test(m.libraryId)||!uuid.test(m.repositoryId)||!['baseline','increment'].includes(m.kind)||!Number.isFinite(Date.parse(m.createdAt))||!Number.isSafeInteger(m.from)||!Number.isSafeInteger(m.through)||m.from<0||m.through<m.from||!Number.isSafeInteger(m.records)||m.records<0||!Number.isSafeInteger(m.bytes)||m.bytes<0||!Array.isArray(m.images)||m.images.some(i=>!imageName.test(i.fileName)||i.hash!==i.fileName.slice(0,64)||!Number.isSafeInteger(i.size)||i.size<0))throw Error();
      if(m.kind==='baseline'?(m.parentId!==null||m.parentHash!==null):(!m.parentId||!uuid.test(m.parentId)||!m.parentHash||!hashPattern.test(m.parentHash)))throw Error();
      return value;
    } catch {return fail('BACKUP_INVALID',`恢复点 ${id.slice(0,8)} 不完整或校验失败，当前资料未被修改。`);}
  }
  private chain(id:string,root=this.settings.directory):Loaded[] {
    const repository=this.repository(root);if(!repository)fail('BACKUP_INVALID','没有找到备份库。');
    const chain:Loaded[]=[],seen=new Set<string>();let next:string|null=id;
    while(next) {
      if(seen.has(next)||seen.size>100000)fail('BACKUP_INVALID','备份依赖链无效。');seen.add(next);
      const item=this.manifest(next,root);
      if(item.manifest.repositoryId!==repository!.id||item.manifest.libraryId!==repository!.libraryId)fail('BACKUP_INVALID','恢复点不属于这个备份库。');
      chain.unshift(item);next=item.manifest.parentId;
    }
    for(let i=1;i<chain.length;i++) {
      const current=chain[i].manifest,parent=chain[i-1];
      if(current.parentHash!==parent.hash||current.schema!==parent.manifest.schema||current.stream===parent.manifest.stream&&current.from!==parent.manifest.through)fail('BACKUP_INVALID','增量备份的依赖或序号不连续。');
    }
    return chain;
  }
  private list(root=this.settings.directory):BackupPoint[] {
    const path=join(root,'points');if(!existsSync(path))return [];
    return readdirSync(path).filter(id=>uuid.test(id)&&existsSync(join(path,id,'manifest.json'))).map(id=>this.manifest(id,root).manifest).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(({id,parentId,kind,createdAt,records,newImages,bytes,schema,label})=>({id,parentId,kind,createdAt,records,newImages,bytes,schema,label}));
  }
  status():BackupStatus {
    const settings=this.settings,checkpoint=this.checkpoint();let points:BackupPoint[]=[],repositoryError:string|null=null,ready=false;
    try {const repository=this.repository();points=this.list();if(repository&&checkpoint&&repository.id===checkpoint.repositoryId&&repository.libraryId===this.journal.get('libraryId')) {
      const chain=this.chain(checkpoint.id);ready=chain.at(-1)!.hash===checkpoint.hash&&checkpoint.schema===this.journal.schema;
      if(checkpoint.schema!==this.journal.schema)repositoryError='资料结构已更新，请手动建立新的基准；自动备份已暂停。';
    }} catch(error) {repositoryError=(error as Error).message;}
    const cursor=ready?checkpoint!.cursor:0;
    return {settings,libraryId:this.journal.get('libraryId')!,generation:this.journal.get('generation')!,busy:this.busy,phase:this.phase,needsBaseline:!ready,pendingChanges:Number((this.db.prepare('SELECT count(*) AS n FROM _backup_journal WHERE seq>?').get(cursor) as {n:number}).n),headId:ready?checkpoint!.id:null,points,lastAttempt:this.journal.get('lastAttempt'),lastSuccess:this.journal.get('lastSuccess'),lastError:this.journal.get('lastError')||null,repositoryError};
  }
  saveSettings(raw:BackupSettings):BackupStatus {
    if(this.store.closing)fail('BUSY','软件正在退出，暂时不能修改备份设置。');
    if(this.busy)fail('BUSY','正在处理备份，请稍后再修改设置。');
    if(!raw||typeof raw.directory!=='string'||!raw.directory.trim()||raw.directory.length>1000||!isAbsolute(raw.directory)||typeof raw.automatic!=='boolean'||![5,15,30,60,120,360,1440].includes(raw.intervalMinutes)||![0,7,30,90,365].includes(raw.retentionDays))fail('VALIDATION','请填写有效目录和备份频率。');
    const settings={...raw,directory:resolve(raw.directory.trim())};
    this.ensureDirectory(settings.directory);
    const repository=this.repository(settings.directory);
    if(settings.automatic&&repository&&repository.libraryId!==this.journal.get('libraryId'))fail('VALIDATION','这个备份库属于另一份资料。请先关闭自动备份并预览恢复，或选择新的空目录。');
    this.journal.set('settings',JSON.stringify(settings));this.nextAutomatic=0;this.previews.clear();return this.status();
  }
  estimate():BackupEstimate {
    return this.journal.read(()=>{
      const rows=this.journal.allRows(),files=[...new Set((this.db.prepare('SELECT file_name FROM assets').all() as {file_name:string}[]).map(a=>a.file_name))];
      let bytes=Buffer.byteLength(JSON.stringify(rows));for(const name of files){if(!imageName.test(name))fail('BACKUP_INVALID','素材文件名无效。');bytes+=statSync(join(this.store.mediaDir,name)).size;}
      return {records:rows.length,images:files.length,bytes,worlds:rows.filter(r=>r.table==='worlds').length,works:rows.filter(r=>r.table==='works').length,generation:this.journal.get('generation')!,sequence:this.journal.sequence()};
    });
  }
  private async exclusive<T>(phase:string,action:()=>Promise<T>):Promise<T> {
    if(this.store.closing)fail('BUSY','软件正在退出，暂时不能开始新的备份操作。');
    if(this.busy)return fail('BUSY','已有备份或恢复操作正在进行，请等待完成。');
    this.busy=true;this.phase=phase;
    try{return await action();}finally{this.busy=false;this.phase='';}
  }
  async baseline(input:{generation:string;sequence:number}):Promise<BackupRun> {
    return this.exclusive('建立手动基准',async()=>{
      if(!input||input.generation!==this.journal.get('generation')||input.sequence!==this.journal.sequence())fail('CONFLICT','资料已变更，请重新预览基准备份的范围。');
      return this.writePoint('baseline','手动基准');
    });
  }
  async increment():Promise<BackupRun> {return this.exclusive('保存增量',()=>this.writePoint('increment','手动增量'));}
  private async writePoint(kind:'baseline'|'increment',label:string):Promise<BackupRun> {
    this.journal.set('lastAttempt',iso());
    try {
      const root=this.settings.directory;this.ensureDirectory(root);let repository=this.repository(),checkpoint=this.checkpoint();
      if(repository&&repository.libraryId!==this.journal.get('libraryId'))fail('VALIDATION','该备份库属于另一份资料，请选择新的空目录或恢复其中的资料。');
      if(kind==='increment') {
        if(!repository||!checkpoint||checkpoint.repositoryId!==repository.id)fail('BASELINE_REQUIRED','请先手动建立基准。自动任务不会创建全量备份。');
        const parent=this.chain(checkpoint!.id).at(-1)!;
        if(parent.hash!==checkpoint!.hash)fail('BACKUP_INVALID','上次备份的校验值已改变。');
        if(checkpoint!.schema!==this.journal.schema)fail('SCHEMA_CHANGED','资料结构已改变，请手动建立新基准。自动任务不会转为全量。');
      } else checkpoint=null;
      const captured=this.journal.read(()=>{
        const through=this.journal.sequence(),from=checkpoint?.cursor??0;
        const rows=kind==='baseline'?this.journal.allRows():this.journal.changes(from,through);
        if(kind==='increment'&&rows.length!==through-from)fail('JOURNAL_GAP','变更日志不完整，已停止增量备份。请检查资料库或手动建立新基准。');
        return {from,through,rows,stream:this.journal.get('generation')!};
      });
      if(kind==='increment'&&!captured.rows.length){this.journal.set('lastError','');return {skipped:true,point:null};}
      if(!repository) {
        repository={format:1,id:randomUUID(),libraryId:this.journal.get('libraryId')!};
        await durableFile(join(root,'repository.json'),JSON.stringify(repository));
      }
      const files=[...new Set(captured.rows.filter(r=>r.table==='assets'&&r.row).map(r=>String(r.row!.file_name)))];
      const images:ImageRecord[]=[];let newImages=0,imageBytes=0;
      for(const fileName of files) {
        if(!imageName.test(fileName))fail('BACKUP_INVALID','素材文件名无效。');
        const bytes=await readFile(join(this.store.mediaDir,fileName)),hash=digest(bytes),path=join(root,'objects',fileName);
        if(hash!==fileName.slice(0,64))fail('BACKUP_INVALID',`素材 ${fileName.slice(0,8)} 内容校验失败，备份未完成。`);
        if(existsSync(path)){if(digest(safeRead(root,path))!==hash)fail('BACKUP_INVALID','备份中的图片校验失败，未覆盖已有备份。');}
        else {await durableFile(path,bytes);newImages++;imageBytes+=bytes.length;}
        images.push({fileName,hash,size:bytes.length});
      }
      const id=randomUUID(),path=join(root,'points',id),data=JSON.stringify(captured.rows);
      mkdirSync(path);await durableFile(join(path,'records.json'),data);
      const manifest:Manifest={format:1,id,parentId:checkpoint?.id??null,parentHash:checkpoint?.hash??null,repositoryId:repository.id,libraryId:repository.libraryId,kind,createdAt:iso(),records:captured.rows.length,newImages,bytes:Buffer.byteLength(data)+imageBytes,schema:this.journal.schema,label,stream:captured.stream,from:captured.from,through:captured.through,dataHash:digest(data),images};
      const hash=digest(JSON.stringify(manifest));
      // A directory without this final file is an interrupted attempt, not a recovery point.
      await durableFile(join(path,'manifest.json'),JSON.stringify({manifest,hash}));
      if(digest(safeRead(root,join(path,'records.json')))!==manifest.dataHash)fail('BACKUP_INVALID','写入后校验失败，未推进备份位置。');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.journal.set('checkpoint',JSON.stringify({repositoryId:repository.id,id,hash,cursor:captured.through,schema:this.journal.schema} satisfies Checkpoint));
        this.journal.set('lastSuccess',manifest.createdAt);this.journal.set('lastError','');
        this.db.prepare('DELETE FROM _backup_journal WHERE seq<=?').run(captured.through);this.db.exec('COMMIT');
      } catch(error){this.db.exec('ROLLBACK');throw error;}
      return {skipped:false,point:manifest};
    } catch(error){this.journal.set('lastError',error instanceof ContentError?error.message:'备份未完成，请检查目录权限、可用空间和素材文件后重试。');throw error;}
  }
  private reconstruct(id:string,root:string):{db:Database;chain:Loaded[];images:Map<string,ImageRecord>} {
    const chain=this.chain(id,root),db=this.openDatabase(':memory:'),images=new Map<string,ImageRecord>();
    try {
      if(chain.at(-1)!.manifest.schema!==this.journal.schema&&!LEGACY_PACKAGE_SCHEMAS.has(chain.at(-1)!.manifest.schema))fail('SCHEMA_CHANGED','备份与当前软件的资料结构不兼容。备份已保留，请使用兼容版本恢复。');
      db.exec(this.journal.schemaSql);db.exec('PRAGMA foreign_keys=OFF; BEGIN');
      const tables=new Map(this.journal.tables.map(t=>[t.name,t]));
      for(const item of chain) {
        const data=safeRead(root,join(root,'points',item.manifest.id,'records.json'));
        if(digest(data)!==item.manifest.dataHash)fail('BACKUP_INVALID','备份内容校验失败，当前资料未被修改。');
        const rows=JSON.parse(data.toString('utf8')) as RowChange[];
        if(!Array.isArray(rows)||rows.length!==item.manifest.records)fail('BACKUP_INVALID','备份记录数量不匹配。');
        for(const change of rows) {
          const table=tables.get(change?.table)??fail('BACKUP_INVALID','备份记录的表无效。');
          if(!table||!Number.isSafeInteger(change.rowid)||change.rowid<1||change.row!==null&&(typeof change.row!=='object'||Array.isArray(change.row)||Object.keys(change.row).length!==table.columns.length||table.columns.some(c=>!Object.hasOwn(change.row!,c)||!(change.row![c]===null||typeof change.row![c]==='string'||typeof change.row![c]==='number'&&Number.isFinite(change.row![c])))))fail('BACKUP_INVALID','备份记录的表或字段无效。');
          if(change.row===null)db.prepare(`DELETE FROM ${quote(table.name)} WHERE rowid=?`).run(change.rowid);
          else {
            const columns=table.columns.map(quote).join(','),updates=table.columns.map(c=>`${quote(c)}=excluded.${quote(c)}`).join(',');
            db.prepare(`INSERT INTO ${quote(table.name)}(rowid,${columns}) VALUES(${Array(table.columns.length+1).fill('?').join(',')}) ON CONFLICT(rowid) DO UPDATE SET ${updates}`).run(change.rowid,...table.columns.map(c=>change.row![c]));
          }
        }
        for(const image of item.manifest.images)images.set(image.fileName,image);
      }
      db.exec('COMMIT');
      if((db.prepare('PRAGMA quick_check').get() as {quick_check:string}).quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)fail('BACKUP_INVALID','恢复后的数据库校验失败。');
      for(const table of this.journal.tables)for(const column of table.columns.filter(c=>c.endsWith('_json')))
        if(db.prepare(`SELECT 1 FROM ${quote(table.name)} WHERE NOT json_valid(${quote(column)}) LIMIT 1`).get())fail('BACKUP_INVALID','备份中存在无法读取的内容。');
      const referenced=new Set((db.prepare('SELECT file_name FROM assets').all() as {file_name:string}[]).map(r=>r.file_name));
      for(const name of referenced) {
        const image=images.get(name);if(!image||!imageName.test(name))fail('BACKUP_INVALID','恢复所需的图片不在备份清单中。');
        const bytes=safeRead(root,join(root,'objects',name));if(bytes.length!==image!.size||digest(bytes)!==image!.hash)fail('BACKUP_INVALID','恢复所需的图片缺失或损坏。');
      }
      for(const name of images.keys())if(!referenced.has(name))images.delete(name);
      // Exercise the real readers as well as SQLite's structural checks.
      new LibraryStore(db,this.directory).snapshot();
      return {db,chain,images};
    } catch(error){db.close();throw error;}
  }
  async previewRestore(id:string):Promise<RestorePreview> {
    return this.exclusive('校验恢复点',async()=>{
      const root=this.settings.directory,result=this.reconstruct(id,root);
      try {
        const count=(table:string)=>Number((result.db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get() as {n:number}).n);
        const token=randomUUID(),expires=Date.now()+10*60*1000;
        this.previews.clear();this.previews.set(token,{id,root,hash:result.chain.at(-1)!.hash,sequence:this.journal.sequence(),generation:this.journal.get('generation')!,expires});
        return {point:result.chain.at(-1)!.manifest,chainLength:result.chain.length,worlds:count('worlds'),works:count('works'),characters:count('characters'),chapters:count('chapters'),images:result.images.size,bytes:[...result.images.values()].reduce((n,i)=>n+i.size,0),token,expiresAt:new Date(expires).toISOString(),canProtectCurrent:!this.status().needsBaseline};
      } finally {result.db.close();}
    });
  }
  async restore(token:string):Promise<void> {
    return this.exclusive('恢复资料库',async()=>{
      const preview=this.previews.get(token);this.previews.delete(token);
      if(!preview||preview.expires<Date.now()||preview.root!==this.settings.directory||preview.sequence!==this.journal.sequence()||preview.generation!==this.journal.get('generation'))fail('CONFLICT','预览已过期或资料又有修改，请重新预览后恢复。');
      const valid=preview!;
      this.store.writesPaused=true;
      try {
      const restored=this.reconstruct(valid.id,valid.root);
      try {
        if(restored.chain.at(-1)!.hash!==valid.hash)fail('BACKUP_INVALID','预览后备份内容发生改变，请重新校验。');
        // Existing chains protect pending changes with an increment only. Never create a baseline here.
        if(!this.status().needsBaseline){
          await this.writePoint('increment','恢复前增量');
          const protection=this.reconstruct(this.checkpoint()!.id,valid.root);
          protection.db.close();
        }
        for(const image of restored.images.values()) {
          const destination=join(this.store.mediaDir,image.fileName),bytes=safeRead(valid.root,join(valid.root,'objects',image.fileName));
          if(!existsSync(destination)||digest(readFileSync(destination))!==image.hash)await durableFile(destination,bytes);
        }
        if(valid.sequence!==this.journal.sequence())fail('CONFLICT','恢复准备期间有新的保存，请重新预览。');
        const rows=this.journal.allRows(restored.db),point=restored.chain.at(-1)!;
        this.db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
        try {
          this.journal.set('recording','0');
          for(const table of this.journal.tables)this.db.exec(`DELETE FROM ${quote(table.name)}`);
          for(const table of this.journal.tables) {
            const statement=this.db.prepare(`INSERT INTO ${quote(table.name)}(rowid,${table.columns.map(quote).join(',')}) VALUES(${Array(table.columns.length+1).fill('?').join(',')})`);
            for(const change of rows.filter(r=>r.table===table.name))statement.run(change.rowid,...table.columns.map(c=>change.row![c]));
          }
          if(this.db.prepare('PRAGMA foreign_key_check').all().length)fail('BACKUP_INVALID','恢复内容的关联校验失败。');
          this.store.snapshot();
          this.journal.set('libraryId',point.manifest.libraryId);this.journal.set('generation',randomUUID());this.journal.set('requireGeneration','1');
          this.journal.set('checkpoint',JSON.stringify({repositoryId:point.manifest.repositoryId,id:valid.id,hash:valid.hash,cursor:this.journal.sequence(),schema:point.manifest.schema} satisfies Checkpoint));
          this.db.exec('DELETE FROM _backup_journal');this.journal.set('recording','1');this.journal.set('lastError','');
          this.db.exec('COMMIT');
        } catch(error){this.db.exec('ROLLBACK');throw error;}
        this.onRestored();
      } finally {restored.db.close();}
      } finally {this.store.writesPaused=false;}
    });
  }
  async deletePoint(id:string):Promise<void> {
    return this.exclusive('删除恢复点',async()=>{
      const points=this.list();this.manifest(id);
      if(id===this.checkpoint()?.id||points.some(p=>p.parentId===id))fail('DEPENDENCY','这个恢复点仍被后续增量或当前备份链使用，不能单独删除。');
      this.removePoint(id);this.pruneImages();this.previews.clear();
    });
  }
  private removePoint(id:string) {
    if(!uuid.test(id))fail('VALIDATION','恢复点编号无效。');
    const root=this.settings.directory,path=join(root,'points',id);
    for(const name of ['records.json','manifest.json'])safeRead(root,join(path,name));
    // Delete only known managed files, never recursively remove a user-selected folder.
    unlinkSync(join(path,'manifest.json'));unlinkSync(join(path,'records.json'));try{rmdirSync(path);}catch{/* Partial temporary files may remain for inspection. */}
  }
  private retention() {
    const days=this.settings.retentionDays;if(!days)return;
    const points=this.list(),protectedIds=new Set<string>(),byId=new Map(points.map(p=>[p.id,p])),cutoff=Date.now()-days*86400000;
    for(const point of points)this.chain(point.id);
    const protect=(id:string|null)=>{while(id&&!protectedIds.has(id)){protectedIds.add(id);id=byId.get(id)?.parentId??null;}};
    protect(this.checkpoint()?.id??null);for(const point of points)if(Date.parse(point.createdAt)>=cutoff)protect(point.id);
    const candidates=new Set(points.filter(p=>!protectedIds.has(p.id)).map(p=>p.id));
    while(candidates.size) {
      const leaves=[...candidates].filter(id=>![...candidates].some(other=>byId.get(other)?.parentId===id));if(!leaves.length)fail('BACKUP_INVALID','备份依赖链无效，已停止清理。');
      for(const id of leaves){this.removePoint(id);candidates.delete(id);}
    }
    this.pruneImages();
  }
  private pruneImages() {
    const root=this.settings.directory,needed=new Set<string>();
    // Read every surviving manifest before deleting anything. Corruption cancels cleanup.
    for(const point of this.list()){
      this.chain(point.id);
      for(const image of this.manifest(point.id).manifest.images)needed.add(image.fileName);
    }
    const objects=join(root,'objects');
    if(!existsSync(objects))return;
    for(const name of readdirSync(objects))if(imageName.test(name)&&!needed.has(name)){safeRead(root,join(objects,name));unlinkSync(join(objects,name));}
  }
  async tick(now=Date.now()):Promise<void> {
    if(this.store.closing)return;
    const settings=this.settings;if(!settings.automatic||this.busy||now<this.nextAutomatic)return;
    this.nextAutomatic=now+settings.intervalMinutes*60000;
    try {await this.exclusive('自动增量备份',async()=>{await this.writePoint('increment','自动增量');this.retention();});}
    catch(error){this.journal.set('lastError',error instanceof ContentError?error.message:'自动增量备份未完成，请检查备份目录和磁盘空间。');}
  }
  start() {if(!this.timer){this.nextAutomatic=Date.now()+60000;this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();}}
  stop() {if(this.timer)clearInterval(this.timer);this.timer=undefined;}
  async waitIdle() {while(this.busy)await new Promise<void>(done=>setTimeout(done,50));}
  async invoke(name:string,args:unknown):Promise<unknown> {
    if(!Array.isArray(args))fail('VALIDATION','请使用 args 参数数组。');const a=args as unknown[];
    const noArgs=['getBackupStatus','estimateBackup','runIncrementalBackup'];
    if(a.length!==(noArgs.includes(name)?0:1))fail('VALIDATION','备份接口参数数量不正确。');
    switch(name){
      case 'getBackupStatus':return this.status();
      case 'saveBackupSettings':return this.saveSettings(a[0] as BackupSettings);
      case 'estimateBackup':return this.estimate();
      case 'createBackupBaseline':return this.baseline(a[0] as {generation:string;sequence:number});
      case 'runIncrementalBackup':return this.increment();
      case 'previewBackupRestore':if(typeof a[0]!=='string')fail('VALIDATION','恢复点编号无效。');return this.previewRestore(a[0] as string);
      case 'restoreBackup':if(typeof a[0]!=='string')fail('VALIDATION','恢复预览编号无效。');return this.restore(a[0] as string);
      case 'deleteBackupPoint':if(typeof a[0]!=='string')fail('VALIDATION','恢复点编号无效。');return this.deletePoint(a[0] as string);
      default:return fail('NOT_FOUND','没有这个备份操作。');
    }
  }
}
