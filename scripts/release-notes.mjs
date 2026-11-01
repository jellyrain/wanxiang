import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export function releaseNotes(version,directory=fileURLToPath(new URL('../.github/release-notes/',import.meta.url))){
  if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('无效的发布版本。');
  const notes=readFileSync(join(directory,`v${version}.md`),'utf8').trim();
  if(!notes)throw Error('当前版本更新说明不能为空。');
  return notes;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  console.log(releaseNotes(version));
}
