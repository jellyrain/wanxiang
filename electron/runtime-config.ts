import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

export function runtimeConfig(appData:string,env:NodeJS.ProcessEnv=process.env,release?:{executable:string;platform?:NodeJS.Platform}){
  // Keep old launch scripts and existing profiles working after the project rename.
  const setting=(name:string)=>env[`WANXIANG_${name}`]||env[`OC_STUDIO_${name}`];
  const legacyProfile=join(appData,'oc-studio');
  const programDirectory=release?dirname(resolve(release.executable)):undefined;
  // Mac bundles and AppImage mounts are read-only/replaced by updates.
  const besideProgram=programDirectory&&(release?.platform??process.platform)==='win32';
  const userData=besideProgram?join(programDirectory,'data'):(!release&&setting('USER_DATA_DIR'))||(existsSync(legacyProfile)?legacyProfile:join(appData,'wanxiang'));
  const port=setting('HTTP_PORT');
  return {
    userData,
    programDirectory,
    directory:(!release&&setting('DATA_DIR'))||join(userData,'library'),
    descriptorPath:(!release&&setting('CONNECTION_FILE'))||join(userData,'connection.json'),
    devUrl:release?undefined:setting('DEV_URL'),
    port:port?Number(port):undefined
  };
}
