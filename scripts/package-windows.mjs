import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,existsSync,readdirSync,copyFileSync,renameSync,unlinkSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {electronExecutable} from './electron-path.mjs';
import {writeReleaseMetadata} from './release-metadata.mjs';
import {makePortableZip,cleanBuildDirectory} from './package-layout.mjs';
import {writeReleaseConfig} from './build-release-config.mjs';

const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('此命令用于 Windows x64 安装包。');
try{require.resolve('electron-builder');}catch{console.error('尚未安装打包依赖。请由你在工程目录执行：pnpm add -D electron-builder');process.exit(1);}
electronExecutable(); // Use the user's installed runtime; do not fetch Electron.
writeReleaseConfig();
mkdirSync(resolve(root,'build-resources'),{recursive:true});
const icon=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve(root,'scripts/make-icon.ps1'),'-Source',resolve(root,'public/brand/app-icon-v1.png'),'-Destination',resolve(root,'build-resources/app.ico')],{cwd:root,stdio:'inherit',windowsHide:true});
if(icon.error||icon.status!==0)throw Error(icon.error?.message??'图标生成失败。');
const {build,Platform,Arch}=await import('electron-builder');
const config=require('../electron-builder.config.cjs');
const output=resolve(root,config.directories.output);
mkdirSync(resolve(root,'release'),{recursive:true});
const staging=mkdtempSync(resolve(root,'release/.windows-build-'));
// Never clear win-unpacked while somebody is running it. Publish completed files only.
config.directories={...config.directories,output:staging};
// An explicit packaging run may download NSIS and Windows helper tools on first use.
// Electron itself is supplied by the existing local runtime above.
const version=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version;
try{
const artifacts=await build({projectDir:root,config,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never'});
artifacts.push(await makePortableZip(staging,version,'万象工坊.exe'));
if(!existsSync(resolve(staging,'latest.yml')))throw Error('缺少安装版更新清单 latest.yml。');
const records=await writeReleaseMetadata(staging,version,artifacts,process.env.WANXIANG_RELEASE_NOTES??'');
mkdirSync(output,{recursive:true});
// Copy large files first; update feeds are committed only after their binaries exist.
const names=readdirSync(staging).filter(name=>/\.(exe|zip|blockmap)$/.test(name));
names.push('SHA256SUMS.txt','build-report.json','latest.yml','latest-portable.json');
for(const name of names){
  const temporary=join(output,name+'.'+randomUUID()+'.partial');
  try{copyFileSync(join(staging,name),temporary);renameSync(temporary,join(output,name));}
  finally{if(existsSync(temporary))unlinkSync(temporary);}
}
// Only retire recognized generated files after a complete successful build.
for(const name of readdirSync(output)){
  if(names.includes(name)||!(/^(WanxiangWorkshop-[0-9.]+-win-x64-(Setup\.exe(?:\.blockmap)?|Portable\.(exe|zip)))(\.[a-f0-9-]+\.partial)?$/.test(name)||['builder-debug.yml','builder-effective-config.yaml'].includes(name)))continue;
  const path=join(output,name);if(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink())unlinkSync(path);
}
console.log('安装版、免安装版和更新清单已生成：'+records.map(r=>resolve(output,r.name)).join('\n'));
}catch(error){console.error('打包失败：',error);throw error;}
finally{await cleanBuildDirectory(staging,resolve(root,'release'));console.log('本次打包临时目录已清理。');}
