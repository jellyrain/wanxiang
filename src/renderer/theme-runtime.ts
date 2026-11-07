import {useLayoutEffect,useSyncExternalStore} from 'react';
import {DEFAULT_THEME,mergeTheme,mix,resolveTheme,type ThemePreferences} from '../shared/themes.ts';

const scheme=matchMedia('(prefers-color-scheme: dark)');
const subscribe=(update:()=>void)=>{
  scheme.addEventListener('change',update);
  return ()=>scheme.removeEventListener('change',update);
};
const cacheKey='wanxiang.theme.preferences';
const defaultSans='"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif';
const defaultSerif='"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif';
const defaultMono='ui-monospace,"Cascadia Mono",Consolas,monospace';
function apply(p:ThemePreferences,systemDark:boolean){
  const root=document.documentElement,theme=resolveTheme(p,systemDark);
  const sans={default:defaultSans,system:'system-ui,sans-serif',rounded:'ui-rounded,"Microsoft YaHei UI",sans-serif',serif:defaultSerif,custom:'"'+p.customFont+'",'+defaultSans}[p.font];
  const mono={default:defaultMono,system:'monospace',custom:'"'+p.customMono+'",'+defaultMono}[p.mono];
  const radius={small:4,normal:7,comfortable:10,round:16}[p.radius];
  const vars={
    bg:theme.background,sidebar:theme.sidebar,surface:theme.surface,raised:theme.raised,line:theme.border,text:theme.text,
    muted:theme.muted,dim:theme.dim,gold:theme.accent,accent:theme.accent,'gold-dim':mix(theme.accent,theme.surface,.18),
    'on-accent':theme.onAccent,'accent-soft':mix(theme.surface,theme.accent,theme.dark?.15:.10),
    mint:theme.success,red:theme.danger,'success-soft':mix(theme.surface,theme.success,.12),
    'error-soft':mix(theme.surface,theme.danger,.13),'error-line':mix(theme.border,theme.danger,.55),'error-text':theme.danger,
    input:theme.background,button:theme.raised,'button-hover':mix(theme.raised,theme.accent,.12),
    'image-accent':mix(theme.accent,'#ffffff',.65),'side-accent':theme.sideAccent,
    'side-selection':mix(theme.sidebar,theme.sideAccent,theme.dark?.22:.14),
    'side-text':theme.sideText,'side-muted':theme.sideMuted,
    'side-line':mix(theme.sidebar,theme.sideAccent,.19),'side-surface':mix(theme.sidebar,theme.sideAccent,.065),
    sans,serif:p.font==='default'?defaultSerif:sans,mono,radius:radius+'px','control-radius':Math.max(3,radius-3)+'px',
    'ui-scale':String(p.scale/100)
  };
  for(const [name,value] of Object.entries(vars))root.style.setProperty('--'+name,value);
  root.style.colorScheme=theme.dark?'dark':'light';
  root.dataset.colorMode=theme.dark?'dark':'light';
  root.dataset.palette=p.palette;
  root.dataset.density=p.density;
}
export function initializeTheme(){
  let initial=DEFAULT_THEME;
  try{initial=mergeTheme(DEFAULT_THEME,JSON.parse(localStorage.getItem(cacheKey)??'null'))??DEFAULT_THEME;}catch{}
  apply(initial,scheme.matches);
}
export function useTheme(preferences:ThemePreferences|undefined,legacyId:string|undefined){
  const systemDark=useSyncExternalStore(subscribe,()=>scheme.matches);
  useLayoutEffect(()=>{
    if(!preferences)return;
    apply(preferences,systemDark);
    document.documentElement.dataset.theme=legacyId;
    try{localStorage.setItem(cacheKey,JSON.stringify(preferences));}catch{}
  },[preferences,systemDark,legacyId]);
  return resolveTheme(preferences??DEFAULT_THEME,systemDark);
}
