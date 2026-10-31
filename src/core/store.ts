import {CatalogStore} from './catalogs.ts';
import { DeletionStore } from './deletion.ts';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset, Character, CharacterInput, Fact, LibrarySnapshot, Tag, TagInput, Work, AttributeTemplate, AttributeDimension, AttributeTemplateInput, AttributeDefault, CharacterAttributes } from '../shared/types.ts';
import { isTheme, type ThemeId } from '../shared/themes.ts';
import { emptyAttributes, attributesForRead, validateAttributes } from './attributes.ts';
import type { CharacterVariantsInput, CharacterStageInput, CharacterStage, CharacterForm, CharacterIdentity } from '../shared/types.ts';
import { validateVariants, buildStage, validJourneyId } from './journey.ts';
import { RelationStore } from './relations.ts';
import { WorldStore } from './world.ts';
import { MapStore } from './maps.ts';
import { TimelineStore } from './timeline.ts';
import { ChapterStore } from './chapters.ts';
import { GalleryStore } from './gallery.ts';
import { DashboardStore } from './dashboard.ts';
import { WorkspaceStore } from './workspace.ts';
import { BackupJournal } from './backup-journal.ts';
import { HistoryStore } from './history.ts';
import { TransferService } from './transfer.ts';

interface Statement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): { changes: number | bigint };
}
export interface Database { exec(sql: string): unknown; prepare(sql: string): Statement; close(): void }
type Row = Record<string, unknown>;
export class ContentError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const fail = (code: string, message: string): never => { throw new ContentError(code, message); };
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
function text(value: unknown, label: string, limit = 5000): string {
  if (typeof value !== 'string' || value.length > limit) fail('VALIDATION', `${label}格式不正确或内容过长。`);
  return value as string;
}

export class LibraryStore {
  private db: Database;
  private transactionDepth = 0;
  readonly mediaDir: string;
  readonly catalogs:CatalogStore;
  readonly graph: RelationStore;
  readonly world: WorldStore;
  readonly maps: MapStore;
  readonly timeline: TimelineStore;
  readonly chapters: ChapterStore;
  readonly gallery: GalleryStore;
  readonly dashboard: DashboardStore;
  readonly workspace: WorkspaceStore;
  readonly journal: BackupJournal;
  readonly history: HistoryStore;
  readonly transfer: TransferService;
  writesPaused = false;
  closing = false;
  assertWritable(generation?:string) {
    if(this.closing)fail('BUSY','万象工坊正在退出，请保留输入，重新启动软件后再保存。');
    if(this.writesPaused)fail('BUSY','资料库正在恢复，请等待恢复完成后重新打开页面。');
    if((generation!==undefined||this.journal.get('requireGeneration')==='1')&&generation!==this.journal.get('generation'))fail('RESTORED','资料库已恢复到其他时间点。请保留草稿，重新打开页面并核对后再保存。');
  }
  constructor(db: Database, directory: string) {
    this.db = db;
    this.mediaDir = join(directory, 'media');
    mkdirSync(this.mediaDir, { recursive: true });
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), file_name TEXT NOT NULL,
        mime TEXT NOT NULL, source_name TEXT NOT NULL, UNIQUE(world_id,file_name));
      CREATE TABLE IF NOT EXISTS characters(id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), name TEXT NOT NULL,
        caption TEXT NOT NULL, status TEXT NOT NULL, quote TEXT NOT NULL, intro TEXT NOT NULL, body TEXT NOT NULL,
        pending TEXT NOT NULL, facts_json TEXT NOT NULL, portrait_id TEXT REFERENCES assets(id), archived INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL, updated_at TEXT NOT NULL, source_json TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS characters_world ON characters(world_id,archived);
      CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), name TEXT NOT NULL,
        UNIQUE(world_id,name));
      CREATE TABLE IF NOT EXISTS character_tags(character_id TEXT NOT NULL REFERENCES characters(id),
        tag_id TEXT NOT NULL REFERENCES tags(id), PRIMARY KEY(character_id,tag_id));
      CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL REFERENCES characters(id),
        version INTEGER NOT NULL, action TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(character_id,version));
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    db.exec(`CREATE TABLE IF NOT EXISTS attribute_templates(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),
      name TEXT NOT NULL,version INTEGER NOT NULL,dimensions_json TEXT NOT NULL,UNIQUE(world_id,name));
      CREATE TABLE IF NOT EXISTS attribute_defaults(world_id TEXT PRIMARY KEY REFERENCES worlds(id),
      template_id TEXT REFERENCES attribute_templates(id),version INTEGER NOT NULL);`);
    db.exec(`CREATE TABLE IF NOT EXISTS character_stages(id TEXT PRIMARY KEY,character_id TEXT NOT NULL REFERENCES characters(id),position INTEGER NOT NULL,stage_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS character_stages_owner ON character_stages(character_id,position);`);
    this.transaction(() => {
      const tagColumns = db.prepare('PRAGMA table_info(tags)').all() as Row[];
      if (!tagColumns.some(c => c.name === 'color')) db.exec("ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT '#bda374'");
      if (!tagColumns.some(c => c.name === 'version')) db.exec('ALTER TABLE tags ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
      const columns = db.prepare('PRAGMA table_info(characters)').all() as Row[];
      if (!columns.some(c=>c.name==='variants_json')) db.exec(`ALTER TABLE characters ADD COLUMN variants_json TEXT NOT NULL DEFAULT '{"identities":[],"forms":[],"defaultFormId":"base"}'`);
      if (!columns.some(c=>c.name==='abilities')) db.exec("ALTER TABLE characters ADD COLUMN abilities TEXT NOT NULL DEFAULT ''");
      if (!columns.some(c=>c.name==='attributes_json')) db.exec(`ALTER TABLE characters ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{"templateId":null,"values":{},"versions":{}}'`);
      if (!columns.some(c => c.name === 'portrait_width')) {
        db.exec('ALTER TABLE characters ADD COLUMN portrait_width REAL NOT NULL DEFAULT 100');
        // Only reframe the original seed images. User replacements retain their full width.
        db.exec(`UPDATE characters SET portrait_width=CASE json_extract(source_json,'$.id') WHEN 'gu' THEN 32.5 ELSE 29.5 END
          WHERE (json_extract(source_json,'$.id')='gu' AND portrait_id IN (SELECT id FROM assets WHERE source_name='gu.png'))
             OR (json_extract(source_json,'$.id')='mo' AND portrait_id IN (SELECT id FROM assets WHERE source_name='mo.png'))`);
      }
    });
    this.workspace=new WorkspaceStore(db,operation=>this.transaction(operation),fail);
    this.gallery=new GalleryStore(db,operation=>this.transaction(operation),fail);
    this.dashboard=new DashboardStore(db,operation=>this.transaction(operation),fail);
    this.graph=new RelationStore(db,operation=>this.transaction(operation),id=>this.getCharacter(id),fail);
    this.world=new WorldStore(db,operation=>this.transaction(operation),id=>this.getCharacter(id),id=>this.getAsset(id),fail);
    this.maps=new MapStore(db,operation=>this.transaction(operation),id=>this.getCharacter(id),id=>this.world.getEntry(id),id=>this.getAsset(id),fail,(mapId,stageId)=>this.timeline.stageInUse(mapId,stageId)||this.chapters.stageInUse(mapId,stageId));
    this.timeline=new TimelineStore(db,operation=>this.transaction(operation),id=>this.getCharacter(id),id=>this.world.getEntry(id),id=>this.maps.get(id),fail);
    this.chapters=new ChapterStore(db,operation=>this.transaction(operation),id=>this.getCharacter(id),id=>this.world.getEntry(id),id=>this.maps.get(id),id=>this.timeline.get(id),fail);
    db.exec('CREATE TABLE IF NOT EXISTS character_images(character_id TEXT PRIMARY KEY REFERENCES characters(id),design_image_id TEXT REFERENCES assets(id));');
    this.catalogs=new CatalogStore(db,this);
    this.journal=new BackupJournal(db);
    this.history=new HistoryStore(db,this,operation=>this.transaction(operation),fail);
    this.transfer=new TransferService(this);
    this.deletion=new DeletionStore(this,db);
  }
  readonly deletion:DeletionStore;
  close() { this.db.close(); }
  importTransaction<T>(operation:()=>T):T { return this.transaction(operation); }
  private transaction<T>(operation: () => T): T {
    const savepoint = this.transactionDepth ? `content_${this.transactionDepth}` : null;
    this.db.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const result = operation();
      this.db.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      this.db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      throw error;
    } finally { this.transactionDepth--; }
  }
  private worldExists(id: unknown): asserts id is string {
    if (!isId(id) || !this.db.prepare('SELECT id FROM worlds WHERE id=?').get(id)) fail('VALIDATION', '所属世界不存在。');
  }
  snapshot(): LibrarySnapshot {
    const works = this.workspace.works();
    const characters = this.db.prepare('SELECT * FROM characters ORDER BY rowid').all().map(row => this.characterFromRow(row as Row));
    const tags = this.db.prepare('SELECT id,world_id AS worldId,name,color,version FROM tags ORDER BY rowid').all() as Tag[];
    const attributeDefaults = this.db.prepare('SELECT world_id AS worldId,template_id AS templateId,version FROM attribute_defaults').all() as AttributeDefault[];
    return { generation:this.journal.get('generation')!, works, worlds:this.workspace.worlds(), activeWorkId:this.workspace.activeWorkId(), characters, tags, theme:this.getTheme(), attributeTemplates:this.attributeTemplates(), attributeDefaults, ...this.catalogs.snapshot(), ...this.graph.snapshot(), ...this.world.snapshot(), ...this.maps.snapshot(), ...this.timeline.snapshot(), ...this.chapters.snapshot(), ...this.gallery.snapshot(), ...this.dashboard.snapshot() };
  }
  attributeTemplates(worldId?:string):AttributeTemplate[] {
    const rows = worldId ? this.db.prepare('SELECT * FROM attribute_templates WHERE world_id=? ORDER BY rowid').all(worldId) : this.db.prepare('SELECT * FROM attribute_templates ORDER BY rowid').all();
    return rows.map(row => { const r=row as Row; return {id:String(r.id),worldId:String(r.world_id),name:String(r.name),version:Number(r.version),dimensions:JSON.parse(String(r.dimensions_json))}; });
  }
  saveAttributeTemplate(raw:unknown):AttributeTemplate {
    if (!raw || typeof raw !== 'object') return fail('VALIDATION','属性模板格式不正确。');
    const input=raw as AttributeTemplateInput;
    this.worldExists(input.worldId);
    const name=text(input.name,'模板名称',60).trim();
    if (!name || (input.id !== undefined && !isId(input.id)) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<0 || !Number.isSafeInteger(input.expectedDefaultVersion) || input.expectedDefaultVersion<0 || typeof input.makeDefault !== 'boolean') return fail('VALIDATION','请填写模板名称和有效的模板信息。');
    if (!Array.isArray(input.dimensions) || input.dimensions.length<1 || input.dimensions.length>60) return fail('VALIDATION','模板需要 1 至 60 个维度。');
    const ids=new Set<string>(), names=new Set<string>();
    const dimensions:AttributeDimension[]=input.dimensions.map(d=>{
      if (!d || !isId(d.id) || ids.has(d.id)) return fail('VALIDATION','维度编号无效或重复。');
      const dimensionName=text(d.name,'维度名称',40).trim();
      if (!dimensionName || names.has(dimensionName)) return fail('VALIDATION','维度名称不能为空或重复。');
      if (!Number.isFinite(d.min) || !Number.isFinite(d.max) || d.min>=d.max || !Number.isFinite(d.max-d.min) || typeof d.enabled !== 'boolean') return fail('VALIDATION','每个维度的最小值必须小于最大值，并且是有限数值。');
      ids.add(d.id); names.add(dimensionName);
      return {id:d.id,name:dimensionName,min:d.min,max:d.max,unit:text(d.unit,'单位',15).trim(),enabled:d.enabled};
    });
    if (!dimensions.some(d=>d.enabled)) return fail('VALIDATION','请至少启用一个维度。');
    return this.transaction(()=>{
      const templates=this.attributeTemplates();
      const previous=input.id ? templates.find(t=>t.id===input.id) : undefined;
      if (input.id && !previous) fail('NOT_FOUND','属性模板不存在。');
      if (previous && previous.worldId!==input.worldId) fail('VALIDATION','不能迁移属性模板所属世界。');
      if ((previous?.version ?? 0)!==input.expectedVersion) fail('CONFLICT','属性模板已有新修改，请重新打开后编辑。');
      if (templates.some(t=>t.worldId===input.worldId && t.id!==input.id && t.name===name)) fail('VALIDATION','这个模板名称已经存在。');
      if (previous?.dimensions.some(d=>!ids.has(d.id))) fail('VALIDATION','已有维度请使用停用，保留角色数值以便恢复。');
      const id=previous?.id ?? randomUUID();
      const setting=this.db.prepare('SELECT template_id AS templateId,version FROM attribute_defaults WHERE world_id=?').get(input.worldId) as Row | undefined;
      const oldDefault=setting?.templateId ?? null, nextDefault=input.makeDefault ? id : oldDefault===id ? null : oldDefault;
      if (nextDefault!==oldDefault && (setting?.version ?? 0)!==input.expectedDefaultVersion) fail('CONFLICT','默认模板已有修改，请重新打开模板配置。');
      const changed=!previous || previous.name!==name || JSON.stringify(previous.dimensions)!==JSON.stringify(dimensions);
      const template:AttributeTemplate={id,worldId:input.worldId,name,dimensions,version:(previous?.version ?? 0)+(changed ? 1 : 0)};
      if (!previous) this.db.prepare('INSERT INTO attribute_templates(id,world_id,name,version,dimensions_json) VALUES(?,?,?,?,?)').run(id,input.worldId,name,template.version,JSON.stringify(dimensions));
      else if (changed) this.db.prepare('UPDATE attribute_templates SET name=?,version=?,dimensions_json=? WHERE id=?').run(name,template.version,JSON.stringify(dimensions),id);
      if (nextDefault!==oldDefault) this.db.prepare('INSERT INTO attribute_defaults(world_id,template_id,version) VALUES(?,?,1) ON CONFLICT(world_id) DO UPDATE SET template_id=excluded.template_id,version=version+1').run(input.worldId,nextDefault);
      if(previous&&changed)this.catalogs.touchReferences('template',id);
      if (previous && changed) {
        const rows=this.db.prepare('SELECT id,attributes_json,variants_json FROM characters WHERE world_id=?').all(input.worldId) as Row[];
        for (const row of rows) {
          const attributes=JSON.parse(String(row.attributes_json)) as CharacterAttributes;
          const forms=(JSON.parse(String(row.variants_json)) as {forms:CharacterForm[]}).forms;
          if (attributes.templateId!==id && !Object.hasOwn(attributes.values,id) && !forms.some(f=>f.attributes.templateId===id || Object.hasOwn(f.attributes.values,id))) continue;
          this.db.prepare('UPDATE characters SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),row.id);
          this.recordRevision(this.getCharacter(String(row.id)),'更新属性模板');
        }
      }
      return template;
    });
  }
  getTheme(): ThemeId {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='ui-theme'").get() as Row | undefined;
    return isTheme(row?.value) ? row.value : 'ink';
  }
  setTheme(theme: unknown): ThemeId {
    if (!isTheme(theme)) return fail('VALIDATION','请选择已有主题。');
    this.db.prepare("INSERT INTO meta(key,value) VALUES('ui-theme',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(theme);
    return theme;
  }
  private getTag(id: string): Tag {
    const tag = this.db.prepare('SELECT id,world_id AS worldId,name,color,version FROM tags WHERE id=?').get(id) as Tag | undefined;
    return tag ?? fail('NOT_FOUND','这个标签已不存在，请刷新标签库。');
  }
  saveTag(raw: unknown): Tag {
    if (!raw || typeof raw !== 'object') return fail('VALIDATION','标签格式不正确。');
    const input = raw as TagInput;
    this.worldExists(input.worldId);
    const name = text(input.name,'标签名称',60).trim();
    if (!name || typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || (input.id !== undefined && !isId(input.id))) return fail('VALIDATION','请填写标签名称和有效颜色。');
    return this.transaction(() => {
      const previous = input.id ? this.getTag(input.id) : undefined;
      if (previous && previous.worldId !== input.worldId) fail('VALIDATION','不能迁移标签所属世界。');
      if ((previous?.version ?? 0) !== input.expectedVersion) fail('CONFLICT','这个标签已有新修改，请重新打开后编辑。');
      const duplicate = this.db.prepare('SELECT id FROM tags WHERE world_id=? AND name=?').get(input.worldId,name) as Row | undefined;
      if (duplicate && duplicate.id !== input.id) fail('VALIDATION','这个名称的标签已经存在。');
      const id = previous?.id ?? randomUUID(), color = input.color.toLowerCase();
      if (previous?.name === name && previous.color === color) return previous;
      if (previous) {
        this.db.prepare('UPDATE tags SET name=?,color=?,version=version+1 WHERE id=?').run(name,color,id);
        this.touchTaggedCharacters(id,'更新人物标签');this.catalogs.touchReferences('tag',id);
      } else this.db.prepare('INSERT INTO tags(id,world_id,name,color) VALUES(?,?,?,?)').run(id,input.worldId,name,color);
      return this.getTag(id);
    });
  }
  private touchTaggedCharacters(tagId: string, action: string, remove = false) {
    const rows = this.db.prepare('SELECT character_id FROM character_tags WHERE tag_id=?').all(tagId) as Row[];
    if (remove) this.db.prepare('DELETE FROM character_tags WHERE tag_id=?').run(tagId);
    for (const row of rows) {
      const id = String(row.character_id);
      this.db.prepare('UPDATE characters SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
      this.recordRevision(this.getCharacter(id),action);
    }
  }
  deleteTag(id: string, expectedVersion: number): void {
    if (!isId(id) || !Number.isSafeInteger(expectedVersion)) fail('VALIDATION','标签参数不正确。');
    this.transaction(() => {
      const tag = this.getTag(id);
      if (tag.version !== expectedVersion) fail('CONFLICT','这个标签已有新修改，请刷新后重试。');
      this.touchTaggedCharacters(id,'移除人物标签',true);this.catalogs.touchReferences('tag',id,true);
      this.db.prepare('DELETE FROM tags WHERE id=?').run(id);
    });
  }
  getCharacter(id: string): Character {
    const row = this.db.prepare('SELECT * FROM characters WHERE id=?').get(id) as Row | undefined;
    if (!row) return fail('NOT_FOUND', '人物档案不存在。');
    return this.characterFromRow(row);
  }
  private characterFromRow(row: Row): Character {
    const tags = this.db.prepare('SELECT t.id,t.world_id AS worldId,t.name,t.color,t.version FROM character_tags c JOIN tags t ON t.id=c.tag_id WHERE c.character_id=? ORDER BY t.rowid').all(row.id) as Tag[];
    const templates=this.attributeTemplates(String(row.world_id));
    const variants=JSON.parse(String(row.variants_json)) as {identities:CharacterIdentity[];forms:CharacterForm[];defaultFormId:string};
    const stages=this.db.prepare('SELECT stage_json FROM character_stages WHERE character_id=? ORDER BY position,rowid').all(row.id).map(r=>JSON.parse(String((r as Row).stage_json)) as CharacterStage);
    const images=this.db.prepare('SELECT design_image_id FROM character_images WHERE character_id=?').get(row.id) as Row|undefined;
    return { designImageId:images?.design_image_id?String(images.design_image_id):null,id: String(row.id), worldId: String(row.world_id), name: String(row.name), caption: String(row.caption),
      status: String(row.status), quote: String(row.quote), intro: String(row.intro), body: String(row.body), pending: String(row.pending),
      facts: JSON.parse(String(row.facts_json)), tags, portraitId: row.portrait_id ? String(row.portrait_id) : null, portraitWidth:Number(row.portrait_width),
      archived: Boolean(row.archived), version: Number(row.version), updatedAt: String(row.updated_at),
      attributes:attributesForRead(JSON.parse(String(row.attributes_json)),templates),abilities:String(row.abilities),identities:variants.identities,forms:variants.forms.map(f=>({...f,attributes:attributesForRead(f.attributes,templates)})),defaultFormId:variants.defaultFormId,stages };
  }
  getAsset(id: string): Asset | undefined {
    if (!isId(id)) return;
    return this.db.prepare('SELECT id,world_id AS worldId,file_name AS fileName,mime,source_name AS sourceName FROM assets WHERE id=?').get(id) as Asset | undefined;
  }
  importImage(worldId: string, bytes: Buffer, sourceName: string, dimensions?:{width:number;height:number}): Asset {
    this.worldExists(worldId);
    if (bytes.length > 25 * 1024 * 1024) return fail('VALIDATION', '图片不能超过 25 MB。');
    let ext: string;
    if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext = 'png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = 'jpg';
    else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') ext = 'webp';
    else return fail('VALIDATION', '请选择 PNG、JPEG 或 WebP 图片。');
    const fileName = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    return this.transaction(()=>{
    const existing = this.db.prepare('SELECT id FROM assets WHERE world_id=? AND file_name=?').get(worldId,fileName) as Row | undefined;
    if (existing) {const asset=this.getAsset(String(existing.id))!;if(dimensions)this.gallery.recordImport(asset.id,dimensions.width,dimensions.height,bytes.length);return asset;}
    const destination = join(this.mediaDir,fileName);
    if (!existsSync(destination)) writeFileSync(destination,bytes,{ flag: 'wx' });
    const asset: Asset = { id: randomUUID(), worldId, fileName, mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, sourceName };
    this.db.prepare('INSERT INTO assets(id,world_id,file_name,mime,source_name) VALUES(?,?,?,?,?)').run(asset.id,worldId,fileName,asset.mime,sourceName);
    if(dimensions)this.gallery.recordImport(asset.id,dimensions.width,dimensions.height,bytes.length);
    return asset;
    });
  }
  saveCharacter(raw: unknown): Character {
    if (!raw || typeof raw !== 'object') return fail('VALIDATION', '人物资料格式不正确。');
    const input = raw as CharacterInput;
    this.worldExists(input.worldId);
    if (input.id !== undefined && !isId(input.id)) fail('VALIDATION', '人物编号不正确。');
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail('VALIDATION', '资料版本不正确。');
    const name = text(input.name,'姓名',200).trim();
    if (!name) fail('VALIDATION', '请填写人物姓名。');
    const caption = text(input.caption,'称号',300), status = text(input.status,'状态',100);
    const quote = text(input.quote,'题记',1000), intro = text(input.intro,'简介',10000);
    const body = text(input.body,'详细档案',500000), pending = text(input.pending,'待定内容',20000);
    if (!Array.isArray(input.facts) || input.facts.length > 60) fail('VALIDATION', '自定义字段最多 60 项。');
    const factIds = new Set<string>();
    const facts: Fact[] = input.facts.map(fact => {
      if (!fact || !isId(fact.id) || factIds.has(fact.id)) return fail('VALIDATION', '字段编号无效或重复。');
      factIds.add(fact.id);
      const label = text(fact.label,'字段名称',100).trim();
      if (!label) fail('VALIDATION','请填写自定义字段名称。');
      return { id: fact.id, label, value: text(fact.value,'字段内容',10000) };
    });
    if (!Array.isArray(input.tagIds) || input.tagIds.length > 40 || input.tagIds.some(id => !isId(id))) fail('VALIDATION', '请从标签库选择标签，最多 40 个。');
    const tagIds = [...new Set(input.tagIds)];
    const portraitWidth = input.portraitWidth ?? 100;
    if (!Number.isFinite(portraitWidth) || portraitWidth < 15 || portraitWidth > 100) fail('VALIDATION','图片取景范围不正确。');
    if (input.portraitId !== null) {
      const asset = this.getAsset(input.portraitId);
      if (!asset || asset.worldId !== input.worldId) fail('VALIDATION','人物立绘不属于当前世界。');
    }
    return this.transaction(() => {
      const previous = input.id ? this.getCharacter(input.id) : undefined;
      if (previous && previous.worldId !== input.worldId) fail('VALIDATION','不能通过编辑档案迁移所属世界。');
      if ((previous?.version ?? 0) !== input.expectedVersion) fail('CONFLICT','这份档案已有新修改。你的输入已保留，请重新打开最新档案后合并。');
      if (previous?.archived) fail('VALIDATION','请先恢复人物，再编辑档案。');
      const designImageId=input.designImageId===undefined?previous?.designImageId??null:input.designImageId;
      if(designImageId!==null&&this.getAsset(designImageId)?.worldId!==input.worldId)fail('VALIDATION','设定图不属于当前世界。');
      const abilities=input.abilities===undefined ? previous?.abilities ?? '' : text(input.abilities,'基础能力',50000);
      const templates=this.attributeTemplates(input.worldId);
      let requested=input.attributes;
      if (requested === undefined) {
        requested=previous?.attributes ?? emptyAttributes();
        if (!previous) {
          const setting=this.db.prepare('SELECT template_id FROM attribute_defaults WHERE world_id=?').get(input.worldId) as Row | undefined;
          if (setting?.template_id) requested=attributesForRead({...requested,templateId:String(setting.template_id)},templates);
        }
      }
      const attributes=validateAttributes(requested,previous?.attributes ?? emptyAttributes(),templates,message=>fail('VALIDATION',message));
      for (const tagId of tagIds) {
        const tag = this.getTag(tagId);
        if (tag.worldId !== input.worldId) fail('VALIDATION','请选择当前世界标签库中的标签。');
      }
      const id = previous?.id ?? randomUUID(), version = (previous?.version ?? 0) + 1, now = new Date().toISOString();
      if (previous) this.db.prepare(`UPDATE characters SET name=?,caption=?,status=?,quote=?,intro=?,body=?,pending=?,facts_json=?,portrait_id=?,version=?,updated_at=? WHERE id=?`).run(name,caption,status,quote,intro,body,pending,JSON.stringify(facts),input.portraitId,version,now,id);
      else this.db.prepare(`INSERT INTO characters(id,world_id,name,caption,status,quote,intro,body,pending,facts_json,portrait_id,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,input.worldId,name,caption,status,quote,intro,body,pending,JSON.stringify(facts),input.portraitId,version,now);
      if(designImageId!==null||previous?.designImageId)this.db.prepare('INSERT INTO character_images(character_id,design_image_id) VALUES(?,?) ON CONFLICT(character_id) DO UPDATE SET design_image_id=excluded.design_image_id').run(id,designImageId);
      this.db.prepare('UPDATE characters SET portrait_width=? WHERE id=?').run(portraitWidth,id);
      this.db.prepare('UPDATE characters SET attributes_json=? WHERE id=?').run(JSON.stringify(attributes),id);
      this.db.prepare('UPDATE characters SET abilities=? WHERE id=?').run(abilities,id);
      this.db.prepare('DELETE FROM character_tags WHERE character_id=?').run(id);
      for (const tagId of tagIds) {
        this.db.prepare('INSERT INTO character_tags(character_id,tag_id) VALUES(?,?)').run(id,tagId);
      }
      const character = this.getCharacter(id);
      this.recordRevision(character,previous ? '编辑档案' : '新建人物');
      return character;
    });
  }
  private recordRevision(character: Character, action: string) {
    const attributeSchemas=this.attributeTemplates(character.worldId).filter(t=>t.id===character.attributes.templateId || Object.hasOwn(character.attributes.values,t.id) || character.forms.some(f=>f.attributes.templateId===t.id || Object.hasOwn(f.attributes.values,t.id)));
    this.db.prepare('INSERT INTO revisions(character_id,version,action,snapshot_json,created_at) VALUES(?,?,?,?,?)').run(character.id,character.version,action,JSON.stringify({...character,attributeSchemas}),character.updatedAt);
  }
  /** Called only with a server-loaded immutable revision, never with a client snapshot. */
  restoreCharacterSnapshot(saved:Character):Character {
    return this.transaction(()=>{
      const current=this.getCharacter(saved.id),templates=this.attributeTemplates(current.worldId);
      const attributes=saved.attributes?attributesForRead(saved.attributes,templates):current.attributes;
      const base=this.saveCharacter({...current,...saved,designImageId:saved.designImageId??null,worldId:current.worldId,expectedVersion:current.version,tagIds:saved.tags.map(t=>t.id),attributes});
      const identities=saved.identities??current.identities,forms=saved.forms??current.forms;
      const variants=validateVariants({characterId:current.id,expectedVersion:base.version,
        identities:[...identities,...current.identities.filter(i=>!identities.some(old=>old.id===i.id)).map(i=>({...i,active:false}))],
        forms:[...forms.map(f=>({...f,attributes:attributesForRead(f.attributes,templates)})),...current.forms.filter(f=>!forms.some(old=>old.id===f.id)).map(f=>({...f,active:false}))],
        defaultFormId:saved.defaultFormId??current.defaultFormId},base,templates,id=>this.getAsset(id)?.worldId===current.worldId,message=>fail('VALIDATION',message));
      this.db.prepare('UPDATE characters SET variants_json=? WHERE id=?').run(JSON.stringify(variants),current.id);
      const stages=saved.stages??current.stages,next=this.getCharacter(current.id);
      const restored=stages.map(s=>{
        if(!current.stages.some(old=>old.id===s.id))return fail('VALIDATION','旧版本的阶段已不属于当前人物，无法回退。');
        for(const imageId of [s.snapshot.profile.designImageId,s.snapshot.profile.portraitId,...s.snapshot.forms.map(f=>f.portraitId)])if(imageId&&this.getAsset(imageId)?.worldId!==current.worldId)return fail('VALIDATION','旧阶段引用的图片已失效，无法回退。');
        return buildStage({id:s.id,characterId:current.id,expectedVersion:next.version,name:s.name,period:s.period,summary:s.summary,archived:s.archived,identityIds:s.snapshot.identities.map(i=>i.id),formIds:s.snapshot.forms.map(f=>f.id),defaultFormId:s.snapshot.defaultFormId,attributeValues:{}},next,s,templates,s.id,message=>fail('VALIDATION',message));
      });
      restored.push(...current.stages.filter(s=>!stages.some(old=>old.id===s.id)).map(s=>({...s,archived:true})));
      if(new Set(restored.map(s=>s.name)).size!==restored.length)return fail('VALIDATION','旧阶段与后来新增的阶段重名，请先调整名称后回退。');
      restored.forEach((s,index)=>this.db.prepare('UPDATE character_stages SET position=?,stage_json=? WHERE id=? AND character_id=?').run(index,JSON.stringify(s),s.id,current.id));
      const result=this.getCharacter(current.id);
      const attributeSchemas=templates.filter(t=>t.id===result.attributes.templateId||Object.hasOwn(result.attributes.values,t.id)||result.forms.some(f=>f.attributes.templateId===t.id||Object.hasOwn(f.attributes.values,t.id)));
      // Complete only the revision created in this transaction; all previous rows stay intact.
      this.db.prepare('UPDATE revisions SET snapshot_json=? WHERE character_id=? AND version=?').run(JSON.stringify({...result,attributeSchemas}),result.id,result.version);
      return result;
    });
  }
  archiveCharacter(id: string, expectedVersion: number, archived: boolean): Character {
    if (!isId(id) || !Number.isSafeInteger(expectedVersion) || typeof archived !== 'boolean') return fail('VALIDATION','归档参数不正确。');
    return this.transaction(() => {
      const current = this.getCharacter(id);
      if (current.version !== expectedVersion) fail('CONFLICT','档案已有新修改，请刷新后重试。');
      if (current.archived === archived) return current;
      this.db.prepare('UPDATE characters SET archived=?,version=version+1,updated_at=? WHERE id=?').run(Number(archived),new Date().toISOString(),id);
      const character = this.getCharacter(id);
      this.recordRevision(character,archived ? '归档人物' : '恢复人物');
      return character;
    });
  }
  private editableCharacter(id:unknown,expectedVersion:unknown):Character {
    if(!isId(id)||!Number.isSafeInteger(expectedVersion))return fail('VALIDATION','人物编号或版本不正确。');
    const current=this.getCharacter(id);
    if(current.version!==expectedVersion)return fail('CONFLICT','人物档案已有新修改，请重新打开编辑窗口。你的输入仍保留。');
    if(current.archived)return fail('VALIDATION','请先恢复人物，再编辑档案。');
    return current;
  }
  private touchCharacter(id:string,action:string):Character {
    this.db.prepare('UPDATE characters SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
    const current=this.getCharacter(id);this.recordRevision(current,action);return current;
  }
  saveCharacterVariants(raw:unknown):Character {
    if(!raw||typeof raw!=='object')return fail('VALIDATION','人物身份与形态格式不正确。');
    const input=raw as CharacterVariantsInput;
    return this.transaction(()=>{
      const current=this.editableCharacter(input.characterId,input.expectedVersion);
      const variants=validateVariants(input,current,this.attributeTemplates(current.worldId),id=>this.getAsset(id)?.worldId===current.worldId,message=>fail('VALIDATION',message));
      this.db.prepare('UPDATE characters SET variants_json=? WHERE id=?').run(JSON.stringify(variants),current.id);
      return this.touchCharacter(current.id,'编辑人物身份与形态');
    });
  }
  saveCharacterStage(raw:unknown):CharacterStage {
    if(!raw||typeof raw!=='object')return fail('VALIDATION','人物阶段格式不正确。');
    const input=raw as CharacterStageInput;
    return this.transaction(()=>{
      const current=this.editableCharacter(input.characterId,input.expectedVersion);
      if(input.id!==undefined&&!validJourneyId(input.id))return fail('VALIDATION','阶段编号不正确。');
      const previous=input.id ? current.stages.find(s=>s.id===input.id) : undefined;
      if(input.id&&!previous)return fail('NOT_FOUND','该阶段不属于当前人物或不存在。');
      if(!previous&&current.stages.length>=100)return fail('VALIDATION','每个人物最多保存 100 个阶段。');
      const stage=buildStage(input,current,previous,this.attributeTemplates(current.worldId),previous?.id ?? randomUUID(),message=>fail('VALIDATION',message));
      if(current.stages.some(s=>s.id!==stage.id&&s.name===stage.name))return fail('VALIDATION','这个阶段名称已存在。');
      if(previous)this.db.prepare('UPDATE character_stages SET stage_json=? WHERE id=?').run(JSON.stringify(stage),stage.id);
      else this.db.prepare('INSERT INTO character_stages(id,character_id,position,stage_json) VALUES(?,?,?,?)').run(stage.id,current.id,current.stages.length,JSON.stringify(stage));
      this.touchCharacter(current.id,previous ? '修订人物阶段' : '记录人物阶段');
      return stage;
    });
  }
  reorderCharacterStages(id:string,expectedVersion:number,stageIds:string[]):Character {
    return this.transaction(()=>{
      const current=this.editableCharacter(id,expectedVersion);
      if(!Array.isArray(stageIds)||stageIds.length!==current.stages.length||new Set(stageIds).size!==stageIds.length||stageIds.some(id=>!current.stages.some(s=>s.id===id)))return fail('VALIDATION','阶段顺序不完整，请刷新后重试。');
      stageIds.forEach((stageId,index)=>this.db.prepare('UPDATE character_stages SET position=? WHERE id=? AND character_id=?').run(index,stageId,id));
      return this.touchCharacter(id,'调整人物阶段顺序');
    });
  }
  seed(directory: string) {
    if (this.db.prepare("SELECT value FROM meta WHERE key='seed-v1'").get()) return;
    this.transaction(() => {
    const original = JSON.parse(readFileSync(join(directory,'characters.json'),'utf8')) as Array<Record<string,unknown>>;
    // Seeding runs only for a new library. Source records are retained for later module imports.
    this.db.prepare('INSERT OR IGNORE INTO worlds(id,name) VALUES(?,?)').run('world-moying','墨影仙姬 · 世界资料');
    this.db.prepare('INSERT OR IGNORE INTO works(id,world_id,name) VALUES(?,?,?)').run('work-moying','world-moying','墨影仙姬');
    for (const source of original) {
      const sourceKey = `seed-character-${source.id}`;
      if (this.db.prepare('SELECT value FROM meta WHERE key=?').get(sourceKey)) continue;
      const imageName = source.id === 'gu' ? 'gu.png' : 'mo.png';
      const asset = this.importImage('world-moying',readFileSync(join(directory,imageName)),imageName);
      const tagIds = (source.tags as string[]).map(name => {
        const existing = this.db.prepare('SELECT id FROM tags WHERE world_id=? AND name=?').get('world-moying',name) as Row | undefined;
        return existing ? String(existing.id) : this.saveTag({worldId:'world-moying',name,color:'#bda374',expectedVersion:0}).id;
      });
      const character = this.saveCharacter({ worldId:'world-moying',expectedVersion:0,name:source.name,caption:source.caption,
        status:source.status,quote:source.quote,intro:source.intro,body:source.body,pending:source.pending,
        facts:(source.facts as string[][]).map(([label,value]) => ({ id:randomUUID(),label,value })),
        tagIds,portraitId:asset.id,portraitWidth:source.id === 'gu' ? 32.5 : 29.5 });
      this.db.prepare('UPDATE characters SET source_json=? WHERE id=?').run(JSON.stringify(source),character.id);
      this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(sourceKey,character.id);
    }
    this.db.prepare("INSERT INTO meta(key,value) VALUES('seed-v1','1')").run();
    });
  }
}
