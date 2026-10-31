import { createHash, randomUUID } from 'node:crypto';
import type { Database } from './store.ts';

export type BackupRow = Record<string,string|number|null>;
export interface TableShape { name:string; columns:string[]; sql:string }
export interface RowChange { table:string; rowid:number; row:BackupRow|null }
export const quote = (name:string) => '"'+name.replaceAll('"','""')+'"';
export const digest = (bytes:string|Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Triggers and their journal share the caller's SQLite transaction, including rollbacks. */
export class BackupJournal {
  readonly db:Database;
  readonly tables:TableShape[];
  readonly schema:string;
  readonly schemaSql:string;
  constructor(db:Database) {
    this.db=db;
    db.exec(`PRAGMA recursive_triggers=ON;
      CREATE TABLE IF NOT EXISTS _backup_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _backup_journal(seq INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,row_id INTEGER NOT NULL,row_json TEXT);
    `);
    for(const [key,value] of Object.entries({libraryId:randomUUID(),generation:randomUUID(),recording:'1',requireGeneration:'0'}))
      db.prepare('INSERT OR IGNORE INTO _backup_meta VALUES(?,?)').run(key,value);
    const definitions=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index') AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_backup_*' ORDER BY type DESC,name").all() as {name:string;type:string;sql:string}[];
    this.tables=definitions.filter(x=>x.type==='table').map(x=>({name:x.name,sql:x.sql,columns:(db.prepare(`PRAGMA table_info(${quote(x.name)})`).all() as {name:string}[]).map(c=>c.name)}));
    this.schema=digest(JSON.stringify(definitions));
    this.schemaSql=definitions.map(d=>d.sql+';').join('\n');
    // Rebuild the small set of triggers so newly added columns also enter future increments.
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const table of this.tables) {
        const json=(alias:string)=>'json_object('+table.columns.flatMap(c=>["'"+c.replaceAll("'","''")+"'",`${alias}.${quote(c)}`]).join(',')+')';
        const name="'"+table.name.replaceAll("'","''")+"'";
        for(const operation of ['insert','update','delete']) {
          const trigger=quote('_backup_'+table.name+'_'+operation);
          const value=operation==='delete'?'NULL':json('NEW');
          const rowid=operation==='delete'?'OLD.rowid':'NEW.rowid';
          const changed=operation==='update'?` AND (OLD.rowid IS NOT NEW.rowid OR ${json('OLD')} IS NOT ${json('NEW')})`:'';
          db.exec(`DROP TRIGGER IF EXISTS ${trigger}; CREATE TRIGGER ${trigger} AFTER ${operation} ON ${quote(table.name)}
            WHEN (SELECT value FROM _backup_meta WHERE key='recording')='1'${changed} BEGIN
            ${operation==='update'?`INSERT INTO _backup_journal(table_name,row_id,row_json) SELECT ${name},OLD.rowid,NULL WHERE OLD.rowid IS NOT NEW.rowid;`:''}
            INSERT INTO _backup_journal(table_name,row_id,row_json) VALUES(${name},${rowid},${value}); END;`);
        }
      }
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  get(key:string):string|null {return (this.db.prepare('SELECT value FROM _backup_meta WHERE key=?').get(key) as {value:string}|undefined)?.value??null;}
  set(key:string,value:string) {this.db.prepare('INSERT INTO _backup_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  sequence():number {return Number((this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='_backup_journal'").get() as {seq:number}|undefined)?.seq??0);}
  changes(after:number,through:number):RowChange[] {
    return (this.db.prepare('SELECT table_name,row_id,row_json FROM _backup_journal WHERE seq>? AND seq<=? ORDER BY seq').all(after,through) as {table_name:string;row_id:number;row_json:string|null}[]).map(r=>({table:r.table_name,rowid:r.row_id,row:r.row_json===null?null:JSON.parse(r.row_json)}));
  }
  allRows(db:Database=this.db):RowChange[] {
    return this.tables.flatMap(t=>(db.prepare(`SELECT rowid AS __backup_rowid__,* FROM ${quote(t.name)} ORDER BY rowid`).all() as (BackupRow & {__backup_rowid__:number})[]).map(({__backup_rowid__,...row})=>({table:t.name,rowid:__backup_rowid__,row})));
  }
  read<T>(operation:()=>T):T {this.db.exec('BEGIN');try{const result=operation();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
