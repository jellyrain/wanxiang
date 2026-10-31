import {readFileSync} from 'node:fs';
export function readReleaseConfig(path:string):{updateUrl:string;macSigned:boolean}{
  try{
    const value=JSON.parse(readFileSync(path,'utf8'));
    if(!value.updateUrl)return {updateUrl:'',macSigned:value.macSigned===true};
    const url=new URL(value.updateUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();
    return {updateUrl:url.href,macSigned:value.macSigned===true};
  }catch{return {updateUrl:'',macSigned:false};}
}
