// Copies an existing library using SQLite's online backup API; the source is read-only.
import DB from 'better-sqlite3';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openProtectedLibrary,listProtectionPoints,verifyProtectionPoint} from '../src/core/upgrade-protection.ts';
const source=resolve(process.argv[2]??'.local-data'),root=resolve('test-results/update-tests');mkdirSync(root,{recursive:true});
const target=mkdtempSync(join(root,'existing-library-'));mkdirSync(join(target,'media'));
const digest=data=>createHash('sha256').update(data).digest('hex');
function content(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_backup_*' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]);}
const original=new DB(join(source,'library.sqlite'),{readonly:true,fileMustExist:true});
const before=content(original),beforeHash=digest(JSON.stringify(before));
await original.backup(join(target,'library.sqlite'));
const imageHashes=readdirSync(join(source,'media')).map(name=>{copyFileSync(join(source,'media',name),join(target,'media',name));return [name,digest(readFileSync(join(source,'media',name)))];});
const upgraded=await openProtectedLibrary(target,'0.2.0');
try{assert.deepEqual(content(upgraded.db),before);upgraded.store.snapshot();}finally{upgraded.store.close();}
for(const [name,hash] of imageHashes)assert.equal(digest(readFileSync(join(target,'media',name))),hash);
for(const point of listProtectionPoints(target))await verifyProtectionPoint(target,point.id);
assert.equal(digest(JSON.stringify(content(original))),beforeHash);original.close();
const report={sourceReadOnly:true,sourceContentUnchanged:true,tables:before.length,images:imageHashes.length,upgradedCopyMatchesSource:true,protectionVerified:true,copy:target};
writeFileSync('test-results/update-existing-library-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
