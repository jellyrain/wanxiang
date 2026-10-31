import type { Database } from './store.ts';
import type { Asset, MediaAsset, MediaCatalog, MediaCatalogInput, MediaInput, MediaLabel } from '../shared/types.ts';

type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class GalleryStore {
  private db:Database; private transaction:<T>(operation:()=>T)=>T; private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,fail:Reject) {
    this.db=db;this.transaction=transaction;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS media_metadata(asset_id TEXT PRIMARY KEY REFERENCES assets(id),metadata_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_info(asset_id TEXT PRIMARY KEY REFERENCES assets(id),width INTEGER NOT NULL,height INTEGER NOT NULL,byte_size INTEGER NOT NULL,imported_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_catalogs(world_id TEXT PRIMARY KEY REFERENCES worlds(id),catalog_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));
      CREATE TABLE IF NOT EXISTS media_catalog_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));`);
  }
  private text(v:unknown,label:string,max:number):string {if(typeof v!=='string'||v.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);return v;}
  private version(v:unknown) {if(!Number.isSafeInteger(v)||Number(v)<0)this.fail('VALIDATION','素材版本不正确。');}
  private world(id:unknown):string {if(!validId(id)||!this.db.prepare('SELECT id FROM worlds WHERE id=?').get(id))return this.fail('VALIDATION','所属世界不存在。');return id;}
  private fromRow(row:Row):MediaAsset {
    const asset:Asset={id:String(row.id),worldId:String(row.world_id),fileName:String(row.file_name),mime:String(row.mime),sourceName:String(row.source_name)};
    const metadata=row.metadata_json?JSON.parse(String(row.metadata_json)):{};
    return {name:asset.sourceName.replace(/\.[^.]+$/,'')||'未命名图片',description:'',source:'',prompt:'',categoryId:null,tagIds:[],favorite:false,archived:false,version:0,updatedAt:String(row.imported_at??''),...metadata,...asset,width:row.width===null?null:Number(row.width),height:row.height===null?null:Number(row.height),byteSize:row.byte_size===null?null:Number(row.byte_size),importedAt:String(row.imported_at??'')};
  }
  private select='SELECT a.*,m.metadata_json,i.width,i.height,i.byte_size,i.imported_at FROM assets a LEFT JOIN media_metadata m ON m.asset_id=a.id LEFT JOIN media_info i ON i.asset_id=a.id';
  get(id:unknown):MediaAsset {
    if(!validId(id))return this.fail('VALIDATION','素材编号不正确。');
    const row=this.db.prepare(`${this.select} WHERE a.id=?`).get(id) as Row|undefined;return row?this.fromRow(row):this.fail('NOT_FOUND','素材不存在。');
  }
  catalog(worldId:unknown):MediaCatalog {
    const id=this.world(worldId),row=this.db.prepare('SELECT catalog_json FROM media_catalogs WHERE world_id=?').get(id) as Row|undefined;
    return row?JSON.parse(String(row.catalog_json)):{worldId:id,categories:[],tags:[],version:0,updatedAt:''};
  }
  snapshot():{media:MediaAsset[];mediaCatalogs:MediaCatalog[]} {
    return {media:this.db.prepare(`${this.select} ORDER BY a.rowid`).all().map(r=>this.fromRow(r as Row)),mediaCatalogs:this.db.prepare('SELECT catalog_json FROM media_catalogs ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).catalog_json)))};
  }
  recordImport(id:string,width:number,height:number,byteSize:number) {
    this.get(id);
    if(![width,height,byteSize].every(v=>Number.isSafeInteger(v)&&v>0)||byteSize>25*1024*1024)return this.fail('VALIDATION','图片尺寸或文件大小不正确。');
    // Reimporting identical bytes never resets existing labels or import time.
    this.db.prepare('INSERT OR IGNORE INTO media_info(asset_id,width,height,byte_size,imported_at) VALUES(?,?,?,?,?)').run(id,width,height,byteSize,new Date().toISOString());
  }
  private write(media:MediaAsset,action:string):MediaAsset {
    const {name,description,source,prompt,categoryId,tagIds,favorite,archived,version,updatedAt}=media;
    const json=JSON.stringify({name,description,source,prompt,categoryId,tagIds,favorite,archived,version,updatedAt});
    this.db.prepare('INSERT INTO media_metadata(asset_id,metadata_json) VALUES(?,?) ON CONFLICT(asset_id) DO UPDATE SET metadata_json=excluded.metadata_json').run(media.id,json);
    this.db.prepare('INSERT INTO media_history(entity_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(media.id,version,action,JSON.stringify(media),updatedAt);
    return media;
  }
  save(raw:unknown):MediaAsset {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','素材资料格式不正确。');const input=raw as MediaInput;this.version(input.expectedVersion);
    const name=this.text(input.name,'素材名称',160).trim();if(!name)this.fail('VALIDATION','请填写素材名称。');
    if(typeof input.favorite!=='boolean'||(input.categoryId!==null&&!validId(input.categoryId))||!Array.isArray(input.tagIds)||input.tagIds.length>60||input.tagIds.some(id=>!validId(id))||new Set(input.tagIds).size!==input.tagIds.length)return this.fail('VALIDATION','素材分类、标签或收藏状态不正确。');
    const description=this.text(input.description,'素材说明',20000),source=this.text(input.source,'来源说明',5000),prompt=this.text(input.prompt,'生成提示词',30000);
    return this.transaction(()=>{
      const old=this.get(input.id),catalog=this.catalog(old.worldId);
      if(old.version!==input.expectedVersion)this.fail('CONFLICT','素材资料已有新修改，请保留当前输入并重新读取后核对。');
      if(old.archived)this.fail('VALIDATION','请先恢复素材，再编辑资料。');
      if(input.categoryId!==null){const c=catalog.categories.find(c=>c.id===input.categoryId);if(!c||(!c.active&&old.categoryId!==c.id))this.fail('VALIDATION','请选择当前世界已启用的素材分类。');}
      for(const id of input.tagIds){const tag=catalog.tags.find(t=>t.id===id);if(!tag||(!tag.active&&!old.tagIds.includes(id)))this.fail('VALIDATION','请选择当前世界已启用的素材标签。');}
      return this.write({...old,name,description,source,prompt,categoryId:input.categoryId,tagIds:[...input.tagIds],favorite:input.favorite,version:old.version+1,updatedAt:new Date().toISOString()},'编辑素材资料');
    });
  }
  archive(id:unknown,version:unknown,archived:unknown):MediaAsset {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','归档状态不正确。');return this.transaction(()=>{const old=this.get(id);if(old.version!==version)this.fail('CONFLICT','素材已有新修改，请重新读取后操作。');if(old.archived===archived)return old;return this.write({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档素材':'恢复素材');});
  }
  saveCatalog(raw:unknown):MediaCatalog {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','素材分类配置不正确。');const input=raw as MediaCatalogInput;this.version(input.expectedVersion);
    const labels=(items:unknown,label:string):MediaLabel[]=>{
      if(!Array.isArray(items)||items.length>100)return this.fail('VALIDATION',`${label}最多 100 项。`);const ids=new Set<string>(),names=new Set<string>();
      return items.map(item=>{if(!item||!validId(item.id)||ids.has(item.id)||typeof item.active!=='boolean'||!/^#[\da-fA-F]{6}$/.test(item.color))return this.fail('VALIDATION',`${label}编号、颜色或状态不正确。`);const name=this.text(item.name,label,60).trim();if(!name||names.has(name))this.fail('VALIDATION',`${label}名称不能为空或重复。`);ids.add(item.id);names.add(name);return {id:item.id,name,color:item.color.toLowerCase(),active:item.active};});
    };
    const categories=labels(input.categories,'分类'),tags=labels(input.tags,'标签');
    return this.transaction(()=>{const old=this.catalog(input.worldId);if(old.version!==input.expectedVersion)this.fail('CONFLICT','素材配置已有新修改，请重新读取后编辑。');if(old.categories.some(c=>!categories.some(n=>n.id===c.id))||old.tags.some(t=>!tags.some(n=>n.id===t.id)))this.fail('VALIDATION','已保存的分类与标签请停用，以保留原有关联。');const saved:MediaCatalog={worldId:old.worldId,categories,tags,version:old.version+1,updatedAt:new Date().toISOString()};this.db.prepare('INSERT INTO media_catalogs(world_id,catalog_json) VALUES(?,?) ON CONFLICT(world_id) DO UPDATE SET catalog_json=excluded.catalog_json').run(saved.worldId,JSON.stringify(saved));this.db.prepare('INSERT INTO media_catalog_history(entity_id,version,snapshot_json,created_at) VALUES(?,?,?,?)').run(saved.worldId,saved.version,JSON.stringify(saved),saved.updatedAt);return saved;});
  }
}
