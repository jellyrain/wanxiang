import { randomUUID } from 'node:crypto';
import type { Database } from './store.ts';
import type { World, WorldInput, Work, WorkInput, NewWorkInput } from '../shared/types.ts';

type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class WorkspaceStore {
  private db:Database;
  private transaction:<T>(operation:()=>T)=>T;
  private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,fail:Reject) {
    this.db=db;this.transaction=transaction;this.fail=fail;
    // Metadata is separate so opening an old library never rewrites its works or worlds.
    db.exec(`CREATE TABLE IF NOT EXISTS work_settings(work_id TEXT PRIMARY KEY REFERENCES works(id),version INTEGER NOT NULL,archived INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS world_settings(world_id TEXT PRIMARY KEY REFERENCES worlds(id),description TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_history(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,entity_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(kind,entity_id,version));`);
  }
  private name(value:unknown,label:string):string {
    if(typeof value!=='string'||!value.trim()||value.trim().length>200)return this.fail('VALIDATION',`${label}请填写 1–200 个字符。`);
    return value.trim();
  }
  private description(value:unknown):string {if(typeof value!=='string'||value.length>10000)return this.fail('VALIDATION','世界简介最多 10000 个字符。');return value;}
  private version(value:unknown) {if(!Number.isSafeInteger(value)||Number(value)<0)this.fail('VALIDATION','版本编号不正确。');}
  worlds():World[] {
    return this.db.prepare("SELECT w.id,w.name,coalesce(s.description,'') AS description,coalesce(s.version,0) AS version,coalesce(s.updated_at,'') AS updatedAt FROM worlds w LEFT JOIN world_settings s ON s.world_id=w.id ORDER BY w.rowid").all() as World[];
  }
  works():Work[] {
    return this.db.prepare("SELECT w.id,w.world_id AS worldId,w.name,d.name AS worldName,coalesce(s.version,0) AS version,coalesce(s.archived,0) AS archived,coalesce(s.updated_at,'') AS updatedAt FROM works w JOIN worlds d ON d.id=w.world_id LEFT JOIN work_settings s ON s.work_id=w.id ORDER BY w.rowid").all().map(r=>({...r as Omit<Work,'archived'>,archived:Boolean((r as Row).archived)}));
  }
  getWorld(id:unknown):World {if(!validId(id))return this.fail('VALIDATION','世界编号不正确。');return this.worlds().find(w=>w.id===id)??this.fail('NOT_FOUND','世界不存在。');}
  getWork(id:unknown):Work {if(!validId(id))return this.fail('VALIDATION','作品编号不正确。');return this.works().find(w=>w.id===id)??this.fail('NOT_FOUND','作品不存在。');}
  activeWorkId():string|null {
    const row=this.db.prepare("SELECT value FROM meta WHERE key='active-work'").get() as Row|undefined,works=this.works().filter(w=>!w.archived);
    return works.find(w=>w.id===row?.value)?.id??works[0]?.id??null;
  }
  selectWork(id:unknown):string {return this.transaction(()=>{const work=this.getWork(id);if(work.archived)this.fail('VALIDATION','请先恢复这部作品，再打开。');this.db.prepare("INSERT INTO meta(key,value) VALUES('active-work',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(work.id);return work.id;});}
  private history(kind:'work'|'world',value:Work|World,action:string) {
    this.db.prepare('INSERT INTO workspace_history(kind,entity_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').run(kind,value.id,value.version,action,JSON.stringify(value),value.updatedAt);
  }
  private recordWork(value:Work,action:string):Work {
    this.db.prepare('INSERT INTO work_settings(work_id,version,archived,updated_at) VALUES(?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET version=excluded.version,archived=excluded.archived,updated_at=excluded.updated_at').run(value.id,value.version,Number(value.archived),value.updatedAt);
    this.history('work',value,action);return value;
  }
  saveWorld(raw:unknown):World {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','世界信息格式不正确。');const input=raw as WorldInput;
    const name=this.name(input.name,'世界名称'),description=this.description(input.description);this.version(input.expectedVersion);
    return this.transaction(()=>{
      const old=input.id===undefined?undefined:this.getWorld(input.id);
      if((old?.version??0)!==input.expectedVersion)this.fail('CONFLICT','世界信息已有新修改，请重新打开后核对。');
      if(this.worlds().some(w=>w.id!==old?.id&&w.name.toLocaleLowerCase()===name.toLocaleLowerCase()))this.fail('VALIDATION','已有同名世界，请换个名称或使用已有世界。');
      const value:World={id:old?.id??randomUUID(),name,description,version:(old?.version??0)+1,updatedAt:new Date().toISOString()};
      if(old)this.db.prepare('UPDATE worlds SET name=? WHERE id=?').run(name,old.id);else this.db.prepare('INSERT INTO worlds(id,name) VALUES(?,?)').run(value.id,name);
      this.db.prepare('INSERT INTO world_settings(world_id,description,version,updated_at) VALUES(?,?,?,?) ON CONFLICT(world_id) DO UPDATE SET description=excluded.description,version=excluded.version,updated_at=excluded.updated_at').run(value.id,description,value.version,value.updatedAt);
      this.history('world',value,old?'编辑世界':'新建世界');return value;
    });
  }
  createWork(raw:unknown):Work {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','新作品信息格式不正确。');const input=raw as NewWorkInput,name=this.name(input.name,'作品名称');
    if(!input.world||!['new','existing'].includes(input.world.kind))return this.fail('VALIDATION','请选择使用已有世界或新建世界。');
    return this.transaction(()=>{
      const world=input.world.kind==='existing'?this.getWorld(input.world.id):this.saveWorld({name:input.world.name,description:input.world.description,expectedVersion:0});
      if(this.works().some(w=>w.worldId===world.id&&w.name.toLocaleLowerCase()===name.toLocaleLowerCase()))this.fail('VALIDATION','这个世界已有同名作品，归档作品也可以恢复后继续使用。');
      const value:Work={id:randomUUID(),name,worldId:world.id,worldName:world.name,version:1,archived:false,updatedAt:new Date().toISOString()};
      this.db.prepare('INSERT INTO works(id,world_id,name) VALUES(?,?,?)').run(value.id,value.worldId,value.name);
      return this.recordWork(value,'新建作品');
    });
  }
  saveWork(raw:unknown):Work {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','作品信息格式不正确。');const input=raw as WorkInput;this.version(input.expectedVersion);const name=this.name(input.name,'作品名称');
    return this.transaction(()=>{
      const old=this.getWork(input.id);
      if(Object.hasOwn(input,'worldId')&&(input as WorkInput&{worldId:unknown}).worldId!==old.worldId)this.fail('VALIDATION','已有作品不能直接更换所属世界。请新建作品选择对应世界。');
      if(old.version!==input.expectedVersion)this.fail('CONFLICT','作品信息已有新修改，请重新打开后核对。');
      if(old.archived)this.fail('VALIDATION','请先恢复作品，再编辑名称。');
      if(this.works().some(w=>w.id!==old.id&&w.worldId===old.worldId&&w.name.toLocaleLowerCase()===name.toLocaleLowerCase()))this.fail('VALIDATION','这个世界已有同名作品。');
      this.db.prepare('UPDATE works SET name=? WHERE id=?').run(name,old.id);
      return this.recordWork({...old,name,version:old.version+1,updatedAt:new Date().toISOString()},'编辑作品');
    });
  }
  archiveWork(id:unknown,version:unknown,archived:unknown):Work {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','归档状态不正确。');
    return this.transaction(()=>{
      const old=this.getWork(id);if(old.version!==version)this.fail('CONFLICT','作品信息已有新修改，请重新读取。');
      if(old.archived===archived)return old;
      const others=this.works().filter(w=>!w.archived&&w.id!==old.id);
      if(archived&&!others.length)this.fail('VALIDATION','请保留至少一部使用中的作品；可以先新建作品再归档。');
      const wasActive=this.activeWorkId()===old.id;
      const saved=this.recordWork({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档作品':'恢复作品');
      if(archived&&wasActive)this.selectWork(others[0].id);
      return saved;
    });
  }
}
