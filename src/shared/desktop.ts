export interface DesktopStatus {
  version:string;
  packaged:boolean;
  edition:'development'|'installed'|'portable';
  dataDirectory:string;
  onboardingComplete:boolean;
  loginAtStartup:boolean;
  loginAtStartupSupported:boolean;
  closeToTray:boolean;
  trayAvailable:boolean;
  phase:'running'|'checking'|'stopping'|'ready';
  error:string|null;
}
