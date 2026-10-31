export interface BackgroundSettings {enabled:boolean;shade:number;blur:number;opacity:number;fit:'cover'|'contain';paused:boolean}
export interface BackgroundMedia {kind:'image'|'video';name:string;blob:Blob}
export const DEFAULT_BACKGROUND:BackgroundSettings={enabled:true,shade:45,blur:2,opacity:88,fit:'cover',paused:false};
export const BACKGROUND_IMAGE_LIMIT=25*1024**2,BACKGROUND_VIDEO_LIMIT=200*1024**2;
export function backgroundSettings(value:unknown):BackgroundSettings{
  const v=(value&&typeof value==='object'?value:{}) as Partial<BackgroundSettings>;
  const number=(n:unknown,min:number,max:number,fallback:number)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
  return {enabled:typeof v.enabled==='boolean'?v.enabled:true,shade:number(v.shade,0,90,45),blur:number(v.blur,0,24,2),opacity:number(v.opacity,55,100,88),fit:v.fit==='contain'?'contain':'cover',paused:v.paused===true};
}
export function backgroundFormat(bytes:Uint8Array):{kind:'image'|'video';mime:string}|null{
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.subarray(start,end));
  if(bytes[0]===137&&ascii(1,4)==='PNG'&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return {kind:'image',mime:'image/png'};
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {kind:'image',mime:'image/jpeg'};
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return {kind:'image',mime:'image/webp'};
  if(['GIF87a','GIF89a'].includes(ascii(0,6)))return {kind:'image',mime:'image/gif'};
  if(ascii(4,8)==='ftyp')return {kind:'video',mime:'video/mp4'};
  if(bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3&&ascii(0,64).includes('webm'))return {kind:'video',mime:'video/webm'};
  return null;
}
