import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,unlinkSync,realpathSync} from 'node:fs';
import {join,relative} from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import {ContentError,LibraryStore,type Database} from './store.ts';
import {digest,quote,type BackupRow} from './backup-journal.ts';
import {TRANSFER_LIMIT,type TransferExportInput,type TransferFile,type TransferImportInput,type TransferPreview,type TransferResult} from '../shared/transfer.ts';
import {validateTransferSnapshot} from './transfer-validation.ts';
import {orderedChapters} from '../shared/chapters.ts';
import {schemaFingerprint,LEGACY_PACKAGE_SCHEMAS} from './schema-format.ts';
import {LIBRARY_SCHEMA} from './library-version.ts';

type RecordRow={table:string;row:BackupRow};
type PackageData={format:'wanxiang-package';version:1;schema:string;createdAt:string;rows:RecordRow[];images:{name:string;data:string}[]};
type Draft={name:string;body:string};
type Pending={expires:number;generation:string;sequence:number;preview:TransferPreview;data:PackageData|null;drafts:Draft[];workId?:string};
const fail=(message:string,code='VALIDATION'):never=>{throw new ContentError(code,message);};
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const imageName=/^[a-f0-9]{64}\.(png|jpg|webp)$/;
const idKey=(key:string)=>key==='id'||key.endsWith('Id')||key.endsWith('Ids');
const sqlId=(key:string)=>key==='id'||key.endsWith('_id');
const dictionary=(key:string)=>['values','versions','positions','attributeValues'].includes(key);
const filename=(name:string)=>name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'万象工坊';

/** Rebind identifiers only: prose, filenames and captured text remain verbatim. */
function identifiers(value:unknown,convert:(id:string)=>string,key='',depth=0):unknown {
  if(depth>80)fail('资料结构层级过深。');
  if(typeof value==='string')return idKey(key)?convert(value):value;
  if(Array.isArray(value))return value.map(v=>identifiers(v,convert,dictionary(key)?'':key,depth+1));
  if(object(value)&&key==='values')return Object.fromEntries(Object.entries(value).map(([template,dimensions])=>[convert(template),object(dimensions)?Object.fromEntries(Object.entries(dimensions).map(([dimension,number])=>[convert(dimension),number])):dimensions]));
  if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[dictionary(key)?convert(k):k,identifiers(v,convert,k,depth+1)]));
  return value;
}

export class TransferService {
  private pending=new Map<string,Pending>();
  constructor(privateStore:LibraryStore){this.store=privateStore;}
  private readonly store:LibraryStore;
  private get db(){return this.store.journal.db;}
  private get tables(){return this.store.journal.tables.filter(t=>t.name!=='meta');}
  private insert(db:Database,rows:RecordRow[]) {
    for(const {table,row} of rows){
      // Table and column names always come from our own schema, never package SQL.
      const shape=this.tables.find(t=>t.name===table)??fail('资料包包含未知表。');
      const columns=shape.columns.filter(c=>!(c==='id'&&typeof row[c]==='number'));
      db.prepare(`INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));
    }
  }
  private readImage(name:string) {
    if(!imageName.test(name))fail('图片名称无效。');
    const path=join(this.store.mediaDir,name);
    if(!existsSync(path)||relative(realpathSync(this.store.mediaDir),realpathSync(path))!==name)fail('资料中的图片文件缺失或路径无效。');
    const bytes=readFileSync(path);if(digest(bytes)!==name.slice(0,64))fail('图片校验失败，请先检查原始文件。');return bytes;
  }
  export(input:TransferExportInput):TransferFile {
    if(!input||!['package','markdown','text'].includes(input.format)||!['library','world','work'].includes(input.scope)||input.includeArchived!==undefined&&typeof input.includeArchived!=='boolean')fail('请选择有效的导出格式和范围。');
    return this.store.journal.read(()=>{
      const s=this.store.snapshot();
      const selectedWork=input.scope==='work'?this.store.workspace.getWork(input.id):null;
      const selectedWorld=input.scope==='world'?this.store.workspace.getWorld(input.id):null;
      const label=selectedWork?.name??selectedWorld?.name??'全部资料';
      if(input.format!=='package') {
        if(!selectedWork)fail('正文导出需要选择一部作品。');
        const outline=this.store.chapters.getOutline(selectedWork!.id);
        const chapters=orderedChapters(outline,s.chapters).filter(c=>input.includeArchived||!c.archived);
        const markdown=input.format==='markdown';
        const content=(markdown?`# ${label}\n\n`:'')+chapters.map((c,i)=>`${markdown?'## ':`第${i+1}章 `}${c.name}\n\n${c.body}`).join('\n\n')+'\n';
        return {name:filename(label)+(markdown?'.md':'.txt'),content};
      }
      const worlds=new Set(s.worlds.filter(w=>input.scope==='library'||w.id===(selectedWork?.worldId??selectedWorld?.id)).map(w=>w.id));
      const works=new Set(s.works.filter(w=>worlds.has(w.worldId)&&(!selectedWork||w.id===selectedWork.id)).map(w=>w.id));
      const all=this.store.journal.allRows().filter(r=>r.table!=='meta').map(r=>({table:r.table,row:r.row!}));
      // World-owned records first, then dependent records and histories. Work export
      // includes the complete shared world, but no other work's chapters or plans.
      const ids=new Set<string>([...worlds,...works]);
      const chosen=new Set<RecordRow>();
      for(let round=0;round<5;round++)for(const item of all){
        const r=item.row;
        const take=item.table==='worlds'?worlds.has(String(r.id)):item.table==='works'?works.has(String(r.id)):
          r.work_id!==undefined?works.has(String(r.work_id)):
          r.world_id!==undefined?worlds.has(String(r.world_id)):
          r.character_id!==undefined?ids.has(String(r.character_id)):
          r.asset_id!==undefined?ids.has(String(r.asset_id)):
          r.entity_id!==undefined?ids.has(String(r.entity_id)):false;
        if(take){chosen.add(item);if(typeof r.id==='string')ids.add(r.id);}
      }
      const rows=all.filter(r=>chosen.has(r));
      const names=[...new Set(rows.filter(r=>r.table==='assets').map(r=>String(r.row.file_name)))];
      let total=Buffer.byteLength(JSON.stringify(rows));
      const images=names.map(name=>{const bytes=this.readImage(name);total+=Math.ceil(bytes.length/3)*4;if(total>TRANSFER_LIMIT-4096)fail('资料包超过 64 MB，请改为按作品或世界导出。','TOO_LARGE');return {name,data:bytes.toString('base64')};});
      const data:PackageData={format:'wanxiang-package',version:1,schema:schemaFingerprint(this.db),createdAt:new Date().toISOString(),rows,images};
      const content=JSON.stringify({data,sha256:digest(JSON.stringify(data))});
      if(Buffer.byteLength(content)>TRANSFER_LIMIT)fail('资料包超过 64 MB，请缩小导出范围。','TOO_LARGE');
      return {name:filename(label)+'.wanxiang',content};
    });
  }
  private decode(content:string):PackageData {
    try {
      const wrapper=JSON.parse(content),d=wrapper.data as PackageData;
      if(!object(d)||d.format!=='wanxiang-package'||d.version!==1||wrapper.sha256!==digest(JSON.stringify(d)))fail('资料包格式不正确或内容校验失败。');
      const currentSchema=schemaFingerprint(this.db);
      if(d.schema!==currentSchema&&d.schema!==this.store.journal.schema&&!(currentSchema===LIBRARY_SCHEMA&&LEGACY_PACKAGE_SCHEMAS.has(d.schema)))fail('资料包来自不同的数据结构版本，请用对应版本的软件导出。');
      if(!Array.isArray(d.rows)||d.rows.length>200000||!Array.isArray(d.images))fail('资料包记录数量无效。');
      for(const item of d.rows) {
        const shape=this.tables.find(t=>t.name===item?.table);
        if(!shape||!object(item.row)||Object.keys(item.row).length!==shape.columns.length||shape.columns.some(c=>!Object.hasOwn(item.row,c)||!(item.row[c]===null||typeof item.row[c]==='string'||typeof item.row[c]==='number'&&Number.isFinite(item.row[c]))))fail('资料包的表或字段无效。');
        for(const [k,v] of Object.entries(item.row)){
          if(k.endsWith('_json')){if(typeof v!=='string')fail('资料包包含无效内容。');identifiers(JSON.parse(v as string),id=>id);}
          if(sqlId(k)&&typeof v==='string'&&!/^[a-zA-Z0-9_-]{1,100}$/.test(v))fail('资料包编号无效。');
        }
      }
      const expected=new Set(d.rows.filter(r=>r.table==='assets').map(r=>String(r.row.file_name))),seen=new Set<string>();
      for(const i of d.images){
        if(!object(i)||typeof i.name!=='string'||!imageName.test(i.name)||typeof i.data!=='string'||seen.has(i.name)||!expected.has(i.name))fail('资料包图片清单无效。');
        const bytes=Buffer.from(i.data,'base64');
        if(bytes.length>25*1024*1024||bytes.toString('base64')!==i.data||digest(bytes)!==i.name.slice(0,64))fail('资料包图片缺失或损坏。');
        const ext=i.name.split('.').at(-1);
        if(ext==='png'?!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='jpg'?bytes[0]!==255||bytes[1]!==216:bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')fail('图片内容与格式不一致。');
        seen.add(i.name);
      }
      if(seen.size!==expected.size)fail('资料包缺少所需图片。');
      // Reconstruct into memory, with our schema and constraints, never execute
      // package SQL or load data into the user's library during preview.
      const db=new BetterSqlite3(':memory:');
      try {
        const temporary=new LibraryStore(db,join(this.store.mediaDir,'..'));
        temporary.importTransaction(()=>{
          db.exec('PRAGMA defer_foreign_keys=ON');this.insert(db,d.rows);
          if(db.prepare('PRAGMA foreign_key_check').all().length)fail('资料包有关联记录缺失。');
          validateTransferSnapshot(temporary,db,d.rows);
        });
      } finally {db.close();}
      return d;
    } catch(e){if(e instanceof ContentError)throw e;return fail('资料包内容无法读取或关联不完整，请重新导出。');}
  }
  private chapters(input:TransferImportInput):Draft[] {
    if(Buffer.byteLength(input.content)>2*1024*1024)fail('正文文件最多 2 MB。','TOO_LARGE');
    const text=input.content.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    if(text.includes('\0'))fail('正文包含无效字符，请使用 UTF-8 文本文件。');
    const title=input.name.replace(/\.(md|txt)$/i,'').slice(0,160)||'导入章节';
    if(input.split==='single')return [{name:title,body:text}];
    const markdown=/\.md$/i.test(input.name),lines=text.split('\n'),parts:Draft[]=[];let current:Draft={name:'前言',body:''},fence='';
    for(let index=0;index<lines.length;index++){
      const line=lines[index];
      const marker=markdown?/^\s{0,3}(`{3,}|~{3,})/.exec(line):null;
      if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence='';current.body+=(current.body?'\n':'')+line;continue;}
      if(markdown&&index===0&&/^#\s+/.test(line))continue;
      const match=fence?null:markdown?/^##\s+(.+?)\s*#*\s*$/.exec(line):/^\s*(第[零〇一二三四五六七八九十百千万两\d]+[章节回][^\n]{0,150})\s*$/.exec(line);
      if(match){if(current.body.trim()||parts.length||current.name!=='前言')parts.push({...current,body:current.body.replace(/^\n|\n$/g,'')});current={name:match[1].trim(),body:''};}
      else current.body+=(current.body?'\n':'')+line;
    }
    if(current.body.trim()||current.name!=='前言')parts.push({...current,body:current.body.replace(/^\n|\n$/g,'')});
    if(parts.length===1&&parts[0].name==='前言')parts[0].name=title;
    return parts;
  }
  preview(input:TransferImportInput):TransferPreview {
    if(!input||typeof input.name!=='string'||!input.name||input.name.length>250||typeof input.content!=='string'||!['headings','single',undefined].includes(input.split))fail('请选择有效的资料包或正文文件。');
    if(Buffer.byteLength(input.content)>TRANSFER_LIMIT)fail('导入文件不能超过 64 MB。','TOO_LARGE');
    for(const [token,p] of this.pending)if(p.expires<Date.now())this.pending.delete(token);
    if(this.pending.size>=3)fail('待确认的导入较多，请先确认或取消已有预览。');
    let data:PackageData|null=null,drafts:Draft[]=[];
    if(/\.wanxiang$/i.test(input.name))data=this.decode(input.content);
    else if(/\.(txt|md)$/i.test(input.name)){
      const work=this.store.workspace.getWork(input.workId);if(work.archived)fail('请先恢复目标作品，再导入章节。');
      drafts=this.chapters(input);
      if(!drafts.length||drafts.length>500||drafts.some(c=>!c.name||c.name.length>160||c.body.length>300000))fail('每次可导入 1–500 章，每章标题不超过 160 字、正文不超过 30 万字。');
      if(this.store.chapters.getOutline(work.id).chapterIds.length+drafts.length>10000)fail('导入后章节数超过一万章。');
    }else fail('请选择 .wanxiang、.txt 或 .md 文件。');
    const rows=data?.rows??[],count=(table:string)=>rows.filter(r=>r.table===table).length;
    const token=randomUUID(),expires=Date.now()+10*60*1000;
    const preview:TransferPreview={token,expiresAt:new Date(expires).toISOString(),kind:data?'package':'chapters',name:input.name,
      worlds:rows.filter(r=>r.table==='worlds').map(r=>String(r.row.name)),works:data?rows.filter(r=>r.table==='works').map(r=>String(r.row.name)):[this.store.workspace.getWork(input.workId).name],
      characters:count('characters'),entries:count('world_entries'),items:count('catalog_items'),techniques:count('catalog_techniques'),places:count('catalog_places'),images:count('assets'),chapters:data?count('chapters'):drafts.length,histories:rows.filter(r=>r.table.endsWith('_history')||r.table==='revisions').length,
      chapterPreviews:drafts.map(c=>({name:c.name,characters:c.body.length,excerpt:c.body.slice(0,300)})),
      warnings:data?['将创建独立的作品与世界副本，原有资料保留。','资料包包含已归档资料、修改历史与共用世界中的全部图片；请确认分享范围。','不包含软件偏好、连接密钥、自动备份设置或备份链。']:['将按预览顺序追加到目标作品的未分卷目录，不替换已有章节。','正文作为草稿导入。Markdown 保留文本标记，按二级标题分章；TXT 按“第…章／节／回”分章。']};
    this.pending.set(token,{expires,generation:this.store.journal.get('generation')!,sequence:this.store.journal.sequence(),preview,data,drafts,workId:input.workId});
    return preview;
  }
  cancel(input:{token:string}):void {if(typeof input?.token!=='string')fail('预览编号无效。');this.pending.delete(input.token);}
  confirm(input:{token:string}):TransferResult {
    if(typeof input?.token!=='string')fail('预览编号无效。');
    const p=this.pending.get(input.token)??fail('导入预览已过期，请重新选择文件并预览。','CONFLICT');this.pending.delete(input.token);
    if(p.expires<Date.now())fail('导入预览已过期，请重新选择文件并预览。','CONFLICT');
    if(p.generation!==this.store.journal.get('generation'))fail('资料库已经恢复，请重新读取后导入。','RESTORED');
    if(p.sequence!==this.store.journal.sequence())fail('预览后资料有新修改，请重新预览导入。','CONFLICT');
    const createdFiles:string[]=[],result:TransferResult={workIds:[],worldIds:[],chapterIds:[]};
    // A savepoint permits the normal chapter validators to use their own transactions.
    if(!p.data)return this.store.importTransaction(()=>{
      const work=this.store.workspace.getWork(p.workId);if(work.archived)fail('请先恢复目标作品。');
      for(const c of p.drafts){const outline=this.store.chapters.getOutline(work.id);result.chapterIds.push(this.store.chapters.save({workId:work.id,expectedVersion:0,expectedOutlineVersion:outline.version,volumeId:null,name:c.name,body:c.body,summary:'',notes:'',status:'draft',participants:[],events:[],entryIds:[],mapProgress:[]}).id);}
      result.workIds=[work.id];return result;
    });
    const mapping=new Map<string,string>(),convert=(id:string)=>{if(!id||id==='base')return id;if(!mapping.has(id))mapping.set(id,randomUUID());return mapping.get(id)!;};
    const rows=p.data.rows.map(({table,row})=>({table,row:Object.fromEntries(Object.entries(row).map(([k,v])=>[k,k.endsWith('_json')&&k!=='source_json'?JSON.stringify(identifiers(JSON.parse(String(v)),convert,k.replace(/_json$/,''))):sqlId(k)&&typeof v==='string'?convert(v):v])) as BackupRow}));
    try {
      for(const i of p.data.images){const path=join(this.store.mediaDir,i.name);if(existsSync(path)){this.readImage(i.name);continue;}writeFileSync(path,Buffer.from(i.data,'base64'),{flag:'wx'});createdFiles.push(path);}
      this.store.importTransaction(()=>{
        this.db.exec('PRAGMA defer_foreign_keys=ON');this.insert(this.db,rows);
        if(this.db.prepare('PRAGMA foreign_key_check').all().length)fail('导入关联校验失败。');
        this.store.snapshot();
      });
      result.workIds=rows.filter(r=>r.table==='works').map(r=>String(r.row.id));result.worldIds=rows.filter(r=>r.table==='worlds').map(r=>String(r.row.id));result.chapterIds=rows.filter(r=>r.table==='chapters').map(r=>String(r.row.id));return result;
    }catch(e){for(const path of createdFiles)try{unlinkSync(path);}catch{/* Unreferenced content-addressed file can be reused later. */}throw e;}
  }
}
