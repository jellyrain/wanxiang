import {ContentError,type Database} from './store.ts';

// Increment only with an explicit, tested data migration. Never open a newer
// library with an older application and let CREATE/ALTER silently modify it.
export const LIBRARY_FORMAT_VERSION=4;
// Change the format version and add a migration before changing this structure.
export const LIBRARY_SCHEMA="f4ecadb52ea009e98eed7142e123319e8b3c76f23d32c27327408a6c390a0a33";
export function assertLibraryVersion(db:Database){
  const row=db.prepare('PRAGMA user_version').get() as {user_version:number};
  if(!Number.isSafeInteger(row.user_version)||row.user_version<0||row.user_version>LIBRARY_FORMAT_VERSION)
    throw new ContentError('NEWER_LIBRARY','这份资料库由较新版软件创建，请使用较新版打开。原资料未被修改。');
}
export function markLibraryVersion(db:Database){db.exec(`PRAGMA user_version=${LIBRARY_FORMAT_VERSION}`);}
