import React,{useEffect,useRef,useState} from 'react';
import {BACKGROUND_GRADIENTS,backgroundSettings,DEFAULT_BACKGROUND,type BackgroundMedia,type BackgroundSettings} from '../shared/appearance.ts';
import {loadAppearance,prepareBackground,saveAppearance} from './appearance-storage.ts';
import {CheckField,Input,SelectField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {Choices} from './ThemeControls.tsx';

export function useAppearance(){
  const [settings,setSettings]=useState({...DEFAULT_BACKGROUND}),[media,setMedia]=useState<BackgroundMedia|null>(null),[url,setUrl]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const current=useRef({settings,media}),saved=useRef({settings,media}),queue=useRef(Promise.resolve()),pending=useRef(0);
  useEffect(()=>{let alive=true;void loadAppearance().then(value=>{if(alive){current.current=saved.current=value;setSettings(value.settings);setMedia(value.media);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setReady(true);});return()=>{alive=false;};},[]);
  useEffect(()=>{if(!media){setUrl('');return;}const next=URL.createObjectURL(media.blob);setUrl(next);return()=>URL.revokeObjectURL(next);},[media]);
  const commit=(next:BackgroundSettings,nextMedia:BackgroundMedia|null)=>{
    current.current={settings:next,media:nextMedia};setSettings(next);setMedia(nextMedia);setError('');pending.current++;setBusy(true);
    const operation=queue.current.then(()=>saveAppearance(next,nextMedia)).then(()=>{saved.current={settings:next,media:nextMedia};});queue.current=operation.catch(()=>{});
    return operation.catch(e=>{if(current.current.settings===next){current.current=saved.current;setSettings(saved.current.settings);setMedia(saved.current.media);}setError(e.message);throw e;}).finally(()=>{pending.current--;if(!pending.current)setBusy(false);});
  };
  const change=(patch:Partial<BackgroundSettings>)=>commit(backgroundSettings({...current.current.settings,...patch}),current.current.media).catch(()=>{});
  const choose=async(file:File)=>{setBusy(true);setError('');try{const next=await prepareBackground(file);await commit({...current.current.settings,type:'media',enabled:true},next);}catch(e){setError((e as Error).message);}finally{if(!pending.current)setBusy(false);}};
  const remove=()=>commit({...DEFAULT_BACKGROUND},null).catch(()=>{});
  return {settings,media,url,ready,busy,error,change,choose,remove,reset:()=>change({shade:DEFAULT_BACKGROUND.shade,blur:DEFAULT_BACKGROUND.blur,opacity:DEFAULT_BACKGROUND.opacity,fit:'cover',paused:false}),clearError:()=>setError(''),setError};
}
export type AppearanceController=ReturnType<typeof useAppearance>;
export function Background({appearance:a}:{appearance:AppearanceController}){
  const video=useRef<HTMLVideoElement>(null),[hidden,setHidden]=useState(document.hidden),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),[failed,setFailed]=useState(false);
  useEffect(()=>{const visibility=()=>setHidden(document.hidden),query=matchMedia('(prefers-reduced-motion: reduce)'),motion=()=>setReduced(query.matches);document.addEventListener('visibilitychange',visibility);query.addEventListener('change',motion);return()=>{document.removeEventListener('visibilitychange',visibility);query.removeEventListener('change',motion);};},[]);
  useEffect(()=>setFailed(false),[a.url]);
  const mediaActive=a.settings.type==='media'&&Boolean(a.url)&&!failed;
  const active=a.settings.enabled&&(mediaActive||a.settings.type==='solid'||a.settings.type==='gradient'),paused=a.settings.paused||hidden||reduced;
  useEffect(()=>{const root=document.documentElement;root.dataset.wallpaper=String(active);root.style.setProperty('--panel-opacity',`${a.settings.opacity}%`);return()=>{delete root.dataset.wallpaper;root.style.removeProperty('--panel-opacity');};},[active,a.settings.opacity]);
  useEffect(()=>{const element=video.current;if(!element)return;if(paused||!active)element.pause();else void element.play().catch(()=>{a.setError('背景视频未能自动播放，可在背景设置中暂停后再播放。');});},[active,mediaActive,paused,a.url]);
  if(!active)return null;
  if(a.settings.type==='solid'||a.settings.type==='gradient'){
    const background=a.settings.type==='solid'?a.settings.solid:BACKGROUND_GRADIENTS[a.settings.gradient].css;
    return <div className="app-background" style={{background}} aria-hidden="true"/>;
  }
  const style:React.CSSProperties={objectFit:a.settings.fit,filter:`blur(${a.settings.blur}px)`,transform:a.settings.blur?'scale(1.06)':undefined};
  const fail=()=>{setFailed(true);a.setError('背景文件无法播放，已暂时使用纯色主题。请重新选择背景。');};
  return <div className="app-background" aria-hidden="true">{a.media?.kind==='video'?<video ref={video} src={a.url} style={style} muted loop playsInline preload="auto" onError={fail}/>:<img src={a.url} alt="" style={style} onError={fail}/>}<div style={{opacity:a.settings.shade/100}}/></div>;
}
export function BackgroundControls({appearance:a}:{appearance:AppearanceController}){
  const busy=a.busy, type=a.settings.type;
  return <div className="background-settings">
    <Choices label="背景类型" value={type} options={['none','solid','gradient','media']} labels={['无','纯色','渐变','图片 / 视频']} disabled={busy||!a.ready} onChange={type=>void a.change({type,enabled:true})}/>
    {type==='solid'&&<label className="theme-row"><span>背景颜色</span><Input aria-label="背景颜色" type="color" value={a.settings.solid} onChange={e=>void a.change({solid:e.target.value})}/></label>}
    {type==='gradient'&&<div className="gradient-options">{Object.entries(BACKGROUND_GRADIENTS).map(([key,g])=><button key={key} aria-pressed={a.settings.gradient===key} onClick={()=>void a.change({gradient:key as keyof typeof BACKGROUND_GRADIENTS})}><i style={{background:g.css}}/>{g.name}</button>)}</div>}
    {type==='media'&&<>        <div className="background-preview">{a.url?(a.media?.kind==='video'?<video src={a.url} muted playsInline preload="metadata"/>:<img src={a.url} alt="当前背景"/>):<div><Icon name="image"/><span>选择你的壁纸或动态背景</span></div>}</div>
        <div className="background-file-row"><div><strong>{a.media?.name??'尚未设置背景'}</strong><small>图片 ≤ 25 MB · 视频 ≤ 200 MB</small></div><label className={'btn primary background-file '+(!a.ready||busy?'disabled':'')}><Icon name="folder"/>{a.media?'更换文件':'选择文件'}<input aria-label="选择背景文件" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.webm" disabled={!a.ready||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void a.choose(file);}}/></label>{a.media&&<button className="btn" disabled={busy} onClick={()=>void a.remove()}>移除</button>}</div>
        <p className="appearance-local-note">背景仅保存在此设备，不随作品导出。视频静音循环。</p>
        <fieldset disabled={!a.ready||!a.media} className="background-controls"><label className="backup-toggle"><CheckField aria-label="显示背景" checked={a.settings.enabled} disabled={!a.media||busy} onCheckedChange={enabled=>void a.change({enabled})}/>显示背景</label>{a.media?.kind==='video'&&<label className="backup-toggle"><CheckField aria-label="暂停背景视频" checked={a.settings.paused} disabled={busy} onCheckedChange={paused=>void a.change({paused})}/>暂停视频</label>}
          <label className="background-fit"><span>画面适配</span><SelectField aria-label="背景画面适配" value={a.settings.fit} disabled={!a.media||busy} onValueChange={fit=>void a.change({fit:fit as 'cover'|'contain'})}><option value="cover">铺满窗口</option><option value="contain">完整显示</option></SelectField></label>
          {([['shade','遮罩强度',0,90,'%'],['blur','背景模糊',0,24,'px'],['opacity','面板不透明度',55,100,'%']] as const).map(([key,label,min,max,unit])=><label className="background-range" key={key}><span>{label}<output>{a.settings[key]}{unit}</output></span><Input type="range" aria-label={label} min={min} max={max} step={1} value={a.settings[key]} onChange={e=>void a.change({[key]:Number(e.target.value)})}/></label>)}
        </fieldset></>}
    {type!=='media' && type!=='none'&&<label className="background-range"><span>面板不透明度<output>{a.settings.opacity}%</output></span><Input type="range" aria-label="面板不透明度" min={55} max={100} value={a.settings.opacity} onChange={e=>void a.change({opacity:Number(e.target.value)})}/></label>}
    {type==='media' && a.media&&<div className="background-actions"><button className="text-link" disabled={busy} onClick={()=>void a.reset()}>恢复背景参数</button></div>}
    {a.error&&<p className="inline-error" role="alert">{a.error}</p>}
  </div>;
}
