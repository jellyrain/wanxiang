// GitHub supplies an empty string for an unconfigured Secret. electron-builder
// distinguishes that from an absent variable and can resolve it as the cwd.
export function prepareSigningEnvironment(env=process.env,{adHoc=false}={}){
  const certificates=['CSC_LINK','CSC_KEY_PASSWORD','CSC_INSTALLER_LINK','CSC_INSTALLER_KEY_PASSWORD'];
  for(const name of [...certificates,'WIN_CSC_LINK','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']){
    if(typeof env[name]==='string'&&!env[name].trim())delete env[name];
  }
  if(adHoc)for(const name of certificates)delete env[name];
}
