import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// The renderer stamp is emitted in the same Vite build that defines __APP_VERSION__.
export function verifyPackageVersion(appDirectory,expectedVersion){
  const appVersion=JSON.parse(readFileSync(join(appDirectory,'package.json'),'utf8')).version;
  const renderer=JSON.parse(readFileSync(join(appDirectory,'dist-ui/app-version.json'),'utf8'));
  if(appVersion!==expectedVersion)throw Error('应用版本与待发布版本不一致：'+appVersion+' / '+expectedVersion);
  if(renderer.format!==1||renderer.version!==appVersion)throw Error('界面构建版本与应用版本不一致：'+renderer.version+' / '+appVersion);
  return {appVersion,rendererVersion:renderer.version};
}
