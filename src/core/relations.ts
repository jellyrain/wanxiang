import { randomUUID } from 'node:crypto';
import type { Database } from './store.ts';
import type { Character, CharacterRelation, RelationInput, RelationType, RelationTypeInput, GraphLayout, GraphLayoutInput } from '../shared/types.ts';

type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const relationKey=(r:CharacterRelation)=>{const a=JSON.stringify([r.sourceId,r.sourceStageId]),b=JSON.stringify([r.targetId,r.targetStageId]);return JSON.stringify([r.typeId,r.label,r.direction,...(r.direction==='mutual'?[a,b].sort():[a,b])]);};

export class RelationStore {
  private db:Database;
  private transaction:<T>(operation:()=>T)=>T;
  private character:(id:string)=>Character;
  private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,character:(id:string)=>Character,fail:Reject) {
    this.db=db;this.transaction=transaction;this.character=character;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS relation_types(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),name TEXT NOT NULL,color TEXT NOT NULL,active INTEGER NOT NULL,version INTEGER NOT NULL,UNIQUE(world_id,name));
      CREATE TABLE IF NOT EXISTS character_relations(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),source_id TEXT NOT NULL REFERENCES characters(id),target_id TEXT NOT NULL REFERENCES characters(id),type_id TEXT NOT NULL REFERENCES relation_types(id),relation_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS relations_world ON character_relations(world_id);
      CREATE TABLE IF NOT EXISTS relation_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,entity_kind TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_kind,entity_id,version));
      CREATE TABLE IF NOT EXISTS graph_layouts(world_id TEXT PRIMARY KEY REFERENCES worlds(id),version INTEGER NOT NULL,positions_json TEXT NOT NULL);`);
  }
  private world(id:unknown):asserts id is string {if(!validId(id)||!this.db.prepare('SELECT id FROM worlds WHERE id=?').get(id))this.fail('VALIDATION','所属世界不存在。');}
  private text(v:unknown,label:string,max:number):string {if(typeof v!=='string'||v.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);return v;}
  private version(v:unknown) {if(!Number.isSafeInteger(v)||Number(v)<0)this.fail('VALIDATION','资料版本不正确。');}
  snapshot():{relationTypes:RelationType[];relations:CharacterRelation[];graphLayouts:GraphLayout[]} {
    const relationTypes=this.db.prepare('SELECT id,world_id AS worldId,name,color,active,version FROM relation_types ORDER BY rowid').all().map(r=>({...r as RelationType,active:Boolean((r as Row).active)}));
    const relations=this.db.prepare('SELECT relation_json FROM character_relations ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).relation_json)) as CharacterRelation);
    const graphLayouts=this.db.prepare('SELECT * FROM graph_layouts').all().map(r=>{const row=r as Row;return {worldId:String(row.world_id),version:Number(row.version),positions:JSON.parse(String(row.positions_json))};});
    return {relationTypes,relations,graphLayouts};
  }
  private type(id:string):RelationType {const type=this.snapshot().relationTypes.find(t=>t.id===id);return type??this.fail('NOT_FOUND','关系类型不存在。');}
  private relation(id:unknown):CharacterRelation {if(!validId(id))return this.fail('VALIDATION','关系编号不正确。');const row=this.db.prepare('SELECT relation_json FROM character_relations WHERE id=?').get(id) as Row|undefined;return row?JSON.parse(String(row.relation_json)):this.fail('NOT_FOUND','关系不存在。');}
  private history(kind:string,id:string,version:number,action:string,snapshot:unknown) {this.db.prepare('INSERT INTO relation_history(entity_id,entity_kind,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').run(id,kind,version,action,JSON.stringify(snapshot),new Date().toISOString());}
  private record(relation:CharacterRelation,action:string) {
    const source=this.character(relation.sourceId),target=this.character(relation.targetId);
    this.history('relation',relation.id,relation.version,action,{...relation,type:this.type(relation.typeId),sourceName:source.name,targetName:target.name,sourceStage:source.stages.find(s=>s.id===relation.sourceStageId)?.name??null,targetStage:target.stages.find(s=>s.id===relation.targetStageId)?.name??null});
  }
  private write(relation:CharacterRelation,action:string) {
    this.db.prepare('INSERT INTO character_relations(id,world_id,source_id,target_id,type_id,relation_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,target_id=excluded.target_id,type_id=excluded.type_id,relation_json=excluded.relation_json').run(relation.id,relation.worldId,relation.sourceId,relation.targetId,relation.typeId,JSON.stringify(relation));
    this.record(relation,action);return relation;
  }
  saveType(raw:unknown):RelationType {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','关系类型格式不正确。');
    const input=raw as RelationTypeInput;this.world(input.worldId);this.version(input.expectedVersion);
    const name=this.text(input.name,'关系类型名称',60).trim();
    if(!name||typeof input.color!=='string'||!/^#[\da-f]{6}$/i.test(input.color)||typeof input.active!=='boolean'||(input.id!==undefined&&!validId(input.id)))return this.fail('VALIDATION','请填写类型名称、颜色和有效的状态。');
    return this.transaction(()=>{
      const previous=input.id?this.type(input.id):undefined;
      if(previous&&previous.worldId!==input.worldId)this.fail('VALIDATION','不能迁移关系类型所属世界。');
      if((previous?.version??0)!==input.expectedVersion)this.fail('CONFLICT','关系类型已有修改，请重新打开配置。');
      if(this.snapshot().relationTypes.some(t=>t.worldId===input.worldId&&t.id!==input.id&&t.name===name))this.fail('VALIDATION','这个关系类型名称已经存在。');
      const type={id:previous?.id??randomUUID(),worldId:input.worldId,name,color:input.color.toLowerCase(),active:input.active,version:(previous?.version??0)+1};
      this.db.prepare('INSERT INTO relation_types(id,world_id,name,color,active,version) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,active=excluded.active,version=excluded.version').run(type.id,type.worldId,type.name,type.color,Number(type.active),type.version);
      this.history('type',type.id,type.version,previous?'修改关系类型':'新建关系类型',type);
      if(previous)for(const r of this.snapshot().relations.filter(r=>r.typeId===type.id))this.write({...r,version:r.version+1,updatedAt:new Date().toISOString()},'更新关系类型');
      return type;
    });
  }
  saveRelation(raw:unknown):CharacterRelation {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','关系资料格式不正确。');
    const input=raw as RelationInput;this.world(input.worldId);this.version(input.expectedVersion);this.version(input.expectedTypeVersion);
    if((input.id!==undefined&&!validId(input.id))||!validId(input.sourceId)||!validId(input.targetId)||input.sourceId===input.targetId||!validId(input.typeId))return this.fail('VALIDATION','请选择两个不同人物和关系类型。');
    const label=this.text(input.label,'关系名称',100).trim(),description=this.text(input.description,'关系说明',30000);
    if(!['forward','mutual'].includes(input.direction)||!['confirmed','pending'].includes(input.status))return this.fail('VALIDATION','关系方向或确认状态不正确。');
    return this.transaction(()=>{
      const previous=input.id?this.relation(input.id):undefined;
      if(previous&&previous.worldId!==input.worldId)this.fail('VALIDATION','不能迁移关系所属世界。');
      if((previous?.version??0)!==input.expectedVersion)this.fail('CONFLICT','这条关系已有修改，请重新打开后编辑。你的输入仍保留。');
      if(previous?.archived)this.fail('VALIDATION','请先恢复关系，再编辑。');
      const type=this.type(input.typeId);
      if(type.worldId!==input.worldId)this.fail('VALIDATION','请选择当前世界的关系类型。');
      if(type.version!==input.expectedTypeVersion)this.fail('CONFLICT','关系类型已有修改，请重新打开编辑。');
      if(!type.active&&previous?.typeId!==type.id)this.fail('VALIDATION','这个关系类型已停用，请恢复后使用。');
      for(const [id,stageId,oldId,oldStageId] of [[input.sourceId,input.sourceStageId,previous?.sourceId,previous?.sourceStageId],[input.targetId,input.targetStageId,previous?.targetId,previous?.targetStageId]]) {
        const c=this.character(id!);
        if(c.worldId!==input.worldId)this.fail('VALIDATION','关系两端必须属于当前世界。');
        if(c.archived&&id!==oldId)this.fail('VALIDATION','请先恢复人物，再建立关系。');
        if(stageId!==null) {
          if(!validId(stageId))this.fail('VALIDATION','阶段编号不正确。');
          const stage=c.stages.find(s=>s.id===stageId);
          if(!stage)this.fail('VALIDATION','所选阶段不属于对应人物。');
          if(stage!.archived&&(stageId!==oldStageId||id!==oldId))this.fail('VALIDATION','请先恢复阶段，再建立关联。');
        }
      }
      const relation:CharacterRelation={id:previous?.id??randomUUID(),worldId:input.worldId,sourceId:input.sourceId,targetId:input.targetId,sourceStageId:input.sourceStageId,targetStageId:input.targetStageId,typeId:type.id,label,description,direction:input.direction,status:input.status,archived:false,version:(previous?.version??0)+1,updatedAt:new Date().toISOString()};
      if(this.snapshot().relations.some(r=>r.id!==relation.id&&!r.archived&&r.worldId===relation.worldId&&relationKey(r)===relationKey(relation)))this.fail('VALIDATION','这两个阶段之间已存在同名同类关系，请编辑已有记录。');
      return this.write(relation,previous?'编辑人物关系':'新建人物关系');
    });
  }
  archiveRelation(id:string,version:number,archived:boolean):CharacterRelation {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','关系归档状态不正确。');
    return this.transaction(()=>{const old=this.relation(id);if(old.version!==version)this.fail('CONFLICT','关系已有修改，请刷新后重试。');if(old.archived===archived)return old;if(!archived&&this.snapshot().relations.some(r=>r.id!==old.id&&!r.archived&&relationKey(r)===relationKey(old)))this.fail('VALIDATION','已有同名同类关系，请先处理重复记录再恢复。');return this.write({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档人物关系':'恢复人物关系');});
  }
  saveLayout(raw:unknown):GraphLayout {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','图谱布局格式不正确。');
    const input=raw as GraphLayoutInput;this.world(input.worldId);this.version(input.expectedVersion);
    if(!input.positions||typeof input.positions!=='object'||Array.isArray(input.positions)||Object.keys(input.positions).length>5000)return this.fail('VALIDATION','图谱节点位置不正确。');
    return this.transaction(()=>{
      const previous=this.snapshot().graphLayouts.find(l=>l.worldId===input.worldId);
      if((previous?.version??0)!==input.expectedVersion)this.fail('CONFLICT','图谱布局已有新修改，请重新载入图谱。');
      const positions={...previous?.positions};
      for(const [id,point] of Object.entries(input.positions)) {
        if(!validId(id)||!point||typeof point!=='object'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>100000||Math.abs(point.y)>100000)return this.fail('VALIDATION','节点位置超出有效范围。');
        if(this.character(id).worldId!==input.worldId)this.fail('VALIDATION','图谱节点不属于当前世界。');
        positions[id]={x:point.x,y:point.y};
      }
      const layout={worldId:input.worldId,version:(previous?.version??0)+1,positions};
      this.db.prepare('INSERT INTO graph_layouts(world_id,version,positions_json) VALUES(?,?,?) ON CONFLICT(world_id) DO UPDATE SET version=excluded.version,positions_json=excluded.positions_json').run(layout.worldId,layout.version,JSON.stringify(positions));return layout;
    });
  }
}
