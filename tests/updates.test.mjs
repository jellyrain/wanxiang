import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {UpdatePreferences,normalizeUpdateSettings} from '../electron/update-settings.ts';
import {UpdateCoordinator} from '../electron/updater.ts';
import {createPortableDriver,portableManifest,newerVersion} from '../electron/portable-update.ts';
import {writeReleaseMetadata} from '../scripts/release-metadata.mjs';
const root=resolve('test-results/update-tests');mkdirSync(root,{recursive:true});
const dir=()=>mkdtempSync(join(root,'case-'));
const sha=bytes=>createHash('sha512').update(bytes).digest('hex');

test('更新源只接受 HTTPS 或本机测试地址，空地址禁用检查，坏配置不覆盖',()=>{
  assert.deepEqual(normalizeUpdateSettings({url:'',checkOnStartup:true}),{url:'',checkOnStartup:false});
  assert.equal(normalizeUpdateSettings({url:' https://example.com/updates ',checkOnStartup:true}).url,'https://example.com/updates/');
  for(const url of ['http://example.com','file:///x','https://name:secret@example.com','https://example.com/latest.yml','https://example.com/?token=x'])assert.throws(()=>normalizeUpdateSettings({url,checkOnStartup:true}));
  const path=join(dir(),'settings.json');writeFileSync(path,'broken');const p=new UpdatePreferences(path);assert.ok(p.error);assert.equal(readFileSync(path,'utf8'),'broken');
  p.save({url:'http://127.0.0.1:12345',checkOnStartup:true});assert.deepEqual(new UpdatePreferences(path).value,p.value);
});
function coordinator({edition='installed',protect,driver:overrides={}}={}){
  const events=[],preferences=new UpdatePreferences(join(dir(),'settings.json'));
  const driver={check:async()=>{events.push('check');return {version:'0.2.0',notes:'新功能'};},download:async progress=>{events.push('download');progress(70);},install:async()=>{events.push('install');},...overrides};
  const update=new UpdateCoordinator({version:'0.1.0',edition,preferences,driver,protect:protect??(async()=>{events.push('protect');return {id:'point'};}),requestQuit:()=>events.push('quit-check')});
  update.save({url:'https://example.com/updates/',checkOnStartup:true});return {update,events};
}
test('两种版本在完成下载、检查编辑和保护数据后才执行更新，取消保留下载',async()=>{
  for(const edition of ['installed','portable']){
    const {update,events}=coordinator({edition});await update.check();assert.equal(update.status().phase,'available');await update.download();update.requestInstall();
    assert.deepEqual(events,['check','download','quit-check']);update.cancelInstall();assert.equal(update.status().phase,'downloaded');
    update.requestInstall();await update.prepare();await update.finish();assert.deepEqual(events.slice(-3),['quit-check','protect','install']);
  }
});
test('备份失败、安装失败、下载失败都可恢复操作，不擅自退出',async()=>{
  const f=coordinator({protect:async()=>{throw Error('磁盘已满');}});await f.update.check();await f.update.download();f.update.requestInstall();await assert.rejects(f.update.prepare(),/磁盘/);
  assert.equal(f.update.installRequested,false);assert.ok(!f.events.includes('install'));assert.equal(f.update.status().phase,'error');
  const d=coordinator({driver:{download:async()=>{throw Error('断网');}}});await d.update.check();await d.update.download();assert.equal(d.update.status().phase,'error');assert.throws(()=>d.update.requestInstall());
  const i=coordinator({driver:{install:async()=>{throw Error('拒绝访问');}}});await i.update.check();await i.update.download();i.update.requestInstall();await i.update.prepare();await assert.rejects(i.update.finish(),/拒绝/);assert.equal(i.update.installRequested,false);
});
test('正在检查时禁止重入和修改来源，开发版不联网',async()=>{
  let done;const f=coordinator({driver:{check:()=>new Promise(r=>done=r)}}),pending=f.update.check();
  await assert.rejects(f.update.check(),/进行/);assert.throws(()=>f.update.save({url:'',checkOnStartup:false}),/进行/);done(null);await pending;assert.equal(f.update.status().phase,'idle');
  const dev=coordinator({edition:'development'});await assert.rejects(dev.update.check(),/开发版/);assert.equal(dev.events.length,0);
});

test('免安装清单限制路径和文件类型，拒绝降级且按数字比较版本',()=>{
  assert.equal(newerVersion('0.10.0','0.9.9'),true);assert.equal(newerVersion('0.1.0','0.1.0'),false);assert.equal(newerVersion('0.1.0','0.2.0'),false);
  assert.throws(()=>newerVersion('v1.0','0.1.0'));
  for(const file of ['../app.exe','https://example.com/x.exe','WanxiangWorkshop-0.2.0-win-x64-Setup.exe'])assert.throws(()=>portableManifest({format:2,kind:'folder-zip',root:'WanxiangWorkshop',version:'0.2.0',file,bytes:10,sha512:'a'.repeat(128)}));
});
test('本机更新源：双版本发布清单、免安装流式下载校验、损坏及旧版拒绝',async t=>{
  const directory=dir(),setup=join(directory,'WanxiangWorkshop-0.2.0-win-x64-Setup.exe'),portable=join(directory,'WanxiangWorkshop-0.2.0-win-x64-Portable.zip');
  writeFileSync(setup,'setup fixture');const bytes=Buffer.from('portable executable fixture');writeFileSync(portable,bytes);
  await writeReleaseMetadata(directory,'0.2.0',[setup,portable],'测试更新');const manifest=JSON.parse(readFileSync(join(directory,'latest-portable.json'),'utf8'));
  assert.equal(manifest.sha512,sha(bytes));assert.ok(readFileSync(join(directory,'SHA256SUMS.txt'),'utf8').includes('Setup.exe'));
  let damaged=false;const server=createServer((req,res)=>{res.end(req.url==='/latest-portable.json'?JSON.stringify(manifest):damaged?Buffer.from('corrupt'):bytes);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const url=`http://127.0.0.1:${server.address().port}/`;
  const options={version:'0.1.0',executable:portable,cache:join(directory,'cache'),helper:'unused',quit:()=>assert.fail('must not quit')};
  const driver=createPortableDriver(options);assert.deepEqual(await driver.check(url),{version:'0.2.0',notes:'测试更新'});let progress=0;await driver.download(n=>progress=n);assert.equal(progress,100);
  damaged=true;await driver.check(url);await assert.rejects(driver.download(()=>{}),/校验/);
  assert.equal(await createPortableDriver({...options,version:'0.3.0'}).check(url),null);
});
