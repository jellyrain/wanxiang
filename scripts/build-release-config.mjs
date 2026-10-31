import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
export function writeReleaseConfig({macSigned=false}={}){
  let updateUrl=process.env.WANXIANG_UPDATE_URL||'';
  if(updateUrl){
    const url=new URL(updateUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('发布更新源必须是无凭据的 HTTPS 目录。');
    if(!url.pathname.endsWith('/'))url.pathname+='/';updateUrl=url.href;
  }
  const directory=resolve(import.meta.dirname,'../resources');mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'release-config.json'),JSON.stringify({updateUrl,macSigned})+'\n');
}
