import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {zipFiles} from './zip-files.mjs';
const root=resolve(import.meta.dirname,'..'),output=join(root,'resources/skills');
mkdirSync(output,{recursive:true});
const shared=['content-model','connection-troubleshooting','catalogs','history','deletion','transfer','backups'];
for(const kind of ['api','mcp']){
  const folder='wanxiang-workshop-'+kind;
  const sources=[['SKILL.md',`skills/${folder}/SKILL.md`],
    ...[...shared,kind].map(name=>[`references/${name}.md`,`skills/wanxiang-workshop/references/${name}.md`]),
    ...(kind==='api'?['invoke-workshop','connection-errors'].map(name=>[`scripts/${name}.ps1`,`skills/wanxiang-workshop/scripts/${name}.ps1`]):[])];
  const bytes=zipFiles(sources.sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,path])=>({name:`${folder}/${name}`,bytes:readFileSync(join(root,path))})));
  const target=join(output,folder+'.zip');writeFileSync(target+'.partial',bytes);renameSync(target+'.partial',target);
  console.log('Skill package: '+folder+'.zip');
}
