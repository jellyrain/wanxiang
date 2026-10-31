// Isolated Electron integration test. No installer is executed and no user profile is opened.
import {app} from 'electron';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createNsisDriver} from '../dist-desktop/electron/nsis-update.js';

const base=resolve(import.meta.dirname,'../test-results/update-tests');mkdirSync(base,{recursive:true});
const directory=mkdtempSync(join(base,'electron-'));
app.setPath('userData',directory);
process.env.LOCALAPPDATA=directory;
// Exercise the release updater using the installed Electron runtime and fake release bytes.
Object.defineProperty(app,'isPackaged',{value:true});app.getVersion=()=> '0.1.0';
let server;
app.whenReady().then(async()=>{try{
  Object.defineProperty(process,'resourcesPath',{value:directory});
  const bytes=Buffer.from('inert NSIS download fixture — never executed'),sha512=createHash('sha512').update(bytes).digest('base64');
  let corrupt=false;
  server=createServer((req,res)=>{
    if(req.url.split('?')[0]==='/latest.yml')res.end(`version: 0.2.0\nfiles:\n  - url: fixture-Setup.exe\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: fixture-Setup.exe\nsha512: ${sha512}\nreleaseNotes: test update\n`);
    else if(req.url.includes('blockmap')){res.statusCode=404;res.end();}
    else res.end(corrupt?Buffer.from('corrupted bytes'):bytes);
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${server.address().port}/`;
  const config=join(directory,'app-update.yml');
  writeFileSync(config,'provider: generic\nurl: '+url+'\nupdaterCacheDirName: valid-update\n');
  const driver=createNsisDriver();assert.deepEqual(await driver.check(url),{version:'0.2.0',notes:'test update'});
  await driver.download(()=>{});
  assert.ok(existsSync(join(directory,'update-cache/valid-update/pending/fixture-Setup.exe')),'NSIS download must stay inside the application data directory');
  // A separate cache ensures a valid previous download cannot mask corruption.
  writeFileSync(config,'provider: generic\nurl: '+url+'\nupdaterCacheDirName: corrupt-update\n');
  const broken=createNsisDriver();corrupt=true;await broken.check(url);
  await assert.rejects(broken.download(()=>{}),/checksum|sha512/i);
  writeFileSync(join(directory,'report.json'),JSON.stringify({nsisCheck:true,nsisDownload:true,corruptDownloadRejected:true,installerExecuted:false}));
  console.log('NSIS real Electron provider: check, verified download and corrupt download rejection passed; no installer executed.');
  app.exit(0);
}catch(error){console.error(error);app.exit(1);}finally{server?.close();}});
