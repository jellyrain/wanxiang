import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {electronExecutable} from './electron-path.mjs';
import {writeReleaseConfig} from './build-release-config.mjs';
import {prepareSigningEnvironment} from './signing-environment.mjs';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const platform=process.argv[2];
if(!['mac','linux'].includes(platform)||(platform==='mac'?'darwin':'linux')!==process.platform)throw Error('请在对应系统的原生构建机运行 mac / linux 打包。');
if(!['x64','arm64'].includes(process.arch))throw Error('暂不支持此架构。');
electronExecutable();
const signed=platform==='mac'&&process.env.WANXIANG_MAC_RELEASE==='true';
prepareSigningEnvironment(process.env,{adHoc:platform==='mac'&&!signed});
if(signed)for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']){
  if(!process.env[key])throw Error('macOS 正式发布缺少 GitHub Secret：'+key);
}
writeReleaseConfig({macSigned:signed});
const {build,Platform,Arch}=await import('electron-builder'),config=require('../electron-builder.config.cjs');
const output=resolve(root,'release',`${platform}-${process.arch}`);
config.directories={...config.directories,output};
// better-sqlite3 13 ships Node-API prebuilds for each target. Never rebuild the
// Windows binary for another OS; each native runner installs its own dependency.
config.mac={...config.mac,notarize:signed,forceCodeSigning:signed,...(!signed?{identity:'-'}:{})};
const artifacts=await build({projectDir:root,config,targets:(platform==='mac'?Platform.MAC:Platform.LINUX).createTarget(platform==='mac'?['dmg','zip']:['AppImage'],process.arch==='arm64'?Arch.arm64:Arch.x64),publish:'never'});
if(!existsSync(join(output,platform==='mac'?'latest-mac.yml':process.arch==='x64'?'latest-linux.yml':'latest-linux-arm64.yml')))throw Error('构建未产生更新清单。');
if(signed){
  const bundle=join(output,process.arch==='arm64'?'mac-arm64':'mac','万象工坊.app');
  for(const [command,args] of [['codesign',['--verify','--deep','--strict',bundle]],['xcrun',['stapler','validate',bundle]]]){
    const result=spawnSync(command,args,{stdio:'inherit'});if(result.error||result.status!==0)throw Error('macOS 签名或公证验证失败。');
  }
}
mkdirSync(output,{recursive:true});
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
writeFileSync(join(output,'platform-report.json'),JSON.stringify({version,platform,arch:process.arch,signed,artifacts:artifacts.map(p=>p.slice(output.length+1))},null,2)+'\n');
console.log('构建完成：'+output);
