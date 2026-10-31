import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runtimeConfig} from '../electron/runtime-config.ts';
import {UpdatePreferences} from '../electron/update-settings.ts';
import {updateCache} from '../electron/update-cache.ts';
import {zipFiles} from '../scripts/zip-files.mjs';
import {collectRelease} from '../scripts/collect-release.mjs';
const require=createRequire(import.meta.url),yaml=createRequire(require.resolve('electron-updater'))('js-yaml');
const fixture=t=>{const path=realpathSync(mkdtempSync(join(tmpdir(),'wanxiang-platform-')));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;};

test('macOS 与 Linux 升级或移动程序不改变资料位置，保留旧资料且忽略开发覆盖变量',t=>{
  const root=fixture(t),appData=join(root,'用户配置');mkdirSync(appData);
  for(const platform of ['darwin','linux']){
    for(const executable of [join(root,'旧程序/app'),join(root,'新程序/app')]){
      const config=runtimeConfig(appData,{WANXIANG_USER_DATA_DIR:join(root,'不应使用'),WANXIANG_DATA_DIR:root,WANXIANG_DEV_URL:'http://localhost:1'},{executable,platform});
      assert.equal(config.userData,join(appData,'wanxiang'));assert.equal(config.directory,join(appData,'wanxiang/library'));assert.equal(config.devUrl,undefined);
      assert.equal(existsSync(config.userData),false);
    }
  }
  const legacy=join(appData,'oc-studio');mkdirSync(legacy);writeFileSync(join(legacy,'proof'),'资料');
  assert.equal(runtimeConfig(appData,{}, {executable:join(root,'app'),platform:'darwin'}).userData,legacy);
  assert.equal(readFileSync(join(legacy,'proof'),'utf8'),'资料');
});

test('GitHub 默认更新源仅用于未配置的用户，用户禁用或自定义后不被覆盖',t=>{
  const path=join(fixture(t),'settings.json'),url='https://github.com/example/workshop/releases/latest/download/';
  const preferences=new UpdatePreferences(path,url);assert.deepEqual(preferences.value,{url,checkOnStartup:false});
  preferences.save({url:'',checkOnStartup:false});assert.equal(new UpdatePreferences(path,url).value.url,'');
  preferences.save({url:'https://updates.example.org/',checkOnStartup:true});assert.equal(new UpdatePreferences(path,url).value.url,'https://updates.example.org/');
  writeFileSync(path,'broken');const broken=new UpdatePreferences(path,url);assert.equal(broken.value.url,'');assert.ok(broken.error);
});

test('无需 PowerShell 的技能 ZIP 可由独立解压器读取 UTF-8 内容，并拒绝越界路径',async t=>{
  const root=fixture(t),bytes=zipFiles([{name:'skill/SKILL.md',bytes:Buffer.from('中文说明\n')},{name:'skill/references/例子.md',bytes:Buffer.from('测试')}]);
  const path=join(root,'skills.zip');writeFileSync(path,bytes);
  const electronRequire=createRequire(require.resolve('electron/package.json'));
  const extract=electronRequire('@electron-internal/extract-zip');
  await (extract.default??extract)(path,{dir:join(root,'unpacked')});
  assert.equal(readFileSync(join(root,'unpacked/skill/SKILL.md'),'utf8'),'中文说明\n');
  assert.equal(readFileSync(join(root,'unpacked/skill/references/例子.md'),'utf8'),'测试');
  assert.throws(()=>zipFiles([{name:'../escape',bytes:Buffer.from('x')}]),/Invalid/);
});

test('Mac 和 Linux 下载缓存可清理，旧程序、其他 ZIP 和资料不被删除',t=>{
  const root=fixture(t),cache=join(root,'cache');
  const disposable=['updater/update.zip','updater/pending/update.zip','updater/pending/WanxiangWorkshop-1.2.3-linux-x64.AppImage'];
  const kept=['updater/previous/old.AppImage','updater/new/new.zip','creative.zip'];
  for(const name of [...disposable,...kept]){const path=join(cache,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'123');}
  assert.deepEqual(updateCache(cache,true),{files:3,bytes:9});
  for(const name of kept)assert.ok(existsSync(join(cache,name)),name);
});

function releaseFixture(t){
  const root=fixture(t),input=join(root,'inputs'),output=join(root,'output'),version='1.2.3',prefix='WanxiangWorkshop-'+version+'-';
  const definitions=[['windows-x64',['win-x64-Setup.exe','win-x64-Portable.zip'],'latest.yml'],['mac-x64',['mac-x64.dmg','mac-x64.zip'],'latest-mac.yml'],['mac-arm64',['mac-arm64.dmg','mac-arm64.zip'],'latest-mac.yml'],['linux-x64',['linux-x86_64.AppImage'],'latest-linux.yml']];
  for(const [target,names,manifest] of definitions){
    const dir=join(input,target);mkdirSync(dir,{recursive:true});const files=[];
    for(const suffix of names){const name=prefix+suffix,bytes=Buffer.from('fixture '+name);writeFileSync(join(dir,name),bytes);files.push({url:name,size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')});}
    const feed={version,files:target==='windows-x64'?files.slice(0,1):files,path:files[0].url,sha512:files[0].sha512};writeFileSync(join(dir,manifest),yaml.dump(feed));
    if(target.startsWith('mac-'))writeFileSync(join(dir,'platform-report.json'),JSON.stringify({version,platform:'mac',arch:target.slice(4),signed:true}));
    if(target==='windows-x64'){const f=files[1];writeFileSync(join(dir,'latest-portable.json'),JSON.stringify({format:2,kind:'folder-zip',root:'WanxiangWorkshop',version,file:f.url,bytes:f.size,sha512:Buffer.from(f.sha512,'base64').toString('hex')}));}
  }
  return {input,output,version,prefix};
}
test('合并三端发布保留两种 Mac 架构、校验全部下载文件并生成总校验表',async t=>{
  const f=releaseFixture(t),result=await collectRelease(f.input,f.output,{version:f.version,requireSigned:true});
  const mac=yaml.load(readFileSync(join(f.output,'latest-mac.yml'),'utf8'));
  assert.deepEqual(mac.files.filter(f=>f.url.endsWith('.zip')).map(f=>f.url).sort(),[f.prefix+'mac-arm64.zip',f.prefix+'mac-x64.zip']);
  assert.equal(result.targets.length,4);assert.ok(result.files.includes('latest-portable.json'));
  for(const line of readFileSync(join(f.output,'SHA256SUMS.txt'),'utf8').trim().split('\n')){
    const [sha,name]=line.split('  ');assert.equal(createHash('sha256').update(readFileSync(join(f.output,name))).digest('hex'),sha);
  }
});
test('预发布允许未公证的 Mac 包，仍校验两种架构和所有文件完整性',async t=>{
  for(const corrupt of [false,true]){
    const f=releaseFixture(t);
    for(const arch of ['x64','arm64'])writeFileSync(join(f.input,'mac-'+arch,'platform-report.json'),JSON.stringify({version:f.version,platform:'mac',arch,signed:false}));
    if(corrupt){
      writeFileSync(join(f.input,'mac-arm64',f.prefix+'mac-arm64.zip'),'tampered');
      await assert.rejects(collectRelease(f.input,f.output,{version:f.version}),/校验不符/);
      assert.equal(existsSync(f.output),false);
    }else{
      const result=await collectRelease(f.input,f.output,{version:f.version});
      assert.equal(result.targets.length,4);
      const mac=yaml.load(readFileSync(join(f.output,'latest-mac.yml'),'utf8'));
      assert.equal(mac.files.filter(file=>file.url.endsWith('.zip')).length,2);
    }
  }
});
test('拒绝缺失平台、未签名 Mac、损坏下载包和错误更新地址，阻止不完整发布',async t=>{
  for(const kind of ['missing','unsigned','corrupt','path']){
    const f=releaseFixture(t);
    if(kind==='missing')rmSync(join(f.input,'linux-x64',f.prefix+'linux-x86_64.AppImage'));
    if(kind==='unsigned')writeFileSync(join(f.input,'mac-arm64/platform-report.json'),JSON.stringify({version:f.version,arch:'arm64',signed:false}));
    if(kind==='corrupt')writeFileSync(join(f.input,'mac-x64',f.prefix+'mac-x64.zip'),'tampered');
    if(kind==='path'){const path=join(f.input,'windows-x64/latest.yml'),feed=yaml.load(readFileSync(path,'utf8'));feed.files[0].url='../outside.exe';writeFileSync(path,yaml.dump(feed));}
    await assert.rejects(collectRelease(f.input,f.output,{version:f.version,requireSigned:true}));assert.equal(existsSync(f.output),false);
  }
});
