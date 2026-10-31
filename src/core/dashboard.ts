import type { Database } from './store.ts';
import type { WorkDashboard, WorkDashboardInput } from '../shared/types.ts';
import { blankDashboard } from '../shared/overview.ts';
type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class DashboardStore {
  private db:Database;private transaction:<T>(operation:()=>T)=>T;private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,fail:Reject) {
    this.db=db;this.transaction=transaction;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS work_dashboards(work_id TEXT PRIMARY KEY REFERENCES works(id),dashboard_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));`);
  }
  private text(v:unknown,label:string,max:number):string {if(typeof v!=='string'||v.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);return v;}
  get(workId:unknown):WorkDashboard {
    if(!validId(workId))return this.fail('VALIDATION','作品编号不正确。');const work=this.db.prepare('SELECT id,world_id AS worldId FROM works WHERE id=?').get(workId) as {id:string;worldId:string}|undefined;if(!work)return this.fail('NOT_FOUND','作品不存在。');const row=this.db.prepare('SELECT dashboard_json FROM work_dashboards WHERE work_id=?').get(workId) as Row|undefined;return row?JSON.parse(String(row.dashboard_json)):blankDashboard(work);
  }
  snapshot():{dashboards:WorkDashboard[]} {return {dashboards:this.db.prepare('SELECT dashboard_json FROM work_dashboards ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).dashboard_json)))};}
  save(raw:unknown):WorkDashboard {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','创作计划格式不正确。');const input=raw as WorkDashboardInput;
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||!['worldbuilding','outlining','writing','revising','completed'].includes(input.phase))return this.fail('VALIDATION','版本或创作阶段不正确。');
    if(input.targetCharacters!==null&&(!Number.isSafeInteger(input.targetCharacters)||input.targetCharacters<1||input.targetCharacters>100000000))this.fail('VALIDATION','目标字符数请填写 1–100000000 的整数，或留空。');
    if(input.coverFlip!==undefined&&typeof input.coverFlip!=='boolean')this.fail('VALIDATION','封面镜像设置不正确。');
    const description=this.text(input.description,'作品简介',10000),genre=this.text(input.genre,'作品类型',100),memo=this.text(input.memo,'创作备忘',20000);
    if(!Array.isArray(input.tasks)||input.tasks.length>200)return this.fail('VALIDATION','待办最多 200 项。');const ids=new Set<string>();
    const tasks=input.tasks.map(t=>{if(!t||!validId(t.id)||ids.has(t.id)||typeof t.done!=='boolean')return this.fail('VALIDATION','待办编号或状态不正确。');const title=this.text(t.title,'待办',300).trim();if(!title)this.fail('VALIDATION','待办内容不能为空。');ids.add(t.id);return {id:t.id,title,done:t.done};});
    return this.transaction(()=>{
      const old=this.get(input.workId);if(old.version!==input.expectedVersion)this.fail('CONFLICT','创作计划已有新修改，请重新读取后核对。');
      if(input.coverId!==null){if(!validId(input.coverId))this.fail('VALIDATION','封面编号不正确。');const asset=this.db.prepare('SELECT world_id FROM assets WHERE id=?').get(input.coverId) as Row|undefined;if(!asset||asset.world_id!==old.worldId)this.fail('VALIDATION','封面图片不属于作品所在的世界。');}
      const saved:WorkDashboard={workId:old.workId,worldId:old.worldId,description,genre,phase:input.phase,coverId:input.coverId,coverFlip:input.coverFlip??old.coverFlip??false,targetCharacters:input.targetCharacters,memo,tasks,version:old.version+1,updatedAt:new Date().toISOString()};this.db.prepare('INSERT INTO work_dashboards(work_id,dashboard_json) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET dashboard_json=excluded.dashboard_json').run(saved.workId,JSON.stringify(saved));this.db.prepare('INSERT INTO dashboard_history(entity_id,version,snapshot_json,created_at) VALUES(?,?,?,?)').run(saved.workId,saved.version,JSON.stringify(saved),saved.updatedAt);return saved;
    });
  }
}
