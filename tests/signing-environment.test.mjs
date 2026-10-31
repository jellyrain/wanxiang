import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSigningEnvironment} from '../scripts/signing-environment.mjs';

test('未配置的签名 Secret 作为缺省值，不被打包工具解析成项目目录',()=>{
  const env={CSC_LINK:'',CSC_KEY_PASSWORD:'',WIN_CSC_LINK:'  ',APPLE_ID:'',APPLE_TEAM_ID:'',UNRELATED:'keep'};
  prepareSigningEnvironment(env);assert.deepEqual(env,{UNRELATED:'keep'});
});
test('正式签名配置保持原样，包括密码中的空格；Mac 测试包不导入发布证书',()=>{
  const env={CSC_LINK:'certificate-fixture',CSC_KEY_PASSWORD:' spaced password ',CSC_INSTALLER_LINK:'installer-fixture',APPLE_ID:'developer@example.test'};
  const before={...env};prepareSigningEnvironment(env);assert.deepEqual(env,before);
  prepareSigningEnvironment(env,{adHoc:true});assert.deepEqual(env,{APPLE_ID:'developer@example.test'});
});
