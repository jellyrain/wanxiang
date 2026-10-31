import {randomUUID} from 'node:crypto';
import type {Database,LibraryStore} from './store.ts';
import type {Character,HistoryKind,HistoryQuery,HistorySelection,HistoryPage,HistoryDetail,HistoryPreview,HistoryRestoreResult} from '../shared/types.ts';
import {historyEntities,historyDifferences} from '../shared/history.ts';
import {attributesForRead,emptyAttributes} from './attributes.ts';

type Table={name:string;key:string;kindColumn?:string;kindValue?:string;action?:boolean};
// Only this registry supplies SQL identifiers. Request values are always bound parameters.
const tables:Record<HistoryKind,Table>={
  place:{name:'catalog_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'place',action:true},
  technique:{name:'catalog_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'technique',action:true},
  item:{name:'catalog_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'item',action:true},
  character:{name:'revisions',key:'character_id',action:true},
  worldEntry:{name:'world_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'entry',action:true},
  worldCategory:{name:'world_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'category',action:true},
  relation:{name:'relation_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'relation',action:true},
  relationType:{name:'relation_history',key:'entity_id',kindColumn:'entity_kind',kindValue:'type',action:true},
  map:{name:'map_history',key:'entity_id',action:true},timeline:{name:'timeline_history',key:'entity_id',action:true},
  chapter:{name:'chapter_history',key:'entity_id',action:true},outline:{name:'outline_history',key:'entity_id',action:true},
  media:{name:'media_history',key:'entity_id',action:true},mediaCatalog:{name:'media_catalog_history',key:'entity_id'},
  dashboard:{name:'dashboard_history',key:'entity_id'},
  work:{name:'workspace_history',key:'entity_id',kindColumn:'kind',kindValue:'work',action:true},
  world:{name:'workspace_history',key:'entity_id',kindColumn:'kind',kindValue:'world',action:true}
};
type Row={version:number;action:string;created_at:string;snapshot_json:string};
type Ticket={selection:HistorySelection;generation:string;sequence:number;expires:number};
class Simulation {
  readonly preview:Omit<HistoryPreview,'token'|'expiresAt'>;
  constructor(preview:Omit<HistoryPreview,'token'|'expiresAt'>){this.preview=preview;}
}

export class HistoryStore {
  private tickets=new Map<string,Ticket>();
  private db:Database;private store:LibraryStore;private transaction:<T>(fn:()=>T)=>T;private fail:(code:string,message:string)=>never;
  constructor(db:Database,store:LibraryStore,transaction:<T>(fn:()=>T)=>T,fail:(code:string,message:string)=>never){this.db=db;this.store=store;this.transaction=transaction;this.fail=fail;}
  private target(input:HistoryQuery){
    if(!input||!Object.hasOwn(tables,input.kind)||typeof input.entityId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.entityId))return this.fail('VALIDATION','历史记录的类型或编号不正确。');
    const table=tables[input.kind],where=`${table.key}=?${table.kindColumn?` AND ${table.kindColumn}=?`:''}`,params=table.kindColumn?[input.entityId,table.kindValue]:[input.entityId];
    return {table,where,params};
  }
  private current(input:HistoryQuery,library=this.store.snapshot()){
    return historyEntities(library,input.kind).find(e=>e.id===input.entityId)??this.fail('NOT_FOUND','这份资料已不存在，请重新读取资料库。');
  }
  private revision(input:HistorySelection){
    const {table,where,params}=this.target(input);
    if(!Number.isSafeInteger(input.version)||input.version<1)return this.fail('VALIDATION','请选择有效的历史版本。');
    return this.db.prepare(`SELECT version,${table.action?'action':"'保存版本' AS action"},created_at,snapshot_json FROM ${table.name} WHERE ${where} AND version=?`).get(...params,input.version) as Row|undefined??this.fail('NOT_FOUND','没有找到这个历史版本。');
  }
  list(input:HistoryQuery):HistoryPage {
    const {table,where,params}=this.target(input),current=this.current(input);
    if(input.beforeVersion!==undefined&&(!Number.isSafeInteger(input.beforeVersion)||input.beforeVersion<1))return this.fail('VALIDATION','历史分页参数不正确。');
    const rows=this.db.prepare(`SELECT version,${table.action?'action':"'保存版本' AS action"},created_at FROM ${table.name} WHERE ${where}${input.beforeVersion===undefined?'':' AND version<?'} ORDER BY version DESC LIMIT 51`).all(...params,...(input.beforeVersion===undefined?[]:[input.beforeVersion])) as Row[];
    return {currentVersion:current.version,hasMore:rows.length>50,records:rows.slice(0,50).map(row=>({version:row.version,action:row.action,createdAt:row.created_at}))};
  }
  detail(input:HistorySelection):HistoryDetail {
    const row=this.revision(input),current=this.current(input);
    return {selection:input,record:{version:row.version,action:row.action,createdAt:row.created_at},currentVersion:current.version,differences:historyDifferences(current.value,JSON.parse(row.snapshot_json))};
  }
  preview(input:HistorySelection):HistoryPreview {
    this.store.assertWritable(this.store.journal.get('generation')!);
    this.target(input);
    const selection={kind:input.kind,entityId:input.entityId,version:input.version},row=this.revision(selection),before=this.store.snapshot(),current=this.current(selection,before);
    if(selection.version===current.version)return this.fail('VALIDATION','所选版本已经是当前版本。');
    const ticket:Ticket={selection,generation:before.generation,sequence:this.store.journal.sequence(),expires:Date.now()+10*60*1000};
    let result:Omit<HistoryPreview,'token'|'expiresAt'>;
    try {
      this.transaction(()=>{
        this.apply(selection,JSON.parse(row.snapshot_json));
        const after=this.store.snapshot(),restored=this.current(selection,after),differences=historyDifferences(current.value,restored.value);
        if(!differences.length)return this.fail('VALIDATION','该版本的可恢复内容与当前资料相同，无需回退。');
        const affected:HistoryPreview['affected']=[];
        for(const kind of Object.keys(tables) as HistoryKind[]){
          const previous=new Map(historyEntities(before,kind).map(e=>[e.id,e.version]));
          for(const e of historyEntities(after,kind))if(!(kind===selection.kind&&e.id===selection.entityId)&&previous.get(e.id)!==e.version)affected.push({kind,entityId:e.id,name:e.name});
        }
        const notes=['确认后生成新的当前版本，原有历史记录全部保留。','关联的图片、标签、分类和属性模板沿用当前资料库，回退不会修改它们。'];
        if(selection.kind==='character')notes.push('人物包含基础档案、身份、形态与阶段。后来新增的身份和形态保留为停用，新增阶段保留为归档。');
        throw new Simulation({selection,currentVersion:current.version,differences,affected,notes});
      });
      return this.fail('INTERNAL','回退预览未完成。');
    }catch(error){if(!(error instanceof Simulation))throw error;result=error.preview;}
    for(const [key,value] of this.tickets)if(value.expires<Date.now())this.tickets.delete(key);
    while(this.tickets.size>=100)this.tickets.delete(this.tickets.keys().next().value!);
    const token=randomUUID();this.tickets.set(token,ticket);
    return {...result,token,expiresAt:new Date(ticket.expires).toISOString()};
  }
  restore(input:{token:string}):HistoryRestoreResult {
    if(!input||typeof input.token!=='string')return this.fail('VALIDATION','请先预览要回退的版本。');
    const ticket=this.tickets.get(input.token);this.tickets.delete(input.token);
    if(!ticket||ticket.expires<Date.now())return this.fail('CONFLICT','回退预览已失效，请重新预览。');
    this.store.assertWritable(ticket.generation);
    return this.transaction(()=>{
      if(this.store.journal.sequence()!==ticket.sequence)return this.fail('CONFLICT','预览之后资料库又有修改，请重新预览并核对差异。');
      const row=this.revision(ticket.selection);this.apply(ticket.selection,JSON.parse(row.snapshot_json));
      return {kind:ticket.selection.kind,entityId:ticket.selection.entityId,version:this.current(ticket.selection).version};
    });
  }
  private archive(kind:HistoryKind,id:string,version:number,archived:boolean){
    switch(kind){
      case 'place':return this.store.catalogs.archive('place',id,version,archived);
      case 'technique':return this.store.catalogs.archive('technique',id,version,archived);
      case 'item':return this.store.catalogs.archive('item',id,version,archived);
      case 'character':return this.store.archiveCharacter(id,version,archived);
      case 'worldEntry':return this.store.world.archiveEntry(id,version,archived);
      case 'relation':return this.store.graph.archiveRelation(id,version,archived);
      case 'map':return this.store.maps.archive(id,version,archived);
      case 'timeline':return this.store.timeline.archive(id,version,archived);
      case 'chapter':return this.store.chapters.archive(id,version,archived);
      case 'media':return this.store.gallery.archive(id,version,archived);
      case 'work':return this.store.workspace.archiveWork(id,version,archived);
    }
  }
  private apply(selection:HistorySelection,saved:Record<string,unknown>){
    const {kind,entityId}=selection,original=this.current(selection),old=original.value as {archived?:boolean};
    if(old.archived)this.archive(kind,entityId,original.version,false);
    const current=this.current(selection),library=this.store.snapshot(),input={...saved,expectedVersion:current.version};
    switch(kind){
      case 'item':case 'technique':case 'place':this.store.catalogs.save(kind,{...input,designImageId:saved.designImageId??null,tagIds:saved.tagIds??[],facts:saved.facts??[],attributes:attributesForRead((saved.attributes??emptyAttributes()) as ReturnType<typeof emptyAttributes>,this.store.attributeTemplates(String(saved.worldId)))});break;
      case 'character':this.store.restoreCharacterSnapshot(saved as unknown as Character);break;
      case 'worldEntry':this.store.world.saveEntry({...input,expectedCategoryVersion:library.worldCategories.find(c=>c.id===saved.categoryId)?.version});break;
      case 'worldCategory':this.store.world.saveCategory(input);break;
      case 'relation':this.store.graph.saveRelation({...input,expectedTypeVersion:library.relationTypes.find(t=>t.id===saved.typeId)?.version});break;
      case 'relationType':this.store.graph.saveType(input);break;
      case 'map':this.store.maps.save(input);break;
      case 'timeline':this.store.timeline.save(input);break;
      case 'chapter':this.store.chapters.save({...input,expectedOutlineVersion:this.store.chapters.getOutline(String(saved.workId)).version});break;
      case 'outline':this.store.chapters.saveOutline(input);break;
      case 'media':this.store.gallery.save(input);break;
      case 'mediaCatalog':this.store.gallery.saveCatalog(input);break;
      case 'dashboard':this.store.dashboard.save(input);break;
      case 'work':this.store.workspace.saveWork(input);break;
      case 'world':this.store.workspace.saveWorld(input);break;
    }
    if(saved.archived===true)this.archive(kind,entityId,this.current(selection).version,true);
    const {table,where,params}=this.target(selection);
    if(table.action)this.db.prepare(`UPDATE ${table.name} SET action=? WHERE ${where} AND version>?`).run(`回退至版本 ${selection.version}`,...params,original.version);
  }
}
