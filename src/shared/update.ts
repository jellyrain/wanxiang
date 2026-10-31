export interface UpdateSettings {url:string;checkOnStartup:boolean}
export type UpdatePhase='unconfigured'|'idle'|'checking'|'available'|'downloading'|'downloaded'|'preparing'|'installing'|'error';
export interface UpgradePoint {id:string;createdAt:string;appVersion:string;targetVersion:string;libraryVersion:number;bytes:number}
export interface UpdateStatus {
  currentVersion:string;packaged:boolean;edition:'development'|'installed'|'portable';settings:UpdateSettings;phase:UpdatePhase;
  availableVersion:string|null;releaseNotes:string;progress:number;error:string|null;lastChecked:string|null;
  protection:UpgradePoint|null;
}
