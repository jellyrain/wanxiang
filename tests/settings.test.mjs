import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DesktopSettings} from '../electron/desktop-settings.ts';
import {updateCache} from '../electron/update-cache.ts';
const root=resolve('test-results/settings-tests');mkdirSync(root,{recursive:true});
function fixture(t){const path=mkdtempSync(join(root,'case-'));t.after(()=>{assert.ok(path.startsWith(root));rmSync(path,{recursive:true,force:true});});return path;}
test('新资料库记住首次引导状态，切换托盘设置不重置引导，旧偏好不重复引导',t=>{
  const path=join(fixture(t),'desktop.json'),settings=new DesktopSettings(path,true);
  assert.equal(settings.onboardingComplete,false);settings.save(false);assert.equal(new DesktopSettings(path).onboardingComplete,false);
  settings.completeOnboarding();const saved=new DesktopSettings(path);assert.equal(saved.closeToTray,false);assert.equal(saved.onboardingComplete,true);
  writeFileSync(path,JSON.stringify({version:1,closeToTray:true}));assert.equal(new DesktopSettings(path,true).onboardingComplete,true);
});
test('清理仅处理已知下载文件，保留 data、恢复点、旧程序与安装暂存',t=>{
  const path=fixture(t),cache=join(path,'update-cache');
  const files=['p-case/update.zip','p-case/download.partial','p-case/previous/app.exe','p-case/new/app.exe','p-case/install.json','wanxiang-updater/pending/update.exe','wanxiang-updater/pending/update-info.json','unrelated.txt'];
  for(const name of files){mkdirSync(join(cache,name,'..'),{recursive:true});writeFileSync(join(cache,name),'content');}
  mkdirSync(join(path,'library/upgrade-recovery'),{recursive:true});writeFileSync(join(path,'library/library.sqlite'),'creative');
  assert.deepEqual(updateCache(cache),{files:4,bytes:28});assert.deepEqual(updateCache(cache,true),{files:4,bytes:28});assert.deepEqual(updateCache(cache),{files:0,bytes:0});
  for(const name of ['p-case/previous/app.exe','p-case/new/app.exe','p-case/install.json','unrelated.txt'])assert.ok(existsSync(join(cache,name)));
  assert.ok(existsSync(join(path,'library/library.sqlite')));
});
