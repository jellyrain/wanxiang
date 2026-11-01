import {randomUUID} from 'node:crypto';
import {ContentError,type LibraryStore,type Database} from './store.ts';
import {deletionItems,deletionBlockers,deletionKey,type DeletionTarget,type DeletionItem,type DeletionPreview} from '../shared/deletion.ts';

type Ticket={target:DeletionTarget;sequence:number;generation:string;expires:number};
export class DeletionStore {
  private tickets=new Map<string,Ticket>();
  private store:LibraryStore;
  private db:Database;
  constructor(store:LibraryStore,db:Database){this.store=store;this.db=db;}
  private fail(code:string,message:string):never{throw new ContentError(code,message);}
  private plan(input:DeletionTarget){
    if(!input||typeof input!=='object')return this.fail('VALIDATION','请选择要删除的资料。');
    const s=this.store.snapshot(),all=deletionItems(s),target=all.find(v=>deletionKey(v)===deletionKey(input));
    if(!target)return this.fail('NOT_FOUND','资料不存在，请刷新后重试。');
    if(target.kind==='catalogCategory'){
      const kind=target.catalogKind!,group=this.store.config.get(target.worldId).groups[kind],replacementId=input.replacementId??null;
      if(replacementId!==null&&(replacementId===target.id||!group.categories.some(c=>c.id===replacementId&&c.active)))return this.fail('VALIDATION','请选择其他启用中的类别，或清空类别。');
      const affected=this.store.config.uses(kind,target.worldId).filter(r=>r.categoryId===target.id);
      return {target:{...target,replacementId},included:[target],blockers:[],notes:[affected.length+' 份资料将'+(replacementId?'转移到“'+group.categories.find(c=>c.id===replacementId)!.name+'”':'清空类别')+'，资料和修改历史均保留。',...affected.map(r=>r.name+(r.archived?'（已归档）':''))]};
    }
    const included=all.filter(v=>deletionKey(v)===deletionKey(target)||
      (target.kind==='world'&&v.worldId===target.id)||
      (target.kind==='work'&&v.workId===target.id)||
      (target.kind==='character'&&['identity','form','stage'].includes(v.kind)&&v.parentId===target.id)||
      (target.kind==='map'&&['location','mapStage'].includes(v.kind)&&v.parentId===target.id)||
      (target.kind==='timeline'&&['event','era'].includes(v.kind)&&v.parentId===target.id));
    return {target,included,blockers:deletionBlockers(s,target,included),notes:[
      '永久移除所列资料及其独立修改历史，不能通过归档恢复。已有备份不受影响。',
      ...(target.kind==='work'?['同时删除本作品的大纲、分卷、全部章节与创作计划；所属世界、人物和素材保留。']:[]),
      ...(target.kind==='world'?['同时删除这个世界中的所有作品、人物、设定、地图、年表和素材资料。']:[]),
      ...(['identity','form','stage','location','mapStage','event','era','volume','mediaCategory','mediaTag'].includes(target.kind)?['所属资料将生成新版本；原有历史和冻结的人物阶段仍保留当时内容。']:[]),
      ...(target.kind==='attributeTemplate'&&(s.libraryConfigs??[]).some(c=>Object.values(c.groups).some(g=>g.templateId===target.id))?['将取消各类新资料对此模板的默认选择；使用它的资料仍须先解除引用。']:[]),
      ...(target.kind==='media'?['素材从资料库移除；底层图片文件保留供旧历史和已有备份使用。']:[])
    ]};
  }
  preview(input:DeletionTarget):DeletionPreview{
    return this.store.importTransaction(()=>{
      const plan=this.plan(input),now=Date.now();
      for(const [key,t] of this.tickets)if(t.expires<=now)this.tickets.delete(key);
      if(this.tickets.size>=100)this.tickets.delete(this.tickets.keys().next().value!);
      const token=randomUUID(),expires=now+600000;
      this.tickets.set(token,{target:plan.target,sequence:this.store.journal.sequence(),generation:this.store.journal.get('generation')!,expires});
      return {...plan,token,expiresAt:new Date(expires).toISOString()};
    });
  }
  confirm(input:{token:string;name:string}):{deleted:DeletionTarget[];activeWorkId:string|null}{
    if(!input||typeof input.token!=='string'||typeof input.name!=='string')return this.fail('VALIDATION','请先预览删除范围，并确认资料名称。');
    const ticket=this.tickets.get(input.token);this.tickets.delete(input.token);
    if(!ticket||ticket.expires<=Date.now())return this.fail('CONFLICT','删除预览已失效，请重新预览。');
    return this.store.importTransaction(()=>{
      if(ticket.generation!==this.store.journal.get('generation'))this.fail('RESTORED','资料库已经恢复，请重新预览删除范围。');
      if(ticket.sequence!==this.store.journal.sequence())this.fail('CONFLICT','资料已有新修改，请重新预览删除范围。');
      const plan=this.plan(ticket.target);
      if(input.name!==plan.target.name)this.fail('VALIDATION','确认名称与资料名称不一致。');
      if(plan.blockers.length)this.fail('VALIDATION','仍有资料引用此项：'+plan.blockers.join('；'));
      this.remove(plan.target);
      const activeWorkId=this.store.workspace.activeWorkId();
      if(activeWorkId)this.store.workspace.selectWork(activeWorkId);else this.db.prepare("DELETE FROM meta WHERE key='active-work'").run();
      return {deleted:plan.included.map(({kind,id,parentId,catalogKind})=>({kind,id,parentId,catalogKind})),activeWorkId};
    });
  }
  private del(table:string,key:string,id:string,extra=''){this.db.prepare(`DELETE FROM ${table} WHERE ${key}=?${extra}`).run(id);}
  private history(table:string,id:string,extra=''){this.del(table,'entity_id',id,extra);}
  private remove(t:DeletionItem){
    const s=this.store,db=this.db,id=t.id;
    if(t.kind==='catalogCategory'){s.config.removeCategory(t.worldId,t.catalogKind!,id,t.replacementId??null);return;}
    if(t.parentId){this.removeNested(t);return;}
    if(t.kind==='world'){
      const order=['item','technique','place','work','relation','worldEntry','map','timeline','character','tag','attributeTemplate','relationType','worldCategory','media'];
      const items=deletionItems(s.snapshot()).filter(v=>v.worldId===id&&!v.parentId&&v.kind!=='world');
      this.del('attribute_defaults','world_id',id);this.del('library_configs','world_id',id);this.history('library_config_history',id);
      for(const kind of order)for(const v of items.filter(v=>v.kind===kind))this.remove(v);
      for(const table of ['graph_layouts','media_catalogs','world_settings'])this.del(table,'world_id',id);
      this.history('media_catalog_history',id);this.history('workspace_history',id," AND kind='world'");this.del('worlds','id',id);return;
    }
    if(t.kind==='work'){
      db.prepare('DELETE FROM chapter_history WHERE entity_id IN (SELECT id FROM chapters WHERE work_id=?)').run(id);
      this.del('chapters','work_id',id);
      for(const table of ['work_dashboards','work_outlines','work_settings'])this.del(table,'work_id',id);
      for(const table of ['dashboard_history','outline_history'])this.history(table,id);
      this.history('workspace_history',id," AND kind='work'");this.del('works','id',id);return;
    }
    if(t.kind==='character'){
      for(const table of ['character_images','character_tags','character_stages','revisions'])this.del(table,'character_id',id);
      this.del('characters','id',id);
      const layout=s.snapshot().graphLayouts.find(l=>l.worldId===t.worldId);
      if(layout&&Object.hasOwn(layout.positions,id)){delete layout.positions[id];db.prepare('UPDATE graph_layouts SET positions_json=?,version=version+1 WHERE world_id=?').run(JSON.stringify(layout.positions),layout.worldId);}return;
    }
    if(t.kind==='chapter'){
      const chapter=s.chapters.get(id),outline=s.chapters.getOutline(chapter.workId);
      this.history('chapter_history',id);this.del('chapters','id',id);
      s.chapters.saveOutline({...outline,expectedVersion:outline.version,chapterIds:outline.chapterIds.filter(v=>v!==id)});return;
    }
    if(t.kind==='media'){
      for(const table of ['media_metadata','media_info'])this.del(table,'asset_id',id);
      this.history('media_history',id);this.del('assets','id',id);return;
    }
    if(t.kind==='tag'){this.del('character_tags','tag_id',id);this.del('tags','id',id);return;}
    if(t.kind==='attributeTemplate'){
      for(const config of s.config.snapshot())if(Object.values(config.groups).some(g=>g.templateId===id))s.config.save({...config,expectedVersion:config.version,groups:Object.fromEntries(Object.entries(config.groups).map(([kind,g])=>[kind,{...g,templateId:g.templateId===id?null:g.templateId}])) as typeof config.groups});
      db.prepare('UPDATE attribute_defaults SET template_id=NULL,version=version+1 WHERE template_id=?').run(id);this.del('attribute_templates','id',id);return;
    }
    const registry:Record<string,[string,string,string]>={item:['catalog_items','catalog_history'," AND entity_kind='item'"],technique:['catalog_techniques','catalog_history'," AND entity_kind='technique'"],place:['catalog_places','catalog_history'," AND entity_kind='place'"],relation:['character_relations','relation_history'," AND entity_kind='relation'"],relationType:['relation_types','relation_history'," AND entity_kind='type'"],worldEntry:['world_entries','world_history'," AND entity_kind='entry'"],worldCategory:['world_categories','world_history'," AND entity_kind='category'"],map:['world_maps','map_history',''],timeline:['world_timelines','timeline_history','']};
    const [table,history,extra]=registry[t.kind];this.history(history,id,extra);this.del(table,'id',id);
  }
  private writeJson(table:string,key:string,id:string,column:string,value:Record<string,unknown>,history:string,action=true){
    const now=new Date().toISOString(),next={...value,version:Number(value.version)+1,updatedAt:now},json=JSON.stringify(next);
    this.db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).run(json,id);
    this.db.prepare(`INSERT INTO ${history}(entity_id,version,${action?'action,':''}snapshot_json,created_at) VALUES(?,?,${action?'?,':''}?,?)`).run(id,next.version,...(action?['删除子项']:[]),json,now);
  }
  private removeNested(t:DeletionItem){
    const s=this.store,db=this.db,p=t.parentId!,snap=s.snapshot();
    if(['identity','form','stage'].includes(t.kind)){
      const c=s.getCharacter(p),now=new Date().toISOString();
      if(t.kind==='stage')this.del('character_stages','id',t.id);
      else {const variants={identities:c.identities.filter(v=>t.kind!=='identity'||v.id!==t.id),forms:c.forms.filter(v=>t.kind!=='form'||v.id!==t.id),defaultFormId:t.kind==='form'&&c.defaultFormId===t.id?'base':c.defaultFormId};db.prepare('UPDATE characters SET variants_json=? WHERE id=?').run(JSON.stringify(variants),p);}
      db.prepare('UPDATE characters SET version=version+1,updated_at=? WHERE id=?').run(now,p);
      const next=s.getCharacter(p);db.prepare('INSERT INTO revisions(character_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(p,next.version,'删除子项',JSON.stringify({...next,attributeSchemas:snap.attributeTemplates.filter(v=>v.worldId===c.worldId)}),now);return;
    }
    const registry:Record<string,[string,string,string,string,string,string,boolean]>={
      location:['maps','locations','world_maps','id','map_json','map_history',true],mapStage:['maps','stages','world_maps','id','map_json','map_history',true],
      event:['timelines','events','world_timelines','id','timeline_json','timeline_history',true],era:['timelines','eras','world_timelines','id','timeline_json','timeline_history',true],
      volume:['outlines','volumes','work_outlines','work_id','outline_json','outline_history',true],
      mediaCategory:['mediaCatalogs','categories','media_catalogs','world_id','catalog_json','media_catalog_history',false],mediaTag:['mediaCatalogs','tags','media_catalogs','world_id','catalog_json','media_catalog_history',false]
    };
    const [collection,field,table,key,column,history,action]=registry[t.kind];
    const values=(snap as unknown as Record<string,Record<string,unknown>[]>)[collection];
    const value=values.find(v=>(v.id??v.workId??v.worldId)===p)!;
    this.writeJson(table,key,p,column,{...value,[field]:(value[field] as {id:string}[]).filter(v=>v.id!==t.id)},history,action);
  }
}
