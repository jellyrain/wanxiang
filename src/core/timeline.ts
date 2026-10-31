import { randomUUID } from 'node:crypto';
import type { Database } from './store.ts';
import type { Character, WorldEntry, WorldMap, TimelineInput, WorldTimeline, TimelineEvent } from '../shared/types.ts';

type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class TimelineStore {
  private db:Database; private transaction:<T>(operation:()=>T)=>T; private character:(id:string)=>Character; private entry:(id:string)=>WorldEntry; private map:(id:string)=>WorldMap; private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,character:(id:string)=>Character,entry:(id:string)=>WorldEntry,map:(id:string)=>WorldMap,fail:Reject) {
    this.db=db;this.transaction=transaction;this.character=character;this.entry=entry;this.map=map;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS world_timelines(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),timeline_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS timelines_world ON world_timelines(world_id);
      CREATE TABLE IF NOT EXISTS timeline_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));`);
  }
  private text(v:unknown,label:string,max:number):string {if(typeof v!=='string'||v.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);return v;}
  private version(v:unknown) {if(!Number.isSafeInteger(v)||Number(v)<0)this.fail('VALIDATION','年表版本不正确。');}
  snapshot():{timelines:WorldTimeline[]} {return {timelines:this.db.prepare('SELECT timeline_json FROM world_timelines ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).timeline_json)))};}
  get(id:unknown):WorldTimeline {if(!validId(id))return this.fail('VALIDATION','年表编号不正确。');const row=this.db.prepare('SELECT timeline_json FROM world_timelines WHERE id=?').get(id) as Row|undefined;return row?JSON.parse(String(row.timeline_json)):this.fail('NOT_FOUND','年表不存在。');}
  stageInUse(mapId:string,stageId:string):boolean {return this.snapshot().timelines.some(t=>t.events.some(e=>e.mapProgress.some(p=>p.mapId===mapId&&p.stageId===stageId)));}
  private write(t:WorldTimeline,action:string) {
    this.db.prepare('INSERT INTO world_timelines(id,world_id,timeline_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET timeline_json=excluded.timeline_json').run(t.id,t.worldId,JSON.stringify(t));
    this.db.prepare('INSERT INTO timeline_history(entity_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(t.id,t.version,action,JSON.stringify(t),t.updatedAt);return t;
  }
  save(raw:unknown):WorldTimeline {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','年表内容格式不正确。');const input=raw as TimelineInput;this.version(input.expectedVersion);
    if(!validId(input.worldId)||!this.db.prepare('SELECT id FROM worlds WHERE id=?').get(input.worldId))return this.fail('VALIDATION','所属世界不存在。');
    if(input.id!==undefined&&!validId(input.id))return this.fail('VALIDATION','年表编号不正确。');
    const name=this.text(input.name,'年表名称',120).trim(),description=this.text(input.description,'年表说明',10000);if(!name)this.fail('VALIDATION','请填写年表名称。');
    if(!Array.isArray(input.eras)||!input.eras.length||input.eras.length>100||!Array.isArray(input.events)||input.events.length>1000)return this.fail('VALIDATION','一份年表需要 1–100 个时代，最多 1000 个事件。');
    const eraIds=new Set<string>(),eraNames=new Set<string>();
    const eras=input.eras.map(e=>{if(!e||!validId(e.id)||eraIds.has(e.id))return this.fail('VALIDATION','时代编号无效或重复。');const name=this.text(e.name,'时代名称',80).trim();if(!name||eraNames.has(name))this.fail('VALIDATION','时代名称不能为空或重复。');eraIds.add(e.id);eraNames.add(name);return {id:e.id,name,description:this.text(e.description,'时代说明',3000)};});
    return this.transaction(()=>{
      const old=input.id?this.get(input.id):undefined;
      if(old&&old.worldId!==input.worldId)this.fail('VALIDATION','不能迁移年表所属世界。');
      if((old?.version??0)!==input.expectedVersion)this.fail('CONFLICT','年表已有新修改。当前编辑仍保留，请关闭编辑并重新读取后核对。');
      if(old?.archived)this.fail('VALIDATION','请先恢复年表，再进行编辑。');
      const eventIds=new Set<string>();
      const events:TimelineEvent[]=input.events.map(e=>{
        if(!e||!validId(e.id)||eventIds.has(e.id)||!eraIds.has(e.eraId)||!['draft','pending','confirmed'].includes(e.status)||typeof e.archived!=='boolean')return this.fail('VALIDATION','事件编号、所属时代或状态不正确。');eventIds.add(e.id);
        const previous=old?.events.find(p=>p.id===e.id),name=this.text(e.name,'事件名称',120).trim();if(!name)this.fail('VALIDATION','请填写事件名称。');
        const list=<T>(items:unknown,key:(item:T)=>string,label:string):T[]=>{if(!Array.isArray(items)||items.length>100||items.some(i=>!i))return this.fail('VALIDATION',`${label}格式无效，最多 100 项。`);const keys=items.map(key);if(new Set(keys).size!==keys.length)return this.fail('VALIDATION',`${label}不能重复。`);return items;};
        const belongs=(target:{worldId:string;archived:boolean},retained:boolean,label:string)=>{if(target.worldId!==input.worldId)this.fail('VALIDATION',`${label}不属于当前世界。`);if(target.archived&&!retained)this.fail('VALIDATION',`请先恢复${label}，再添加关联。`);};
        const participants=list<TimelineEvent['participants'][number]>(e.participants,p=>p.characterId,'参与人物').map(p=>{
          if(!validId(p.characterId)||(p.stageId!==null&&!validId(p.stageId)))return this.fail('VALIDATION','人物或阶段编号不正确。');const c=this.character(p.characterId),retained=previous?.participants.some(x=>x.characterId===p.characterId&&x.stageId===p.stageId)??false;belongs(c,retained,'人物');
          if(p.stageId!==null){const stage=c.stages.find(s=>s.id===p.stageId);if(!stage)this.fail('VALIDATION','人物阶段不属于所选人物。');if(stage!.archived&&!retained)this.fail('VALIDATION','请先恢复人物阶段，再添加关联。');}
          return {characterId:p.characterId,stageId:p.stageId};
        });
        const entryIds=list<string>(e.entryIds,id=>id,'关联设定').map(id=>{if(!validId(id))return this.fail('VALIDATION','设定编号不正确。');belongs(this.entry(id),previous?.entryIds.includes(id)??false,'设定');return id;});
        const places=list<TimelineEvent['places'][number]>(e.places,p=>`${p.mapId}:${p.locationId}`,'关联地点').map(p=>{
          if(!validId(p.mapId)||!validId(p.locationId))return this.fail('VALIDATION','地点编号不正确。');const m=this.map(p.mapId),retained=previous?.places.some(x=>x.mapId===p.mapId&&x.locationId===p.locationId)??false;belongs(m,retained,'地图');const location=m.locations.find(l=>l.id===p.locationId);if(!location)this.fail('VALIDATION','地点不属于所选地图。');if(location!.archived&&!retained)this.fail('VALIDATION','请先恢复地点，再添加关联。');return {mapId:p.mapId,locationId:p.locationId};
        });
        const mapProgress=list<TimelineEvent['mapProgress'][number]>(e.mapProgress,p=>p.mapId,'地图进度').map(p=>{
          if(!validId(p.mapId)||!validId(p.stageId))return this.fail('VALIDATION','地图进度编号不正确。');const m=this.map(p.mapId);belongs(m,previous?.mapProgress.some(x=>x.mapId===p.mapId&&x.stageId===p.stageId)??false,'地图');if(!m.stages.some(s=>s.id===p.stageId))this.fail('VALIDATION','剧情节点不属于所选地图。');return {mapId:p.mapId,stageId:p.stageId};
        });
        return {id:e.id,eraId:e.eraId,name,period:this.text(e.period,'发生时间',150),endPeriod:this.text(e.endPeriod,'结束时间',150),summary:this.text(e.summary,'事件摘要',1000),body:this.text(e.body,'事件正文',50000),status:e.status,participants,entryIds,places,mapProgress,archived:e.archived};
      });
      if(old?.events.some(e=>!eventIds.has(e.id)))this.fail('VALIDATION','已有事件不能直接移除，请归档以保留资料。');
      return this.write({id:old?.id??randomUUID(),worldId:input.worldId,name,description,eras,events,archived:false,version:(old?.version??0)+1,updatedAt:new Date().toISOString()},old?'编辑年表':'新建年表');
    });
  }
  archive(id:unknown,version:unknown,archived:unknown):WorldTimeline {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','归档状态不正确。');return this.transaction(()=>{const old=this.get(id);if(old.version!==version)this.fail('CONFLICT','年表已有新修改，请重新读取后操作。');if(old.archived===archived)return old;return this.write({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档年表':'恢复年表');});
  }
}
