import {createRequire} from 'node:module';
import {readdirSync,writeFileSync,existsSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {rename,rm} from 'node:fs/promises';
import {join,resolve,relative,basename,sep} from 'node:path';
import {spawnSync} from 'node:child_process';

export const portableRoot='WanxiangWorkshop';
export function writeProgramManifest(directory,version,executable){
  const files=[];
  function walk(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
    const path=join(folder,item.name),name=relative(directory,path).replaceAll('\\','/');
    if(name.split('/')[0].toLowerCase()==='data')throw Error('发布包不能包含 data 资料目录。');
    if(lstatSync(path).isSymbolicLink())throw Error('发布包不能包含目录链接。');
    if(item.isDirectory())walk(path);else if(item.isFile()&&name!=='wanxiang-program-files.json')files.push(name);
  }}walk(directory);
  files.push('wanxiang-program-files.json');files.sort();
  const manifest={format:1,version,executable,files};
  writeFileSync(join(directory,'wanxiang-program-files.json'),JSON.stringify(manifest,null,2));return manifest;
}

export function afterPack(context){
  const directory=context.appOutDir,version=context.packager.appInfo.version;
  const executable=context.packager.appInfo.productFilename+'.exe';
  // executableName can differ from productFilename for isolated acceptance packages.
  const name=context.packager.config.executableName?context.packager.config.executableName+'.exe':executable;
  const manifest=writeProgramManifest(directory,version,name);
  const escape=value=>value.replaceAll('$','$$').replaceAll('"','$\\"').replaceAll('/','\\');
  const folders=new Set();for(const file of manifest.files){let parent=file.split('/').slice(0,-1);while(parent.length){folders.add(parent.join('/'));parent.pop();}}
  const lines=['; Generated from packaged program files. Never recursively remove the installation folder.','!macro customRemoveFiles','  SetOutPath $TEMP'];
  for(const file of manifest.files)lines.push('  Delete "$INSTDIR\\'+escape(file)+'"');
  // NSIS adds this helper after afterPack has enumerated the payload.
  if(!manifest.files.includes('resources/elevate.exe'))lines.push('  Delete "$INSTDIR\\resources\\elevate.exe"');
  lines.push('  Delete "$INSTDIR\\${UNINSTALL_FILENAME}"','  Delete "$INSTDIR\\uninstallerIcon.ico"');
  for(const folder of [...folders].sort((a,b)=>b.length-a.length))lines.push('  RMDir "$INSTDIR\\'+escape(folder)+'"');
  lines.push('  RMDir "$INSTDIR"','!macroend','');
  mkdirSync(context.packager.info.buildResourcesDir,{recursive:true});
  writeFileSync(join(context.packager.info.buildResourcesDir,'remove-program-files.nsh'),lines.join('\n'));
}

export async function makePortableZip(staging,version,executable){
  const folder=join(staging,portableRoot);
  // Let electron-builder release its Windows file handles before moving the payload.
  for(let attempt=0;;attempt++){
    try{await rename(join(staging,'win-unpacked'),folder);break;}
    catch(error){if(attempt>=20||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;await new Promise(done=>setTimeout(done,250));}
  }
  writeFileSync(join(folder,'wanxiang-portable.json'),JSON.stringify({format:2,edition:'portable-folder'}));
  writeProgramManifest(folder,version,executable);
  const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
  const seven=await builder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
  const archive=join(staging,`WanxiangWorkshop-${version}-win-x64-Portable.zip`);
  const child=spawnSync(seven,['a','-tzip','-mx=5','-bd',archive,portableRoot],{cwd:staging,windowsHide:true,stdio:'ignore'});
  if(child.error||child.status!==0)throw child.error??Error('文件夹 ZIP 打包失败。');
  return archive;
}

export async function cleanBuildDirectory(directory,parent){
  const root=realpathSync(parent),target=resolve(directory);
  if(!target.toLowerCase().startsWith(root.toLowerCase()+sep)||!basename(target).startsWith('.windows-build-'))throw Error('拒绝清理非构建临时目录。');
  if(!existsSync(target))return;
  if(lstatSync(target).isSymbolicLink()||realpathSync(target).toLowerCase()!==target.toLowerCase())throw Error('拒绝清理被重定向的构建目录。');
  await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
