import {existsSync,lstatSync,readdirSync,realpathSync,unlinkSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';

/** Only downloaded packages are disposable; never traverse staged or previous programs. */
export function updateCache(directory:string,clear=false){
  const root=resolve(directory),files:{path:string;bytes:number}[]=[];
  if(!existsSync(root))return {bytes:0,files:0};
  if(lstatSync(root).isSymbolicLink()||realpathSync(root).toLowerCase()!==root.toLowerCase())throw Error('更新缓存目录无效。');
  function visit(folder:string,depth:number){
    for(const item of readdirSync(folder,{withFileTypes:true})){
      const path=join(folder,item.name),stat=lstatSync(path);if(stat.isSymbolicLink())continue;
      if(item.isDirectory()){if(depth<2&&!['previous','new'].includes(item.name.toLowerCase()))visit(path,depth+1);continue;}
      const name=relative(root,path).replaceAll('\\','/');
      if(!stat.isFile()||!(/^p-[^/]+\/(update\.zip|download\.partial)$/.test(name)||/^[^/]+\/(installer\.exe|update\.zip|[^/]+\.blockmap|pending\/[^/]+\.(exe|zip|AppImage|blockmap|json))$/.test(name)))continue;
      files.push({path,bytes:stat.size});
    }
  }
  visit(root,0);
  if(clear)for(const file of files){
    if(!realpathSync(file.path).toLowerCase().startsWith(root.toLowerCase()+sep)||lstatSync(file.path).isSymbolicLink())throw Error('更新缓存文件路径已改变。');
    unlinkSync(file.path);
  }
  return {bytes:files.reduce((sum,file)=>sum+file.bytes,0),files:files.length};
}
