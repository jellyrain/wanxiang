import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createReadStream,readdirSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,lstatSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),yaml=createRequire(require.resolve('electron-updater'))('js-yaml');
const targets=['windows-x64','mac-x64','mac-arm64','linux-x64'];
async function digest(path){
  const sha256=createHash('sha256'),sha512=createHash('sha512');
  for await(const part of createReadStream(path)){sha256.update(part);sha512.update(part);}
  return {sha256:sha256.digest('hex'),sha512:sha512.digest('base64'),size:lstatSync(path).size};
}
export async function collectRelease(input,output,{version,requireSigned=false}){
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('无效的发布版本。');
  const prefix=`WanxiangWorkshop-${version}-`,records=new Map(),feeds=new Map(),mac=[];
  // Validate all four outputs before writing a release that users can download.
  for(const target of targets){
    const directory=join(input,target);
    for(const name of readdirSync(directory)){
      const path=join(directory,name);
      if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('发布输入必须为普通文件：'+name);
      if(name.startsWith('WanxiangWorkshop-')&&/\.(exe|zip|dmg|AppImage|blockmap)$/.test(name)){
        if(!name.startsWith(prefix))throw Error('发布输入含其他版本：'+name);
        if(records.has(name))throw Error('发布文件重名：'+name);
        records.set(name,{path,...await digest(path)});
      }
    }
    const feedName=target==='windows-x64'?'latest.yml':target.startsWith('mac-')?'latest-mac.yml':'latest-linux.yml';
    const feed=yaml.load(readFileSync(join(directory,feedName),'utf8'));
    if(feed.version!==version||!Array.isArray(feed.files)||!feed.files.length)throw Error('更新清单版本或文件无效：'+target);
    if(target.startsWith('mac-')){
      const report=JSON.parse(readFileSync(join(directory,'platform-report.json'),'utf8'));
      if(report.version!==version||report.arch!==target.slice(4)||(requireSigned&&!report.signed))throw Error('macOS 正式发布必须完成两种架构的签名和公证。');
      mac.push(feed);
    }else feeds.set(feedName,feed);
  }
  const required=[`${prefix}win-x64-Setup.exe`,`${prefix}win-x64-Portable.zip`,`${prefix}mac-x64.dmg`,`${prefix}mac-x64.zip`,`${prefix}mac-arm64.dmg`,`${prefix}mac-arm64.zip`,`${prefix}linux-x86_64.AppImage`];
  for(const name of required)if(!records.has(name))throw Error('发布缺少平台文件：'+name);
  feeds.set('latest-mac.yml',{...mac[0],files:mac.flatMap(feed=>feed.files)});
  const requiredFeedFiles=new Map([
    ['latest.yml',[`${prefix}win-x64-Setup.exe`]],
    ['latest-mac.yml',[`${prefix}mac-x64.zip`,`${prefix}mac-arm64.zip`]],
    ['latest-linux.yml',[`${prefix}linux-x86_64.AppImage`]]
  ]);
  for(const [name,feed] of feeds){
    const seen=new Set();
    for(const file of feed.files){
      if(typeof file.url!=='string'||basename(file.url)!==file.url||/[\\/%?#]/.test(file.url)||seen.has(file.url))throw Error('更新清单文件路径无效：'+name);
      seen.add(file.url);const record=records.get(file.url);
      if(!record||record.sha512!==file.sha512||(file.size!==undefined&&file.size!==record.size))throw Error('更新清单校验不符：'+file.url);
    }
    if(feed.path&&!seen.has(feed.path))throw Error('旧版兼容更新路径未包含在清单中。');
    if(feed.path&&records.get(feed.path)?.sha512!==feed.sha512)throw Error('旧版兼容更新校验值不符。');
    for(const file of requiredFeedFiles.get(name))if(!seen.has(file))throw Error('更新清单缺少可更新的程序：'+file);
  }
  const portable=JSON.parse(readFileSync(join(input,'windows-x64/latest-portable.json'),'utf8')),portableFile=records.get(`${prefix}win-x64-Portable.zip`);
  if(portable.version!==version||portable.file!==`${prefix}win-x64-Portable.zip`||portable.format!==2||portable.kind!=='folder-zip'||portable.root!=='WanxiangWorkshop'||portable.bytes!==portableFile.size||portable.sha512!==Buffer.from(portableFile.sha512,'base64').toString('hex'))throw Error('免安装更新清单校验不符。');
  mkdirSync(output,{recursive:true});
  if(readdirSync(output).length)throw Error('合并发布的目标目录必须为空，避免混入旧版文件。');
  for(const [name,record] of records)copyFileSync(record.path,join(output,name));
  for(const [name,feed] of feeds)writeFileSync(join(output,name),yaml.dump(feed,{lineWidth:-1}));
  writeFileSync(join(output,'latest-portable.json'),JSON.stringify(portable,null,2)+'\n');
  const names=readdirSync(output).sort(),checksums=[];
  for(const name of names)checksums.push(`${(records.get(name)??await digest(join(output,name))).sha256}  ${name}`);
  writeFileSync(join(output,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
  return {version,targets,files:[...names,'SHA256SUMS.txt']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!==`v${version}`)throw Error('标签必须与 package.json 版本一致。');
  const result=await collectRelease(resolve(process.argv[2]||'release/downloads'),resolve(process.argv[3]||'release/publish'),{version,requireSigned:process.argv.includes('--signed')});
  console.log(JSON.stringify(result,null,2));
}
