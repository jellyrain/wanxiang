import { randomUUID } from 'node:crypto';
import type { Database } from './store.ts';
import type { WorkOutline, OutlineInput, Chapter, ChapterInput, Character, WorldMap, WorldEntry, WorldTimeline } from '../shared/types.ts';
import { emptyOutline } from '../shared/chapters.ts';

type Row=Record<string,unknown>;
type Reject=(code:string,message:string)=>never;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);

export class ChapterStore {
  private db:Database;
  private transaction:<T>(operation:()=>T)=>T;
  private character:(id:string)=>Character;
  private entry:(id:string)=>WorldEntry;
  private map:(id:string)=>WorldMap;
  private timeline:(id:string)=>WorldTimeline;
  private fail:Reject;
  constructor(db:Database,transaction:<T>(operation:()=>T)=>T,character:(id:string)=>Character,entry:(id:string)=>WorldEntry,map:(id:string)=>WorldMap,timeline:(id:string)=>WorldTimeline,fail:Reject) {
    this.db=db;this.transaction=transaction;this.character=character;this.entry=entry;this.map=map;this.timeline=timeline;this.fail=fail;
    db.exec(`CREATE TABLE IF NOT EXISTS work_outlines(work_id TEXT PRIMARY KEY REFERENCES works(id),outline_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chapters(id TEXT PRIMARY KEY,work_id TEXT NOT NULL REFERENCES works(id),chapter_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chapters_work ON chapters(work_id);
      CREATE TABLE IF NOT EXISTS chapter_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));
      CREATE TABLE IF NOT EXISTS outline_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_id TEXT NOT NULL,version INTEGER NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(entity_id,version));`);
  }
  private text(value:unknown,label:string,max:number):string {
    if(typeof value!=='string'||value.length>max)return this.fail('VALIDATION',`${label}格式不正确或内容过长。`);
    return value;
  }
  private version(value:unknown) {if(!Number.isSafeInteger(value)||Number(value)<0)this.fail('VALIDATION','版本编号不正确。');}
  private work(id:unknown):{id:string;worldId:string} {
    if(!validId(id))return this.fail('VALIDATION','作品编号不正确。');
    const row=this.db.prepare('SELECT id,world_id AS worldId FROM works WHERE id=?').get(id);
    return row?row as {id:string;worldId:string}:this.fail('NOT_FOUND','作品不存在。');
  }
  getOutline(workId:unknown):WorkOutline {
    const work=this.work(workId),row=this.db.prepare('SELECT outline_json FROM work_outlines WHERE work_id=?').get(work.id) as Row|undefined;
    return row?JSON.parse(String(row.outline_json)):emptyOutline(work);
  }
  get(id:unknown):Chapter {
    if(!validId(id))return this.fail('VALIDATION','章节编号不正确。');
    const row=this.db.prepare('SELECT chapter_json FROM chapters WHERE id=?').get(id) as Row|undefined;
    return row?JSON.parse(String(row.chapter_json)):this.fail('NOT_FOUND','章节不存在。');
  }
  snapshot():{outlines:WorkOutline[];chapters:Chapter[]} {
    return {outlines:this.db.prepare('SELECT outline_json FROM work_outlines ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).outline_json))),chapters:this.db.prepare('SELECT chapter_json FROM chapters ORDER BY rowid').all().map(r=>JSON.parse(String((r as Row).chapter_json)))};
  }
  stageInUse(mapId:string,stageId:string):boolean {
    return this.snapshot().chapters.some(c=>c.mapProgress.some(p=>p.mapId===mapId&&p.stageId===stageId));
  }
  private writeOutline(outline:WorkOutline,action:string):WorkOutline {
    this.db.prepare('INSERT INTO work_outlines(work_id,outline_json) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET outline_json=excluded.outline_json').run(outline.workId,JSON.stringify(outline));
    this.db.prepare('INSERT INTO outline_history(entity_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(outline.workId,outline.version,action,JSON.stringify(outline),outline.updatedAt);
    return outline;
  }
  private write(chapter:Chapter,action:string):Chapter {
    this.db.prepare('INSERT INTO chapters(id,work_id,chapter_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET chapter_json=excluded.chapter_json').run(chapter.id,chapter.workId,JSON.stringify(chapter));
    this.db.prepare('INSERT INTO chapter_history(entity_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(chapter.id,chapter.version,action,JSON.stringify(chapter),chapter.updatedAt);
    return chapter;
  }
  saveOutline(raw:unknown):WorkOutline {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','作品大纲格式不正确。');
    const input=raw as OutlineInput;this.version(input.expectedVersion);
    const synopsis=this.text(input.synopsis,'作品大纲',100000);
    if(!Array.isArray(input.volumes)||input.volumes.length>200||!Array.isArray(input.chapterIds)||input.chapterIds.length>10000)return this.fail('VALIDATION','最多配置 200 卷与 10000 章。');
    const ids=new Set<string>(),names=new Set<string>();
    const volumes=input.volumes.map(v=>{
      if(!v||!validId(v.id)||ids.has(v.id))return this.fail('VALIDATION','分卷编号无效或重复。');
      const name=this.text(v.name,'卷名',120).trim();if(!name||names.has(name))this.fail('VALIDATION','卷名不能为空或重复。');
      ids.add(v.id);names.add(name);return {id:v.id,name,summary:this.text(v.summary,'分卷梗概',20000)};
    });
    if(input.chapterIds.some(id=>!validId(id))||new Set(input.chapterIds).size!==input.chapterIds.length)return this.fail('VALIDATION','章节顺序包含无效或重复编号。');
    return this.transaction(()=>{
      const old=this.getOutline(input.workId);
      if(old.version!==input.expectedVersion)this.fail('CONFLICT','目录已有新修改，请保留当前内容并重新读取后核对。');
      const chapters=this.db.prepare('SELECT chapter_json FROM chapters WHERE work_id=?').all(old.workId).map(r=>JSON.parse(String((r as Row).chapter_json)) as Chapter);
      if(chapters.length!==input.chapterIds.length||chapters.some(c=>!input.chapterIds.includes(c.id)))this.fail('VALIDATION','目录必须完整保留这部作品的全部章节，包括已归档章节。');
      if(chapters.some(c=>c.volumeId!==null&&!ids.has(c.volumeId)))this.fail('VALIDATION','该分卷仍有章节，请先移动章节再移除分卷。');
      return this.writeOutline({...old,synopsis,volumes,chapterIds:[...input.chapterIds],version:old.version+1,updatedAt:new Date().toISOString()},'编辑大纲与目录');
    });
  }
  save(raw:unknown):Chapter {
    if(!raw||typeof raw!=='object')return this.fail('VALIDATION','章节内容格式不正确。');
    const input=raw as ChapterInput;this.version(input.expectedVersion);this.version(input.expectedOutlineVersion);
    if(input.id!==undefined&&!validId(input.id))return this.fail('VALIDATION','章节编号不正确。');
    if(input.volumeId!==null&&!validId(input.volumeId))return this.fail('VALIDATION','所属分卷不正确。');
    const name=this.text(input.name,'章节名称',160).trim();if(!name)this.fail('VALIDATION','请填写章节名称。');
    if(!['planned','draft','revising','finished'].includes(input.status))return this.fail('VALIDATION','写作状态不正确。');
    const summary=this.text(input.summary,'章节梗概',20000),body=this.text(input.body,'章节正文',300000),notes=this.text(input.notes,'创作备忘',50000);
    return this.transaction(()=>{
      const outline=this.getOutline(input.workId),old=input.id?this.get(input.id):undefined;
      if(old&&old.workId!==outline.workId)this.fail('VALIDATION','不能迁移章节所属作品。');
      if((old?.version??0)!==input.expectedVersion)this.fail('CONFLICT','章节已有新修改。当前草稿仍保留，请核对后再保存。');
      if(old?.archived)this.fail('VALIDATION','请先恢复章节，再进行编辑。');
      if(!old&&outline.version!==input.expectedOutlineVersion)this.fail('CONFLICT','目录已有新修改，请保留草稿并重新读取目录后再保存。');
      if(!old&&outline.chapterIds.length>=10000)this.fail('VALIDATION','一部作品最多保留 10000 章。');
      if(input.volumeId!==null&&!outline.volumes.some(v=>v.id===input.volumeId))this.fail('VALIDATION','分卷不属于这部作品。');
      const list=<T>(items:unknown,key:(item:T)=>string,label:string):T[]=>{
        if(!Array.isArray(items)||items.length>100||items.some(i=>!i))return this.fail('VALIDATION',`${label}格式无效，最多 100 项。`);
        if(new Set(items.map(key)).size!==items.length)return this.fail('VALIDATION',`${label}不能重复。`);return items;
      };
      const belongs=(target:{worldId:string;archived:boolean},retained:boolean,label:string)=>{
        if(target.worldId!==outline.worldId)this.fail('VALIDATION',`${label}不属于作品所在的世界。`);
        if(target.archived&&!retained)this.fail('VALIDATION',`请先恢复${label}，再添加关联。`);
      };
      const participants=list<Chapter['participants'][number]>(input.participants,p=>p.characterId,'参与人物').map(p=>{
        if(!validId(p.characterId)||(p.stageId!==null&&!validId(p.stageId)))return this.fail('VALIDATION','人物或阶段编号不正确。');
        const c=this.character(p.characterId),retained=old?.participants.some(x=>x.characterId===p.characterId&&x.stageId===p.stageId)??false;
        belongs(c,retained,'人物');
        if(p.stageId!==null){const s=c.stages.find(s=>s.id===p.stageId);if(!s)this.fail('VALIDATION','人物阶段不属于所选人物。');if(s!.archived&&!retained)this.fail('VALIDATION','请先恢复人物阶段，再添加关联。');}
        return {characterId:p.characterId,stageId:p.stageId};
      });
      const events=list<Chapter['events'][number]>(input.events,p=>`${p.timelineId}:${p.eventId}`,'年表事件').map(p=>{
        if(!validId(p.timelineId)||!validId(p.eventId))return this.fail('VALIDATION','年表事件编号不正确。');
        const t=this.timeline(p.timelineId),retained=old?.events.some(x=>x.timelineId===p.timelineId&&x.eventId===p.eventId)??false;belongs(t,retained,'年表');
        const e=t.events.find(e=>e.id===p.eventId);if(!e)this.fail('VALIDATION','事件不属于所选年表。');if(e!.archived&&!retained)this.fail('VALIDATION','请先恢复事件，再添加关联。');
        return {timelineId:p.timelineId,eventId:p.eventId};
      });
      const entryIds=list<string>(input.entryIds,id=>id,'关联设定').map(id=>{if(!validId(id))return this.fail('VALIDATION','设定编号不正确。');belongs(this.entry(id),old?.entryIds.includes(id)??false,'设定');return id;});
      const mapProgress=list<Chapter['mapProgress'][number]>(input.mapProgress,p=>p.mapId,'地图进度').map(p=>{
        if(!validId(p.mapId)||!validId(p.stageId))return this.fail('VALIDATION','地图进度编号不正确。');
        const m=this.map(p.mapId);belongs(m,old?.mapProgress.some(x=>x.mapId===p.mapId&&x.stageId===p.stageId)??false,'地图');
        if(!m.stages.some(s=>s.id===p.stageId))this.fail('VALIDATION','剧情节点不属于所选地图。');return {mapId:p.mapId,stageId:p.stageId};
      });
      const chapter:Chapter={id:old?.id??randomUUID(),workId:outline.workId,worldId:outline.worldId,volumeId:input.volumeId,name,summary,body,notes,status:input.status,participants,events,entryIds,mapProgress,archived:false,version:(old?.version??0)+1,updatedAt:new Date().toISOString()};
      this.write(chapter,old?'编辑章节':'新建章节');
      // Inserting a chapter and adding it to the directory must succeed together.
      if(!old)this.writeOutline({...outline,chapterIds:[...outline.chapterIds,chapter.id],version:outline.version+1,updatedAt:chapter.updatedAt},'新增章节');
      return chapter;
    });
  }
  archive(id:unknown,version:unknown,archived:unknown):Chapter {
    this.version(version);if(typeof archived!=='boolean')return this.fail('VALIDATION','归档状态不正确。');
    return this.transaction(()=>{const old=this.get(id);if(old.version!==version)this.fail('CONFLICT','章节已有新修改，请重新读取后操作。');if(old.archived===archived)return old;return this.write({...old,archived,version:old.version+1,updatedAt:new Date().toISOString()},archived?'归档章节':'恢复章节');});
  }
}
