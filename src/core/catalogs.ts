import {randomUUID} from 'node:crypto';
import {ContentError,type Database,type LibraryStore} from './store.ts';
import type {CatalogKind,CatalogRecord,CatalogInput,ItemRecord,TechniqueRecord,PlaceRecord,ItemHolding,TechniquePractice,PlacePosition} from '../shared/types.ts';
import {itemTypes,holdingStates,practiceStates,catalogNames} from '../shared/catalogs.ts';
import {attributesForRead,emptyAttributes,validateAttributes} from './attributes.ts';

type Records={item:ItemRecord;technique:TechniqueRecord;place:PlaceRecord};
export const catalogTables={item:'catalog_items',technique:'catalog_techniques',place:'catalog_places'} as const;
const fail=(message:string,code='VALIDATION'):never=>{throw new ContentError(code,message);};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const text=(v:unknown,label:string,max=10000)=>{if(typeof v!=='string'||v.length>max)return fail(`${label}格式不正确或内容过长。`);return v;};
const array=<T>(v:T[],label:string,max=200):T[]=>{if(!Array.isArray(v)||v.length>max)return fail(`${label}最多 ${max} 项。`);return v;};
const version=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)fail('资料版本不正确。');};

/** Dedicated domain records. Never writes catalog content into world_entries. */
export class CatalogStore {
  private db:Database;private store:LibraryStore;
  constructor(db:Database,store:LibraryStore){
    this.db=db;this.store=store;
    for(const table of Object.values(catalogTables))db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),record_json TEXT NOT NULL);`);
    db.exec(`CREATE TABLE IF NOT EXISTS catalog_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,entity_kind TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_kind,entity_id,version));`);
  }
  private normalize<K extends CatalogKind>(record:Records[K]):Records[K]{return {...record,designImageId:record.designImageId??null,tagIds:record.tagIds??[],facts:record.facts??[],attributes:attributesForRead(record.attributes??emptyAttributes(),this.store.attributeTemplates(record.worldId))};}
  private list<K extends CatalogKind>(kind:K):Records[K][] {return this.db.prepare(`SELECT record_json FROM ${catalogTables[kind]} ORDER BY rowid`).all().map(r=>this.normalize<K>(JSON.parse((r as {record_json:string}).record_json)));}
  snapshot(){return {items:this.list('item'),techniques:this.list('technique'),places:this.list('place')};}
  get<K extends CatalogKind>(kind:K,target:unknown):Records[K]{
    if(!id(target))return fail('资料编号不正确。');
    const row=this.db.prepare(`SELECT record_json FROM ${catalogTables[kind]} WHERE id=?`).get(target) as {record_json:string}|undefined;
    return row?this.normalize<K>(JSON.parse(row.record_json)):fail(`${catalogNames[kind]}不存在。`,'NOT_FOUND');
  }
  touchReferences(type:'tag'|'template',id:string,remove=false){
    const all=this.snapshot();
    for(const r of [...all.items,...all.techniques,...all.places]){
      const used=type==='tag'?r.tagIds.includes(id):r.attributes.templateId===id||Object.hasOwn(r.attributes.values,id);
      if(!used)continue;
      this.write(r.kind,{...r,tagIds:remove?r.tagIds.filter(v=>v!==id):r.tagIds,version:r.version+1,updatedAt:new Date().toISOString()},type==='tag'?(remove?'移除标签':'更新标签'):'更新属性模板');
    }
  }
  private write<K extends CatalogKind>(kind:K,record:Records[K],action:string):Records[K]{
    const json=JSON.stringify(record);
    this.db.prepare(`INSERT INTO ${catalogTables[kind]}(id,world_id,record_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json`).run(record.id,record.worldId,json);
    this.db.prepare('INSERT INTO catalog_history(entity_id,entity_kind,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').run(record.id,kind,record.version,action,json,record.updatedAt);
    return record;
  }
  save<K extends CatalogKind>(kind:K,raw:unknown):Records[K]{
    if(!raw||typeof raw!=='object')return fail('资料格式不正确。');
    const input=raw as CatalogInput;
    if(input.kind!==kind||!id(input.worldId)||(input.id!==undefined&&!id(input.id)))return fail('资料类型或编号不正确。');
    version(input.expectedVersion);
    return this.store.importTransaction(()=>{
      this.store.workspace.getWorld(input.worldId);
      const old=input.id?this.get(kind,input.id):undefined;
      if(old&&old.worldId!==input.worldId)fail('不能迁移所属世界。');
      if((old?.version??0)!==input.expectedVersion)fail('资料已有新修改，请重新读取后合并。你的输入仍保留。','CONFLICT');
      if(old?.archived)fail('请先恢复资料，再编辑。');
      const name=text(input.name,'名称',200).trim();if(!name)fail('名称不能为空。');
      if(!['draft','pending','adopted'].includes(input.status))fail('请选择有效的设定状态。');
      const snap=this.store.snapshot();
      const reference=(targetId:unknown,targets:{id:string;worldId:string;archived?:boolean}[],retained:boolean)=>{
        const target=id(targetId)?targets.find(t=>t.id===targetId&&t.worldId===input.worldId):undefined;
        if(!target)fail('关联资料不存在或不属于当前世界。');
        if(target!.archived&&!retained)fail('请先恢复关联资料，再添加关联。');
      };
      const unique=(values:string[],label:string)=>{if(new Set(values).size!==values.length)fail(`${label}不能重复。`);};
      const entryIds=array(input.entryIds,'关联世界规则',100).map(v=>{reference(v,snap.worldEntries,old?.entryIds.includes(v)??false);return v;});unique(entryIds,'关联世界规则');
      if(input.imageId!==null)reference(input.imageId,snap.media,old?.imageId===input.imageId);
      const designImageId=input.designImageId===undefined?old?.designImageId??null:input.designImageId;
      if(designImageId!==null)reference(designImageId,snap.media,old?.designImageId===designImageId);
      const tagIds=array(input.tagIds??old?.tagIds??[],'标签',40).map(v=>{reference(v,snap.tags,true);return v;});unique(tagIds,'标签');
      const templates=this.store.attributeTemplates(input.worldId),defaultId=snap.attributeDefaults.find(v=>v.worldId===input.worldId)?.templateId??null;
      const attributes=validateAttributes(input.attributes??old?.attributes??attributesForRead({...emptyAttributes(),templateId:defaultId},templates),old?.attributes??emptyAttributes(),templates,fail);
      const facts=array(input.facts??old?.facts??[],'自定义字段',60).map(f=>{if(!f||!id(f.id))return fail('字段编号无效。');const label=text(f.label,'字段名称',100).trim();if(!label)fail('字段名称不能为空。');return {id:f.id,label,value:text(f.value,'字段内容')};});unique(facts.map(f=>f.id),'字段编号');
      const base={designImageId,tagIds,attributes,facts,id:old?.id??randomUUID(),worldId:input.worldId,name,aliases:text(input.aliases,'别名',1000),summary:text(input.summary,'摘要',3000),body:text(input.body,'详细说明',100000),pending:text(input.pending,'待定内容',30000),source:text(input.source,'来源',3000),status:input.status,imageId:input.imageId,entryIds,archived:false,version:(old?.version??0)+1,updatedAt:new Date().toISOString()};
      let record:CatalogRecord;
      if(input.kind==='item'){
        if(!Object.hasOwn(itemTypes,input.itemType))fail('物品类型不正确。');
        const holders:ItemHolding[]=array(input.holders,'持有记录').map(h=>{
          if(!h||!id(h.id)||!Object.hasOwn(holdingStates,h.state)||!Number.isSafeInteger(h.quantity)||h.quantity<0||h.quantity>1000000000) return fail('持有记录需要有效编号、状态和非负整数数量。');
          reference(h.characterId,snap.characters,old?.kind==='item'&&old.holders.some(v=>v.characterId===h.characterId));
          return {id:h.id,characterId:h.characterId,quantity:h.quantity,state:h.state,notes:text(h.notes,'持有备注')};
        });unique(holders.map(h=>h.id),'持有记录编号');unique(holders.map(h=>h.characterId),'持有人');
        record={...base,kind:'item',itemType:input.itemType,rarity:text(input.rarity,'品阶',200),effect:text(input.effect,'效果'),usage:text(input.usage,'使用条件'),cost:text(input.cost,'消耗与限制'),holders};
      }else if(input.kind==='technique'){
        const practitioners:TechniquePractice[]=array(input.practitioners,'修习记录').map(p=>{
          if(!p||!id(p.id)||!Object.hasOwn(practiceStates,p.state))return fail('修习记录编号或状态不正确。');
          reference(p.characterId,snap.characters,old?.kind==='technique'&&old.practitioners.some(v=>v.characterId===p.characterId));
          return {id:p.id,characterId:p.characterId,progress:text(p.progress,'修习进度',1000),state:p.state,notes:text(p.notes,'修习备注')};
        });unique(practitioners.map(p=>p.id),'修习记录编号');unique(practitioners.map(p=>p.characterId),'修习人物');
        record={...base,kind:'technique',school:text(input.school,'流派',200),requirements:text(input.requirements,'修习条件'),effect:text(input.effect,'能力效果'),cost:text(input.cost,'代价与限制'),levels:text(input.levels,'层级与阶段'),practitioners};
      }else{
        const characterIds=array(input.characterIds,'关联人物').map(v=>{reference(v,snap.characters,old?.kind==='place'&&old.characterIds.includes(v));return v;});unique(characterIds,'关联人物');
        const positions:PlacePosition[]=array(input.positions,'地图位置',100).map(p=>{
          if(!p||!id(p.mapId)||!id(p.locationId))return fail('地图位置编号无效。');
          const retained=old?.kind==='place'&&old.positions.some(v=>v.mapId===p.mapId&&v.locationId===p.locationId);
          reference(p.mapId,snap.maps,Boolean(retained));
          const location=snap.maps.find(m=>m.id===p.mapId)!.locations.find(l=>l.id===p.locationId);
          if(!location||location.archived&&!retained)fail('地图地点不存在或已归档。');
          return {mapId:p.mapId,locationId:p.locationId};
        });unique(positions.map(p=>`${p.mapId}:${p.locationId}`),'地图位置');
        record={...base,kind:'place',placeType:text(input.placeType,'场地类型',200),region:text(input.region,'所属区域',1000),environment:text(input.environment,'环境与布局'),access:text(input.access,'进入条件'),characterIds,positions};
      }
      return this.write(kind,{...record,designImageId,tagIds,attributes,facts} as Records[K],old?'编辑资料':'新建资料');
    });
  }
  archive<K extends CatalogKind>(kind:K,target:unknown,expectedVersion:unknown,archived:unknown):Records[K]{
    version(expectedVersion);if(typeof archived!=='boolean')return fail('归档状态不正确。');
    return this.store.importTransaction(()=>{const old=this.get(kind,target);if(old.version!==expectedVersion)fail('资料已有修改，请刷新后重试。','CONFLICT');if(old.archived===archived)return old;return this.write(kind,{...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档资料':'恢复资料');});
  }
}
