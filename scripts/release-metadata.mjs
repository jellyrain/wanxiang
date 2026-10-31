import {createReadStream,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,basename} from 'node:path';

export async function writeReleaseMetadata(directory,version,artifacts,releaseNotes=''){
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('发布版本号必须为正式版本，例如 0.1.1。');
  const records=[];
  for(const path of artifacts.filter(p=>/\.(exe|zip)$/.test(p))){
    const sha256=createHash('sha256'),sha512=createHash('sha512');
    for await(const part of createReadStream(path)){sha256.update(part);sha512.update(part);}
    records.push({name:basename(path),bytes:statSync(path).size,sha256:sha256.digest('hex'),sha512:sha512.digest('hex')});
  }
  const portable=records.find(r=>r.name===`WanxiangWorkshop-${version}-win-x64-Portable.zip`);
  const installed=records.find(r=>r.name===`WanxiangWorkshop-${version}-win-x64-Setup.exe`);
  if(!portable||!installed)throw Error('必须同时生成安装版和免安装版。');
  writeFileSync(join(directory,'latest-portable.json'),JSON.stringify({format:2,kind:'folder-zip',root:'WanxiangWorkshop',version,file:portable.name,bytes:portable.bytes,sha512:portable.sha512,releaseNotes},null,2)+'\n');
  writeFileSync(join(directory,'SHA256SUMS.txt'),records.map(r=>`${r.sha256}  ${r.name}`).join('\n')+'\n');
  writeFileSync(join(directory,'build-report.json'),JSON.stringify({version,installer:'electron-builder / NSIS',portable:'folder ZIP',dataLocation:'program-directory/data',directorySelection:true,artifacts:records},null,2)+'\n');
  return records;
}
