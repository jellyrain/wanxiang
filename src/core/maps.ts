import { randomUUID } from 'node:crypto';
import type { Database } from './store.ts';
import type { Asset, Character, MapLocation, WorldEntry, WorldMap, WorldMapInput, MapPoint } from '../shared/types.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../shared/maps.ts';
type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class MapStore {
  private db:Database; private transaction:<T>(operation:()=>T)=>T; private character:(id:string)=>Character; private entry:(id:string)=>WorldEntry; private asset:(id:string)=>Asset|undefined; private fail:Reject;
  private stageReferenced:(mapId:string,stageId:string)=>boolean;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,character:(id:string)=>Character,entry:(id:string)=>WorldEntry,asset:(id:string)=>Asset|undefined,fail:Reject,stageReferenced:(mapId:string,stageId:string)=>boolean=()=>false) {
    this.stageReferenced=stageReferenced;
    this.db=db;this.transaction=transaction;this.character=character;this.entry=entry;this.asset=asset;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS world_maps(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),map_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS maps_world ON world_maps(world_id);
      CREATE TABLE IF NOT EXISTS map_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));`);
  }
  private text(value:unknown,label:string,max:number):string {if(typeof value!=='string'||value.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);return value;}
  private version(v:unknown) {if(!Number.isSafeInteger(v)||Number(v)<0)this.fail('VALIDATION','地图版本不正确。');}
  private point(v:unknown):MapPoint {const p=v as MapPoint;if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>MAP_WIDTH||p.y>MAP_HEIGHT)return this.fail('VALIDATION','坐标必须在地图范围内（横向 0–1600，纵向 0–900）。');return {x:p.x,y:p.y};}
  private image(id:unknown,worldId:string):string|null {if(id===null)return null;if(!validId(id)||this.asset(id)?.worldId!==worldId)return this.fail('VALIDATION','图片不属于当前世界。');return id;}
  snapshot():{maps:WorldMap[]} {return {maps:this.db.prepare('SELECT map_json FROM world_maps ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).map_json)))};}
  get(id:unknown):WorldMap {if(!validId(id))return this.fail('VALIDATION','地图编号不正确。');const row=this.db.prepare('SELECT map_json FROM world_maps WHERE id=?').get(id) as Row|undefined;return row?JSON.parse(String(row.map_json)):this.fail('NOT_FOUND','地图不存在。');}
  private write(map:WorldMap,action:string) {
    this.db.prepare('INSERT INTO world_maps(id,world_id,map_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET map_json=excluded.map_json').run(map.id,map.worldId,JSON.stringify(map));
    this.db.prepare('INSERT INTO map_history(entity_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(map.id,map.version,action,JSON.stringify(map),map.updatedAt);
    return map;
  }
  save(raw:unknown):WorldMap {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','地图内容格式不正确。');
    const input=raw as WorldMapInput;this.version(input.expectedVersion);
    if(!validId(input.worldId)||!this.db.prepare('SELECT id FROM worlds WHERE id=?').get(input.worldId))return this.fail('VALIDATION','所属世界不存在。');
    if(input.id!==undefined&&!validId(input.id))return this.fail('VALIDATION','地图编号不正确。');
    const name=this.text(input.name,'地图名称',120).trim(),description=this.text(input.description,'地图说明',10000);
    if(!name)return this.fail('VALIDATION','请填写地图名称。');
    if(!Array.isArray(input.stages)||input.stages.length<1||input.stages.length>100)return this.fail('VALIDATION','剧情节点需要 1–100 个。');
    if(!Array.isArray(input.locations)||input.locations.length>500||!Array.isArray(input.terrain)||input.terrain.length>1000)return this.fail('VALIDATION','每张地图最多 500 个地点、1000 笔地形。');
    const stageIds=new Set<string>(),stageNames=new Set<string>();
    const stages=input.stages.map(s=>{if(!s||!validId(s.id)||stageIds.has(s.id))return this.fail('VALIDATION','剧情节点编号无效或重复。');const name=this.text(s.name,'剧情节点名称',80).trim();if(!name||stageNames.has(name))this.fail('VALIDATION','剧情节点名称不能为空或重复。');stageIds.add(s.id);stageNames.add(name);return {id:s.id,name};});
    const strokeIds=new Set<string>();let pointCount=0;
    const terrain=input.terrain.map(s=>{
      if(!s||!validId(s.id)||strokeIds.has(s.id)||!['land','forest','mountain','river','road'].includes(s.kind)||!Array.isArray(s.points)||s.points.length>(1000)||s.points.length<(['land','forest'].includes(s.kind)?3:2))return this.fail('VALIDATION','地形笔画格式不正确，区域至少需要三个点。');
      strokeIds.add(s.id);pointCount+=s.points.length;if(pointCount>50000)this.fail('VALIDATION','地图笔画过多，请简化部分地形后保存。');
      return {id:s.id,kind:s.kind,points:s.points.map(p=>this.point(p))};
    });
    return this.transaction(()=>{
      const old=input.id?this.get(input.id):undefined;
      if(old&&old.worldId!==input.worldId)this.fail('VALIDATION','不能迁移地图所属世界。');
      if((old?.version??0)!==input.expectedVersion)this.fail('CONFLICT','地图已有新修改。当前草稿仍保留，请先核对再重新载入。');
      if(old?.archived)this.fail('VALIDATION','请先恢复地图，再进行编辑。');
      if(old?.stages.some(s=>!stageIds.has(s.id)&&this.stageReferenced(old.id,s.id)))this.fail('VALIDATION','被年表事件或章节引用的剧情节点不能移除，请先调整关联。');
      const locationIds=new Set<string>();
      const locations:MapLocation[]=input.locations.map(l=>{
        if(!l||!validId(l.id)||locationIds.has(l.id)||!stageIds.has(l.unlockStageId)||typeof l.favorite!=='boolean'||typeof l.archived!=='boolean')return this.fail('VALIDATION','地点编号、剧情节点或状态不正确。');
        locationIds.add(l.id);const previous=old?.locations.find(p=>p.id===l.id);
        const name=this.text(l.name,'地点名称',120).trim(),kind=this.text(l.kind,'地点类别',60).trim();if(!name||!kind)this.fail('VALIDATION','地点名称和类别不能为空。');
        const references=(ids:unknown,type:'entry'|'character'):string[]=>{
          if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)return this.fail('VALIDATION','关联档案编号无效或重复，最多 100 项。');
          for(const id of ids){const target=type==='entry'?this.entry(id):this.character(id);if(target.worldId!==input.worldId)this.fail('VALIDATION','地点只能关联当前世界的档案。');if(target.archived&&!(type==='entry'?previous?.entryIds:previous?.characterIds)?.includes(id))this.fail('VALIDATION','请先恢复档案，再添加地点关联。');}
          return [...ids];
        };
        return {id:l.id,name,kind,description:this.text(l.description,'地点说明',20000),...this.point(l),unlockStageId:l.unlockStageId,imageId:this.image(l.imageId,input.worldId),entryIds:references(l.entryIds,'entry'),characterIds:references(l.characterIds,'character'),favorite:l.favorite,archived:l.archived};
      });
      if(old?.locations.some(l=>!locationIds.has(l.id)))this.fail('VALIDATION','已有地点不能直接移除，请归档以保留资料。');
      const map:WorldMap={id:old?.id??randomUUID(),worldId:input.worldId,name,description,backgroundId:this.image(input.backgroundId,input.worldId),stages,locations,terrain,archived:false,version:(old?.version??0)+1,updatedAt:new Date().toISOString()};
      return this.write(map,old?'编辑地图':'新建地图');
    });
  }
  archive(id:unknown,version:unknown,archived:unknown):WorldMap {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','归档状态不正确。');
    return this.transaction(()=>{const old=this.get(id);if(old.version!==version)this.fail('CONFLICT','地图已有新修改，请重新读取后操作。');if(old.archived===archived)return old;return this.write({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档地图':'恢复地图');});
  }
}
