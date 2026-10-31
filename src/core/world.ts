import { randomUUID } from 'node:crypto';
import type { Database } from './store.ts';
import type { Character, Asset, WorldCategory, WorldCategoryInput, WorldEntry, WorldEntryInput, WorldLink } from '../shared/types.ts';

type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class WorldStore {
  private db:Database;
  private transaction:<T>(operation:()=>T)=>T;
  private character:(id:string)=>Character;
  private asset:(id:string)=>Asset|undefined;
  private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,character:(id:string)=>Character,asset:(id:string)=>Asset|undefined,fail:Reject) {
    this.db=db;this.transaction=transaction;this.character=character;this.asset=asset;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS world_categories(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),name TEXT NOT NULL,category_json TEXT NOT NULL,UNIQUE(world_id,name));
      CREATE TABLE IF NOT EXISTS world_entries(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),category_id TEXT NOT NULL REFERENCES world_categories(id),entry_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS world_entries_world ON world_entries(world_id);
      CREATE TABLE IF NOT EXISTS world_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,entity_kind TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_kind,entity_id,version));`);
  }
  private world(id:unknown):asserts id is string {if(!validId(id)||!this.db.prepare('SELECT id FROM worlds WHERE id=?').get(id))this.fail('VALIDATION','所属世界不存在。');}
  private text(value:unknown,label:string,max:number):string {if(typeof value!=='string'||value.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);return value;}
  private version(value:unknown) {if(!Number.isSafeInteger(value)||Number(value)<0)this.fail('VALIDATION','资料版本不正确。');}
  snapshot():{worldCategories:WorldCategory[];worldEntries:WorldEntry[]} {
    return {
      worldCategories:this.db.prepare('SELECT category_json FROM world_categories ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).category_json))),
      worldEntries:this.db.prepare('SELECT entry_json FROM world_entries ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).entry_json)))
    };
  }
  private category(id:unknown):WorldCategory {
    if(!validId(id))return this.fail('VALIDATION','分类编号不正确。');
    const row=this.db.prepare('SELECT category_json FROM world_categories WHERE id=?').get(id) as Row|undefined;
    return row?JSON.parse(String(row.category_json)):this.fail('NOT_FOUND','分类不存在。');
  }
  getEntry(id:unknown):WorldEntry {
    if(!validId(id))return this.fail('VALIDATION','条目编号不正确。');
    const row=this.db.prepare('SELECT entry_json FROM world_entries WHERE id=?').get(id) as Row|undefined;
    return row?JSON.parse(String(row.entry_json)):this.fail('NOT_FOUND','设定条目不存在。');
  }
  private history(kind:string,id:string,version:number,action:string,snapshot:unknown) {
    this.db.prepare('INSERT INTO world_history(entity_id,entity_kind,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').run(id,kind,version,action,JSON.stringify(snapshot),new Date().toISOString());
  }
  private write(entry:WorldEntry,action:string):WorldEntry {
    this.db.prepare('INSERT INTO world_entries(id,world_id,category_id,entry_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,entry_json=excluded.entry_json').run(entry.id,entry.worldId,entry.categoryId,JSON.stringify(entry));
    // Keep readable names in revisions; current references continue resolving by stable IDs.
    const references=entry.links.map(link=>({...link,name:(link.kind==='character'?this.character(link.targetId):this.getEntry(link.targetId)).name}));
    this.history('entry',entry.id,entry.version,action,{...entry,category:this.category(entry.categoryId),references});
    return entry;
  }
  saveCategory(raw:unknown):WorldCategory {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','分类格式不正确。');
    const input=raw as WorldCategoryInput;this.world(input.worldId);this.version(input.expectedVersion);
    const name=this.text(input.name,'分类名称',60).trim(),description=this.text(input.description,'分类说明',1000);
    if(!name||(input.id!==undefined&&!validId(input.id))||typeof input.active!=='boolean'||typeof input.color!=='string'||!/^#[\da-f]{6}$/i.test(input.color))return this.fail('VALIDATION','请填写分类名称、颜色和有效状态。');
    return this.transaction(()=>{
      const old=input.id?this.category(input.id):undefined;
      if(old&&old.worldId!==input.worldId)this.fail('VALIDATION','不能迁移分类所属世界。');
      if((old?.version??0)!==input.expectedVersion)this.fail('CONFLICT','分类已有修改，请重新打开配置。');
      if(this.snapshot().worldCategories.some(c=>c.worldId===input.worldId&&c.id!==input.id&&c.name===name))this.fail('VALIDATION','这个分类名称已经存在。');
      const category:WorldCategory={id:old?.id??randomUUID(),worldId:input.worldId,name,color:input.color.toLowerCase(),description,active:input.active,version:(old?.version??0)+1};
      this.db.prepare('INSERT INTO world_categories(id,world_id,name,category_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category_json=excluded.category_json').run(category.id,category.worldId,name,JSON.stringify(category));
      this.history('category',category.id,category.version,old?'编辑分类':'新建分类',category);
      if(old)for(const entry of this.snapshot().worldEntries.filter(e=>e.categoryId===category.id))this.write({...entry,version:entry.version+1,updatedAt:new Date().toISOString()},'更新所属分类');
      return category;
    });
  }
  saveEntry(raw:unknown):WorldEntry {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','设定条目格式不正确。');
    const input=raw as WorldEntryInput;this.world(input.worldId);this.version(input.expectedVersion);this.version(input.expectedCategoryVersion);
    if((input.id!==undefined&&!validId(input.id))||!validId(input.categoryId))return this.fail('VALIDATION','条目编号或所属分类不正确。');
    const name=this.text(input.name,'条目名称',200).trim(),aliases=this.text(input.aliases,'别名',1000),summary=this.text(input.summary,'摘要',3000),body=this.text(input.body,'正文',100000),pending=this.text(input.pending,'待讨论内容',30000),source=this.text(input.source,'来源',3000);
    if(!name||!['draft','pending','adopted'].includes(input.status))return this.fail('VALIDATION','请填写条目名称和有效的设定状态。');
    if(!Array.isArray(input.facts)||input.facts.length>60||!Array.isArray(input.links)||input.links.length>100)return this.fail('VALIDATION','自定义字段最多 60 项，关联最多 100 项。');
    const ids=new Set<string>();
    const facts=input.facts.map(f=>{
      if(!f||!validId(f.id)||ids.has(f.id))return this.fail('VALIDATION','字段编号无效或重复。');
      ids.add(f.id);const label=this.text(f.label,'字段名称',80).trim();if(!label)this.fail('VALIDATION','字段名称不能为空。');
      return {id:f.id,label,value:this.text(f.value,'字段内容',10000)};
    });
    return this.transaction(()=>{
      const old=input.id?this.getEntry(input.id):undefined;
      if(old&&old.worldId!==input.worldId)this.fail('VALIDATION','不能迁移条目所属世界。');
      if((old?.version??0)!==input.expectedVersion)this.fail('CONFLICT','条目已有修改，请重新打开后编辑。你的输入仍保留。');
      if(old?.archived)this.fail('VALIDATION','请先恢复条目，再编辑。');
      const category=this.category(input.categoryId);
      if(category.worldId!==input.worldId)this.fail('VALIDATION','请选择当前世界的分类。');
      if(category.version!==input.expectedCategoryVersion)this.fail('CONFLICT','所属分类已有修改，请重新打开编辑。');
      if(!category.active&&old?.categoryId!==category.id)this.fail('VALIDATION','这个分类已停用，请恢复后使用。');
      if(input.imageId!==null&&(!validId(input.imageId)||this.asset(input.imageId)?.worldId!==input.worldId))this.fail('VALIDATION','图片不属于当前世界。');
      const targets=new Set<string>();
      const links:WorldLink[]=input.links.map(link=>{
        if(!link||!['character','entry'].includes(link.kind)||!validId(link.targetId))return this.fail('VALIDATION','关联目标不正确。');
        if(link.kind==='entry'&&link.targetId===old?.id)this.fail('VALIDATION','条目不能关联自身。');
        const key=`${link.kind}:${link.targetId}`;if(targets.has(key))this.fail('VALIDATION','同一个目标请只关联一次。');targets.add(key);
        const target=link.kind==='character'?this.character(link.targetId):this.getEntry(link.targetId);
        if(target.worldId!==input.worldId)this.fail('VALIDATION','关联目标必须属于当前世界。');
        if(target.archived&&!old?.links.some(l=>l.kind===link.kind&&l.targetId===link.targetId))this.fail('VALIDATION','请先恢复目标，再添加关联。');
        return {kind:link.kind,targetId:link.targetId,label:this.text(link.label,'关联说明',200)};
      });
      const entry:WorldEntry={id:old?.id??randomUUID(),worldId:input.worldId,categoryId:category.id,name,aliases,summary,body,pending,source,status:input.status,facts,imageId:input.imageId,links,archived:false,version:(old?.version??0)+1,updatedAt:new Date().toISOString()};
      return this.write(entry,old?'编辑设定条目':'新建设定条目');
    });
  }
  archiveEntry(id:unknown,version:unknown,archived:unknown):WorldEntry {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','归档状态不正确。');
    return this.transaction(()=>{
      const old=this.getEntry(id);if(old.version!==version)this.fail('CONFLICT','条目已有修改，请刷新后重试。');
      if(old.archived===archived)return old;
      return this.write({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档设定条目':'恢复设定条目');
    });
  }
}
