import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeConfig} from '../electron/runtime-config.ts';

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'wanxiang-profile-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}
test('发布版始终在程序旁保存 data，移动整个文件夹后路径一起改变，忽略旧配置',t=>{
  const root=fixture(t),old=join(root,'oc-studio');mkdirSync(old);
  const env={WANXIANG_USER_DATA_DIR:old,WANXIANG_DATA_DIR:old,WANXIANG_CONNECTION_FILE:join(old,'connection.json'),WANXIANG_DEV_URL:'http://127.0.0.1:5173'};
  for(const folder of ['安装目录',"免安装 ' 文件夹",'移动后']){
    const program=join(root,folder),config=runtimeConfig(root,env,{executable:join(program,'万象工坊.exe'),platform:'win32'});
    assert.equal(config.programDirectory,program);assert.equal(config.userData,join(program,'data'));
    assert.equal(config.directory,join(program,'data','library'));assert.equal(config.descriptorPath,join(program,'data','connection.json'));
    assert.equal(config.devUrl,undefined);assert.equal(existsSync(config.userData),false);
  }
});
test('全新用户使用 wanxiang 目录，路径解析不会创建资料库',t=>{
  const root=fixture(t),config=runtimeConfig(root,{});
  assert.equal(config.userData,join(root,'wanxiang'));
  assert.equal(config.directory,join(root,'wanxiang','library'));
  assert.equal(config.descriptorPath,join(root,'wanxiang','connection.json'));
  assert.equal(existsSync(config.userData),false);
});
test('已有用户沿用旧目录及资料，即使存在新的空目录也不会切换',t=>{
  const root=fixture(t),legacy=join(root,'oc-studio');
  mkdirSync(join(legacy,'library'),{recursive:true});
  const data=join(legacy,'library','library.sqlite');writeFileSync(data,'existing library');
  mkdirSync(join(root,'wanxiang'));
  const config=runtimeConfig(root,{});
  assert.equal(config.userData,legacy);
  assert.equal(config.directory,join(legacy,'library'));
  assert.equal(config.descriptorPath,join(legacy,'connection.json'));
  assert.equal(readFileSync(data,'utf8'),'existing library');
});
test('旧环境变量仍隔离数据，新名称优先，资料和连接路径随指定 profile 保持一致',t=>{
  const root=fixture(t),oldProfile=join(root,'old-test'),newProfile=join(root,'new-test');
  const oldEnv={OC_STUDIO_USER_DATA_DIR:oldProfile,OC_STUDIO_HTTP_PORT:'12345',OC_STUDIO_DEV_URL:'http://127.0.0.1:5173'};
  const old=runtimeConfig(root,oldEnv);
  assert.equal(old.directory,join(oldProfile,'library'));
  assert.equal(old.descriptorPath,join(oldProfile,'connection.json'));assert.equal(old.port,12345);
  assert.equal(old.devUrl,oldEnv.OC_STUDIO_DEV_URL);
  const config=runtimeConfig(root,{...oldEnv,WANXIANG_USER_DATA_DIR:newProfile,WANXIANG_HTTP_PORT:'23456',WANXIANG_DEV_URL:'http://127.0.0.1:5174',
    OC_STUDIO_DATA_DIR:join(root,'old-data'),WANXIANG_DATA_DIR:join(root,'new-data'),
    OC_STUDIO_CONNECTION_FILE:join(root,'old.json'),WANXIANG_CONNECTION_FILE:join(root,'new.json')});
  assert.equal(config.userData,newProfile);assert.equal(config.directory,join(root,'new-data'));
  assert.equal(config.descriptorPath,join(root,'new.json'));assert.equal(config.port,23456);
  assert.equal(config.devUrl,'http://127.0.0.1:5174');
});
