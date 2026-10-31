export interface BackupSettings { directory:string; automatic:boolean; intervalMinutes:number; retentionDays:number }
export interface BackupPoint { id:string; parentId:string|null; kind:'baseline'|'increment'; createdAt:string; records:number; newImages:number; bytes:number; schema:string; label:string }
export interface BackupStatus {
  settings:BackupSettings; libraryId:string; generation:string; busy:boolean; phase:string;
  needsBaseline:boolean; pendingChanges:number; headId:string|null; points:BackupPoint[];
  lastAttempt:string|null; lastSuccess:string|null; lastError:string|null; repositoryError:string|null;
}
export interface BackupEstimate { records:number; images:number; bytes:number; worlds:number; works:number; generation:string; sequence:number }
export interface RestorePreview { point:BackupPoint; chainLength:number; worlds:number; works:number; characters:number; chapters:number; images:number; bytes:number; token:string; expiresAt:string; canProtectCurrent:boolean }
export interface BackupRun { skipped:boolean; point:BackupPoint|null }
export const BACKUP_CHANNELS = {
  getBackupStatus:'backup:status', saveBackupSettings:'backup:settings', estimateBackup:'backup:estimate',
  createBackupBaseline:'backup:baseline', runIncrementalBackup:'backup:increment', previewBackupRestore:'backup:preview',
  restoreBackup:'backup:restore', deleteBackupPoint:'backup:delete'
} as const;
