import {createHash,randomUUID} from 'node:crypto';
import {ContentError,type Database,type LibraryStore} from './store.ts';
import type {CatalogKind,CatalogRecord,LibraryConfig,LibraryConfigInput,RecordKind,RecordConfig} from '../shared/types.ts';
import {emptyRecordConfig,initialItemCategories,recordKinds} from '../shared/library-config.ts';

const fail=(message:string,code='VALIDATION'):never=>{throw new ContentError(code,message);};
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const legacyId=(kind:string,name:string)=>'legacy-'+kind+'-'+createHash('sha256').update(name).digest('hex').slice(0,24);
export class LibraryConfigStore {
  private db:Database;
  private store:LibraryStore;
  constructor(db:Database,store:LibraryStore){
    this.db=db;this.store=store;
    db.exec(`CREATE TABLE IF NOT EXISTS library_configs(world_id TEXT PRIMARY KEY REFERENCES worlds(id),config_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS library_config_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));`);
  }
  get(worldId:string):LibraryConfig {
    this.store.workspace.getWorld(worldId);
    const row=this.db.prepare('SELECT config_json FROM library_configs WHERE world_id=?').get(worldId) as {config_json:string}|undefined;
    if(row)return JSON.parse(row.config_json);
    const groups:Record<RecordKind,RecordConfig>={character:emptyRecordConfig(),item:emptyRecordConfig(),technique:emptyRecordConfig(),place:emptyRecordConfig()};
    groups.item.categories=initialItemCategories.map(([id,name])=>({id,name,active:true}));
    const previous=this.db.prepare('SELECT template_id FROM attribute_defaults WHERE world_id=?').get(worldId) as {template_id:string|null}|undefined;
    groups.character.templateId=previous?.template_id??null;
    for(const kind of ['technique','place'] as const){
      const rows=this.db.prepare(`SELECT record_json FROM catalog_${kind==='technique'?'techniques':'places'} WHERE world_id=?`).all(worldId) as {record_json:string}[];
      const names=new Set(rows.map(r=>{const v=JSON.parse(r.record_json);return String(kind==='technique'?v.school:v.placeType);}).filter(Boolean));
      groups[kind].categories=[...names].map(name=>({id:legacyId(kind,name),name,active:true}));
    }
    return {worldId,groups,version:0,updatedAt:''};
  }
  snapshot(){return this.store.workspace.worlds().map(w=>this.get(w.id));}
  categoryId(record:CatalogRecord):string|null {
    if(record.categoryId!==undefined)return record.categoryId;
    const categories=this.get(record.worldId).groups[record.kind].categories;
    return (record.kind==='item'?categories.find(c=>c.id===record.itemType):categories.find(c=>c.name===(record.kind==='technique'?record.school:record.placeType)))?.id??null;
  }
  private write(config:LibraryConfig){
    const saved={...config,version:config.version+1,updatedAt:new Date().toISOString()},json=JSON.stringify(saved);
    this.db.prepare('INSERT INTO library_configs(world_id,config_json) VALUES(?,?) ON CONFLICT(world_id) DO UPDATE SET config_json=excluded.config_json').run(saved.worldId,json);
    this.db.prepare('INSERT INTO library_config_history(entity_id,version,snapshot_json,created_at) VALUES(?,?,?,?)').run(saved.worldId,saved.version,json,saved.updatedAt);
    const previous=this.db.prepare('SELECT template_id FROM attribute_defaults WHERE world_id=?').get(saved.worldId) as {template_id:string|null}|undefined;
    if((previous?.template_id??null)!==saved.groups.character.templateId)this.db.prepare('INSERT INTO attribute_defaults(world_id,template_id,version) VALUES(?,?,1) ON CONFLICT(world_id) DO UPDATE SET template_id=excluded.template_id,version=version+1').run(saved.worldId,saved.groups.character.templateId);
    return saved;
  }
  save(raw:unknown,restore=false):LibraryConfig {
    if(!raw||typeof raw!=='object')return fail('资料配置格式不正确。');
    const input=raw as LibraryConfigInput;
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||!input.groups)return fail('资料配置版本或内容不正确。');
    return this.store.importTransaction(()=>{
      const old=this.get(input.worldId);if(old.version!==input.expectedVersion)return fail('资料配置已有修改，请重新打开后核对。','CONFLICT');
      const templates=this.store.attributeTemplates(input.worldId),groups={} as LibraryConfig['groups'];
      for(const kind of Object.keys(recordKinds) as RecordKind[]){
        const group=input.groups[kind];if(!group||!Array.isArray(group.categories)||group.categories.length>200||!Array.isArray(group.fields)||group.fields.length>60)return fail('每类最多 200 个分类、60 个补充字段。');
        const ids=new Set<string>(),names=new Set<string>();
        const categories=group.categories.map(c=>{if(!c||!validId(c.id)||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>200||names.has(c.name.trim().toLocaleLowerCase())||typeof c.active!=='boolean')return fail('分类名称或编号无效、重复。');ids.add(c.id);names.add(c.name.trim().toLocaleLowerCase());return {id:c.id,name:c.name.trim(),active:c.active};});
        const missing=old.groups[kind].categories.filter(c=>!ids.has(c.id));
        if(missing.length&&!restore)return fail('删除分类请先预览影响范围。');
        if(missing.length&&kind!=='character'&&this.uses(kind,old.worldId).some(r=>missing.some(c=>c.id===r.categoryId)))return fail('旧配置会移除正在使用的类别，请先转移资料。');
        const labels=new Set<string>(),fieldIds=new Set<string>();
        const fields=group.fields.map(f=>{if(!f||!validId(f.id)||fieldIds.has(f.id)||typeof f.label!=='string'||!f.label.trim()||f.label.trim().length>100||labels.has(f.label.trim())||typeof f.value!=='string'||f.value.length>10000)return fail('补充字段名称或默认内容无效、重复。');labels.add(f.label.trim());fieldIds.add(f.id);return {id:f.id,label:f.label.trim(),value:f.value};});
        if(group.templateId!==null&&!templates.some(t=>t.id===group.templateId))return fail('请选择当前世界的数值模板。');
        groups[kind]={categories,fields,templateId:group.templateId};
      }
      for(const kind of ['item','technique','place'] as const){
        const renamed=groups[kind].categories.filter(c=>old.groups[kind].categories.some(v=>v.id===c.id&&v.name!==c.name));
        if(renamed.length)for(const record of this.uses(kind,old.worldId)){const category=renamed.find(c=>c.id===record.categoryId);if(category)this.store.catalogs.changeCategory(record,category.id,category.name);}
      }
      return this.write({...old,groups});
    });
  }
  uses(kind:CatalogKind,worldId:string){const s=this.store.catalogs.snapshot();return (kind==='item'?s.items:kind==='technique'?s.techniques:s.places).filter(r=>r.worldId===worldId);}
  /** Backward-compatible full saves may still supply a flow/type name. */
  resolve(kind:CatalogKind,worldId:string,categoryId:unknown,legacy:string,old?:CatalogRecord):string|null {
    let config=this.get(worldId);
    if(config.version===0)config=this.write(config);
    let categories=config.groups[kind].categories;
    if(categoryId===undefined){
      const existing=kind==='item'?categories.find(c=>c.id===legacy):categories.find(c=>c.name===legacy);
      if(existing)categoryId=existing.id;
      else if(legacy&&kind!=='item'){
        const category={id:randomUUID(),name:legacy,active:true};
        config=this.save({...config,expectedVersion:config.version,groups:{...config.groups,[kind]:{...config.groups[kind],categories:[...categories,category]}}});categories=config.groups[kind].categories;categoryId=category.id;
      }else if(legacy)return fail('物品类别已不存在，请重新选择类别。');else categoryId=null;
    }
    if(categoryId===null)return null;
    const category=categories.find(c=>c.id===categoryId);if(!category||(!category.active&&old?.categoryId!==category.id))return fail('类别不存在或已停用，请重新选择。');
    return category.id;
  }
  removeCategory(worldId:string,kind:CatalogKind,id:string,replacementId:string|null){
    const old=this.get(worldId),group=old.groups[kind];
    if(!group.categories.some(c=>c.id===id))return fail('类别已不存在。','NOT_FOUND');
    if(replacementId!==null&&(replacementId===id||!group.categories.some(c=>c.id===replacementId&&c.active)))return fail('请选择其他启用中的类别，或清空类别。');
    for(const r of this.uses(kind,worldId).filter(r=>r.categoryId===id))this.store.catalogs.changeCategory(r,replacementId,group.categories.find(c=>c.id===replacementId)?.name??'');
    return this.write({...old,groups:{...old.groups,[kind]:{...group,categories:group.categories.filter(c=>c.id!==id)}}});
  }
}
