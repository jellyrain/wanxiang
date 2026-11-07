export type ThemeId = 'ink'|'paper'|'ocean'|'plum'|'sakura'|'mint'|'lilac'|'sunset'|'neon'|'starry';
export type PaletteId = 'default'|'latte'|'frappe'|'macchiato'|'mocha'|'rose-pine'|'rose-moon'|'rose-dawn'|'nord'|'everforest-dark'|'everforest-light';
export type ThemeMode = 'light'|'dark'|'system';
export type ThemeToken = 'background'|'text'|'surface'|'accent'|'muted'|'border'|'sidebar'|'danger';
export interface ThemePreferences {
  palette: PaletteId;
  mode: ThemeMode;
  darkness: 'soft'|'oled';
  accent: string;
  scope: 'global'|'sidebar';
  sidebar: 'follow'|'panel'|'tinted';
  font: 'default'|'system'|'rounded'|'serif'|'custom';
  mono: 'default'|'system'|'custom';
  customFont: string;
  customMono: string;
  radius: 'small'|'normal'|'comfortable'|'round';
  scale: number;
  density: 'comfortable'|'compact';
  colors: Partial<Record<ThemeToken,string>>;
}
export type ThemePatch = Partial<Omit<ThemePreferences,'colors'>> & {colors?:Partial<Record<ThemeToken,string|null>>|null};

// Theme catalog
export const DEFAULT_THEME: ThemePreferences = {
  palette:'default', mode:'system', darkness:'soft', accent:'#8561bd', scope:'global',
  sidebar:'follow', font:'default', mono:'default', customFont:'', customMono:'',
  radius:'comfortable', scale:100, density:'comfortable', colors:{}
};

interface Palette {
  name:string; mode:'light'|'dark'; background:string; surface:string; text:string; muted:string; accent:string;
}
export const PALETTES = {
  default: {name:'默认',mode:'light',background:'#f8f8fa',surface:'#ffffff',text:'#242329',muted:'#64616b',accent:'#8561bd'},
  latte: {name:'Latte',mode:'light',background:'#eff1f5',surface:'#e6e9ef',text:'#4c4f69',muted:'#626680',accent:'#8839ef'},
  frappe: {name:'Frappé',mode:'dark',background:'#303446',surface:'#363a4f',text:'#c6d0f5',muted:'#a5adce',accent:'#ca9ee6'},
  macchiato: {name:'Macchiato',mode:'dark',background:'#24273a',surface:'#303347',text:'#cad3f5',muted:'#a5adcb',accent:'#c6a0f6'},
  mocha: {name:'Mocha',mode:'dark',background:'#1e1e2e',surface:'#29293b',text:'#cdd6f4',muted:'#a6adc8',accent:'#cba6f7'},
  'rose-pine': {name:'Rosé Pine',mode:'dark',background:'#191724',surface:'#1f1d2e',text:'#e0def4',muted:'#aca8c3',accent:'#c4a7e7'},
  'rose-moon': {name:'Rosé Pine Moon',mode:'dark',background:'#232136',surface:'#2a273f',text:'#e0def4',muted:'#ada8c7',accent:'#ea9a97'},
  'rose-dawn': {name:'Rosé Pine Dawn',mode:'light',background:'#faf4ed',surface:'#fffaf3',text:'#575279',muted:'#706b85',accent:'#907aa9'},
  nord: {name:'Nord',mode:'dark',background:'#2e3440',surface:'#3b4252',text:'#eceff4',muted:'#bcc7d6',accent:'#88c0d0'},
  'everforest-dark': {name:'Everforest 暗',mode:'dark',background:'#2d353b',surface:'#343f44',text:'#d3c6aa',muted:'#aab5a0',accent:'#a7c080'},
  'everforest-light': {name:'Everforest 亮',mode:'light',background:'#f3efda',surface:'#fffbea',text:'#4f5e5b',muted:'#62706a',accent:'#68803b'}
} as const satisfies Record<PaletteId,Palette>;
const DEFAULT_DARK: Palette = {name:'默认',mode:'dark',background:'#18181b',surface:'#202023',text:'#f1f0f3',muted:'#aaa7b1',accent:'#bda5ef'};
export const ACCENTS = [
  ['薰衣草','#8561bd'], ['天蓝','#38bdf8'], ['靛蓝','#3b82f6'], ['紫罗兰','#8b5cf6'],
  ['玫瑰','#f43f5e'], ['翡翠','#10b981'], ['琥珀','#f59e0b'], ['夕橙','#f97316']
] as const;
export const THEME_TOKENS: Record<ThemeToken,string> = {
  background:'页面背景',text:'主文字',surface:'卡片背景',accent:'主色调',muted:'次要文字',border:'边框',sidebar:'侧栏背景',danger:'危险 / 错误'
};
const legacyThemes: Record<ThemeId,Partial<ThemePreferences>> = {
  ink:{mode:'dark',accent:'#b69a60'},paper:{mode:'light',palette:'rose-dawn',accent:'#866431'},
  ocean:{mode:'dark',palette:'nord',accent:'#74b6c7'},plum:{mode:'dark',palette:'rose-moon',accent:'#b78bb0'},
  sakura:{mode:'light',accent:'#b4507b'},mint:{mode:'light',accent:'#36816a'},
  lilac:{mode:'light',accent:'#8561bd'},sunset:{mode:'dark',accent:'#d28c61'},
  neon:{mode:'dark',palette:'mocha',accent:'#d584bd'},starry:{mode:'dark',palette:'macchiato',accent:'#8996dc'}
};
export function isTheme(value:unknown): value is ThemeId {
  return typeof value==='string' && Object.hasOwn(legacyThemes,value);
}
export function legacyPreferences(id:ThemeId): ThemePreferences {
  return {...DEFAULT_THEME,...legacyThemes[id],colors:{}};
}
const choices = {
  palette:Object.keys(PALETTES), mode:['light','dark','system'], darkness:['soft','oled'],
  scope:['global','sidebar'], sidebar:['follow','panel','tinted'], font:['default','system','rounded','serif','custom'],
  mono:['default','system','custom'], radius:['small','normal','comfortable','round'], density:['comfortable','compact']
};
export const isHexColor=(v:unknown):v is string=>typeof v==='string' && /^#[0-9a-f]{6}$/i.test(v);
export function isFontName(v:unknown):v is string {
  return typeof v==='string' && v.length<=80 && /^[\p{L}\p{N} _.-]*$/u.test(v);
}
function isObject(v:unknown):v is Record<string,unknown> {
  return typeof v==='object' && v!==null && !Array.isArray(v);
}
export function mergeTheme(current:ThemePreferences,patch:unknown):ThemePreferences|null {
  if(!isObject(patch))return null;
  const next={...current,colors:{...current.colors}};
  for(const [key,value] of Object.entries(patch)){
    if(Object.hasOwn(choices,key)){
      if(typeof value!=='string'||!choices[key as keyof typeof choices].includes(value))return null;
      Object.assign(next,{[key]:value});
    }else if(key==='scale'){
      if(typeof value!=='number'||!Number.isInteger(value)||value<80||value>125)return null;
      next.scale=value;
    }else if(key==='accent'){
      if(!isHexColor(value))return null;
      next.accent=value.toLowerCase();
    }else if(key==='customFont'||key==='customMono'){
      if(!isFontName(value))return null;
      next[key]=value.trim();
    }else if(key==='colors'){
      if(value===null){next.colors={};continue;}
      if(!isObject(value))return null;
      for(const [token,color] of Object.entries(value)){
        if(!Object.hasOwn(THEME_TOKENS,token))return null;
        if(color===null)delete next.colors[token as ThemeToken];
        else if(isHexColor(color))next.colors[token as ThemeToken]=color.toLowerCase();
        else return null;
      }
    }else return null;
  }
  if((next.font==='custom'&&!next.customFont)||(next.mono==='custom'&&!next.customMono))return null;
  return next;
}

function rgb(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
export function mix(a:string,b:string,portion:number){
  const other=rgb(b);
  return '#'+rgb(a).map((n,i)=>Math.round(n+(other[i]-n)*portion).toString(16).padStart(2,'0')).join('');
}
function luminance(hex:string){
  const [r,g,b]=rgb(hex).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*r+.7152*g+.0722*b;
}
function contrast(a:string,b:string){
  const x=luminance(a)+.05,y=luminance(b)+.05;
  return Math.max(x,y)/Math.min(x,y);
}
export function onColor(color:string){return luminance(color)>.179?'#000000':'#ffffff';}
function readable(color:string,surface:string){
  let result=color;
  for(let i=0;i<12&&contrast(result,surface)<4.5;i++)result=mix(result,onColor(surface),.12);
  return result;
}
export function resolveTheme(p:ThemePreferences,systemDark:boolean){
  const named=PALETTES[p.palette];
  const dark=p.palette==='default'?(p.mode==='system'?systemDark:p.mode==='dark'):named.mode==='dark';
  const base=p.palette==='default'&&dark?DEFAULT_DARK:named;
  const accentSeed=p.scope==='global'?p.accent:DEFAULT_THEME.accent;
  const tint=(color:string,amount:number)=>p.palette==='default'?mix(color,accentSeed,amount):color;
  const bg=p.colors.background??(dark&&p.darkness==='oled'?'#000000':tint(base.background,.035));
  const surface=p.colors.surface??tint(base.surface,.025);
  const text=p.colors.text??base.text;
  const accent=p.colors.accent??readable(dark?mix(accentSeed,'#ffffff',.43):accentSeed,surface);
  const sideBase=p.sidebar==='panel'?'#f5f4f8':bg;
  const sidebar=p.colors.sidebar??mix(sideBase,p.accent,p.sidebar==='tinted'?.21:p.sidebar==='panel'?0:.045);
  const sideAccent=readable(p.scope==='sidebar'?p.accent:accent,sidebar);
  const muted=p.colors.muted??base.muted;
  const border=p.colors.border??mix(surface,text,dark?.14:.16);
  const danger=p.colors.danger??(dark?'#f4a6b4':'#a4334f');
  return {dark,background:bg,text,surface,muted,accent,border,sidebar,danger,sideAccent,
    sideText:readable(p.sidebar==='panel'?'#27232c':text,sidebar),sideMuted:readable(p.sidebar==='panel'?'#635d6a':muted,sidebar),
    raised:mix(surface,text,.065),dim:readable(mix(surface,muted,.85),surface),
    onAccent:onColor(accent),success:dark?'#91ceb3':'#29684d'};
}
