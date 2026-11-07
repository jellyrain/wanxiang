export const BACKGROUND_GRADIENTS = {
  aurora:{name:'极光',css:'linear-gradient(135deg,#293a68,#42899b 55%,#a9d8ba)'},
  dusk:{name:'暮色',css:'linear-gradient(140deg,#352d50,#876d9d 60%,#e6afb2)'},
  forest:{name:'森野',css:'linear-gradient(135deg,#254c42,#64836c 55%,#b8bf92)'},
  sand:{name:'暖砂',css:'linear-gradient(125deg,#ac7967,#dec2a3 55%,#f4e5d3)'}
} as const;
export interface BackgroundSettings {type:'none'|'solid'|'gradient'|'media';solid:string;gradient:keyof typeof BACKGROUND_GRADIENTS;enabled:boolean;shade:number;blur:number;opacity:number;fit:'cover'|'contain';paused:boolean}
export interface BackgroundMedia {kind:'image'|'video';name:string;blob:Blob}
export const DEFAULT_BACKGROUND:BackgroundSettings={type:'none',solid:'#363044',gradient:'dusk',enabled:true,shade:45,blur:2,opacity:88,fit:'cover',paused:false};
export const BACKGROUND_IMAGE_LIMIT=25*1024**2,BACKGROUND_VIDEO_LIMIT=200*1024**2;
export function backgroundSettings(value:unknown,hasMedia=false):BackgroundSettings{
  const v=(value&&typeof value==='object'?value:{}) as Partial<BackgroundSettings>;
  const number=(n:unknown,min:number,max:number,fallback:number)=>typeof n==='number'&&Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
  const type=v.type&&['none','solid','gradient','media'].includes(v.type)?v.type:(hasMedia?'media':'none');
  return {type,solid:typeof v.solid==='string'&&/^#[0-9a-f]{6}$/i.test(v.solid)?v.solid:DEFAULT_BACKGROUND.solid,gradient:v.gradient&&Object.hasOwn(BACKGROUND_GRADIENTS,v.gradient)?v.gradient:'dusk',enabled:typeof v.enabled==='boolean'?v.enabled:true,shade:number(v.shade,0,90,45),blur:number(v.blur,0,24,2),opacity:number(v.opacity,55,100,88),fit:v.fit==='contain'?'contain':'cover',paused:v.paused===true};
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
