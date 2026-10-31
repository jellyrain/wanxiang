// Isolated installer identity; all profiles stay beside the installed test app.
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build,Platform,Arch} from 'electron-builder';
import {writeReleaseMetadata} from './release-metadata.mjs';
import {makePortableZip,cleanBuildDirectory} from './package-layout.mjs';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const output=join(root,'test-results/packaged-update-acceptance');mkdirSync(output,{recursive:true});
for(const version of process.argv.slice(2).length?process.argv.slice(2):['0.1.0','0.1.1']){
  const {afterPack,...settings}=require('../electron-builder.config.cjs');
  const base={...structuredClone(settings),afterPack},staging=mkdtempSync(join(output,'.windows-build-'));
  const config={...base,appId:'local.wanxiang.update-acceptance',productName:'Wanxiang Upgrade Acceptance',executableName:'WanxiangUpgradeAcceptance',
    extraMetadata:{name:'wanxiang-update-acceptance',version},
    directories:{...base.directories,output:staging,buildResources:join(staging,'build-resources')},
    win:{...base.win,icon:join(root,'build-resources/app.ico')},
    nsis:{...base.nsis,createDesktopShortcut:false,createStartMenuShortcut:false,shortcutName:'Wanxiang Upgrade Acceptance',uninstallDisplayName:'Wanxiang Upgrade Acceptance'}};
  try{
    const artifacts=await build({projectDir:root,config,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),publish:'never'});
    artifacts.push(await makePortableZip(staging,version,'WanxiangUpgradeAcceptance.exe'));
    const records=await writeReleaseMetadata(staging,version,artifacts,'Isolated packaged upgrade acceptance');
    const destination=join(output,version);mkdirSync(destination,{recursive:true});
    for(const name of [...records.map(r=>r.name),'latest.yml','latest-portable.json','SHA256SUMS.txt','build-report.json'])copyFileSync(join(staging,name),join(destination,name));
  }catch(error){console.error(error);throw error;}
  finally{await cleanBuildDirectory(staging,output);}
}
console.log('Isolated NSIS and folder ZIP fixtures ready: '+output);
