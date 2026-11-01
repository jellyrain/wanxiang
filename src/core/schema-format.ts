import {createHash} from 'node:crypto';
import type {Database} from './store.ts';
import {quote} from './backup-journal.ts';

/** Column creation order and SQL whitespace do not change a library's format. */
export function schemaShape(db:Database){
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_backup_*' ORDER BY name").all() as {name:string}[];
  return tables.map(({name})=>({name,
    columns:(db.prepare(`PRAGMA table_info(${quote(name)})`).all() as Record<string,unknown>[]).map(({cid,...column})=>column).sort((a,b)=>String(a.name).localeCompare(String(b.name),'en')),
    foreignKeys:(db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all() as Record<string,unknown>[]).map(({id,...key})=>key).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en')),
    indexes:(db.prepare(`PRAGMA index_list(${quote(name)})`).all() as {name:string;unique:number;origin:string;partial:number}[]).map(i=>({name:i.name,unique:i.unique,origin:i.origin,partial:i.partial,
      columns:(db.prepare(`PRAGMA index_info(${quote(i.name)})`).all() as Record<string,unknown>[]).map(({cid,...column})=>column)
    })).sort((a,b)=>a.name.localeCompare(b.name,'en'))
  }));
}
export const schemaFingerprint=(db:Database)=>createHash('sha256').update(JSON.stringify(schemaShape(db))).digest('hex');

// Version-1 export files used the literal sqlite_master SQL as their fingerprint.
// These are the two released/development layouts: their column order differs only.
export const LEGACY_PACKAGE_SCHEMAS=new Set([
  '7881d069dccd02ff9bff018be7a024971f5d3bb6336ec4ec5a363aba5d7fc12a',
  'f417631c1be19013b9d05d1f889a861e99deaa300b07ff5bb2437f9f78e1389e',
  'f81d1fc7b2785b4b1614fd85b1c9da2f805cd9ed16e7d4f3ec12f831adf78a69',
  '92d64e779c9dda2d93e5993b7f9d524d2c9faa1eabe5219fa26ab72cc2d9304c',
  'b297bf3532c941a08477c0bafad9255ab2d9f59d59177c0a2a1ff38d17bbfdb2',
  'b22a8a48b588307cad7455c117544504eb29d686587672731e88a0f79fd235fc'
]);
