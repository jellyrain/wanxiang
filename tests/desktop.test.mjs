import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DesktopLifecycle} from '../electron/lifecycle.ts';
import {DesktopSettings} from '../electron/desktop-settings.ts';

function fixture(){
  const events=[],state={visible:true,draft:'未保存章节',window:true,tray:true,closeToTray:true};
  let release,controller;
  const finishing=new Promise(done=>release=done);
  const window={hide(){state.visible=false;events.push('hide');},close(){events.push('beforeunload');controller.onClose({preventDefault(){events.push('prevent');}});}};
  controller=new DesktopLifecycle({getWindow:()=>state.window?window:null,canHide:()=>state.tray,closeToTray:()=>state.closeToTray,
    showWindow:()=>{state.visible=true;events.push('show');},stopWork:async()=>{events.push('stop-new-writes');await finishing;events.push('backup-finished');},
    resumeWork:()=>events.push('resume'),finishQuit:()=>events.push('quit'),changed:()=>{},failed:()=>events.push('error')});
  return {state,events,controller,release};
}

test('关闭到托盘保留页面草稿，不触发卸载或暂停后台服务',()=>{
  const f=fixture();let prevented=false;
  f.controller.onClose({preventDefault(){prevented=true;}});
  assert.ok(prevented);assert.equal(f.state.visible,false);assert.equal(f.state.draft,'未保存章节');
  assert.deepEqual(f.events,['hide']);assert.equal(f.controller.phase,'running');
  f.controller.show();assert.ok(f.state.visible);assert.equal(f.state.draft,'未保存章节');
});

test('从隐藏窗口退出先检查草稿，取消后恢复窗口且服务继续运行',()=>{
  const f=fixture();f.controller.hide();f.controller.requestQuit();
  assert.equal(f.controller.phase,'checking');assert.deepEqual(f.events,['hide','beforeunload']);
  f.controller.cancelQuit();assert.equal(f.controller.phase,'running');assert.ok(f.state.visible);
  assert.equal(f.state.draft,'未保存章节');assert.ok(!f.events.includes('stop-new-writes'));
  f.controller.onClose({preventDefault(){}});assert.equal(f.state.visible,false);
});

test('明确退出不被收起拦截，等待备份完成再退出；重复退出只执行一次',async()=>{
  const f=fixture();f.controller.requestQuit();f.controller.requestQuit();
  assert.deepEqual(f.events,['beforeunload']);
  f.state.window=false;const stopped=f.controller.windowClosed();
  await f.controller.windowClosed();f.controller.requestQuit();f.controller.show();
  assert.equal(f.controller.phase,'stopping');assert.deepEqual(f.events,['beforeunload','stop-new-writes']);
  assert.equal(f.controller.hide(),false);
  f.release();await stopped;assert.equal(f.controller.phase,'ready');
  assert.deepEqual(f.events,['beforeunload','stop-new-writes','backup-finished','quit']);
});

test('纯后台启动没有窗口时也能完成退出',async()=>{
  const f=fixture();f.state.window=false;f.controller.requestQuit();
  assert.deepEqual(f.events,['stop-new-writes']);f.release();await new Promise(done=>setImmediate(done));
  assert.equal(f.controller.phase,'ready');assert.equal(f.events.at(-1),'quit');
});

test('关闭行为设为退出或托盘不可用时不会把窗口藏起来',async()=>{
  for(const mode of ['preference','tray']){
    const f=fixture();if(mode==='preference')f.state.closeToTray=false;else f.state.tray=false;
    let prevented=false;f.controller.onClose({preventDefault(){prevented=true;}});
    assert.equal(prevented,false);assert.equal(f.controller.phase,'checking');assert.equal(f.events.length,0);
    f.state.window=false;const stopped=f.controller.windowClosed();f.release();await stopped;
    assert.equal(f.events.at(-1),'quit');
  }
});

test('后台停止异常时重新开放服务和窗口，不留下无人可操作的进程',async()=>{
  const events=[];const c=new DesktopLifecycle({getWindow:()=>null,canHide:()=>true,closeToTray:()=>true,showWindow:()=>events.push('show'),
    stopWork:async()=>{throw Error('disk');},resumeWork:()=>events.push('resume'),finishQuit:()=>events.push('quit'),changed:()=>{},failed:()=>events.push('error')});
  await c.windowClosed();assert.equal(c.phase,'running');assert.deepEqual(events,['resume','show','error']);
});

test('窗口偏好独立持久化，格式错误不自动覆盖，失败保存不改变生效值',()=>{
  const root=resolve('test-results/desktop-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'settings-')),path=join(dir,'desktop-settings.json');
  const settings=new DesktopSettings(path);assert.equal(settings.closeToTray,true);assert.equal(existsSync(path),false);
  settings.save(false);assert.equal(new DesktopSettings(path).closeToTray,false);
  assert.throws(()=>settings.save('false'),TypeError);assert.equal(settings.closeToTray,false);
  writeFileSync(path,'{broken');const damaged=new DesktopSettings(path);assert.equal(damaged.closeToTray,true);assert.ok(damaged.error);assert.equal(readFileSync(path,'utf8'),'{broken');
  damaged.save(false);assert.equal(damaged.error,null);assert.equal(new DesktopSettings(path).closeToTray,false);
  const missing=new DesktopSettings(join(dir,'missing','settings.json'));assert.throws(()=>missing.save(false));assert.equal(missing.closeToTray,true);
});
