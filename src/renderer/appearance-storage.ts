import {backgroundFormat,backgroundSettings,BACKGROUND_IMAGE_LIMIT,BACKGROUND_VIDEO_LIMIT,type BackgroundMedia,type BackgroundSettings} from '../shared/appearance.ts';

// Device-local blobs: no original filesystem path or background media enters creative data.
const DB_NAME='wanxiang-appearance',STORE='preferences';
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onerror=()=>reject(Error('无法打开外观存储，请检查此设备的存储权限。'));request.onsuccess=()=>resolve(request.result);request.onblocked=()=>reject(Error('请关闭其他窗口后重试。'));});}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onabort=tx.onerror=()=>{db.close();reject(Error('外观保存失败，请检查可用空间后重试。'));};});
}
export async function loadAppearance(){
  const value=await transaction('readonly',store=>store.get('current')) as {settings?:unknown;media?:BackgroundMedia}|undefined;
  return {settings:backgroundSettings(value?.settings),media:value?.media?.blob instanceof Blob&&['image','video'].includes(value.media.kind)?value.media:null};
}
export async function saveAppearance(settings:BackgroundSettings,media:BackgroundMedia|null){await transaction('readwrite',store=>store.put({settings:backgroundSettings(settings),media},'current'));}
export async function prepareBackground(file:File):Promise<BackgroundMedia>{
  if(file.size>BACKGROUND_VIDEO_LIMIT)throw Error('背景视频不能超过 200 MB。');
  const format=backgroundFormat(new Uint8Array(await file.slice(0,64).arrayBuffer()));
  if(!format)throw Error('请选择 PNG、JPG、WebP、GIF 图片，或 MP4、WebM 视频。');
  if(format.kind==='image'&&file.size>BACKGROUND_IMAGE_LIMIT)throw Error('背景图片不能超过 25 MB。');
  const blob=file.slice(0,file.size,format.mime),url=URL.createObjectURL(blob);
  try{await new Promise<void>((resolve,reject)=>{
    const element=format.kind==='image'?new Image():document.createElement('video');
    const finish=(ok:boolean)=>{clearTimeout(timer);element.onload=element.onerror=null;if(element instanceof HTMLVideoElement){element.onloadeddata=null;element.pause();element.removeAttribute('src');element.load();}ok?resolve():reject(Error('这个文件无法显示，请换用可播放的图片或视频。'));};
    const timer=setTimeout(()=>finish(false),20000);element.onerror=()=>finish(false);
    if(element instanceof HTMLVideoElement){element.muted=true;element.preload='auto';element.onloadeddata=()=>finish(element.videoWidth>0&&element.videoHeight>0);}else element.onload=()=>finish(element.naturalWidth>0&&element.naturalHeight>0);
    element.src=url;
  });}finally{URL.revokeObjectURL(url);}
  return {kind:format.kind,name:file.name,blob};
}
