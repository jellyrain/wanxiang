import React,{useState} from 'react';
import {ACCENTS,DEFAULT_THEME,PALETTES,THEME_TOKENS,onColor,resolveTheme,type PaletteId,type ThemePreferences,type ThemeToken} from '../shared/themes.ts';
import {BackgroundControls,type AppearanceController} from './Appearance.tsx';
import {Choices,FontChoice,type ChangeTheme} from './ThemeControls.tsx';
import {Icon} from './Icon.tsx';
import {Input} from './Fields.tsx';

function Section({title,icon,children}:{title:string;icon:string;children:React.ReactNode}){
  return <section className="appearance-section"><h2><Icon name={icon}/>{title}</h2><div>{children}</div></section>;
}
function PaletteChoices({p,change}:{p:ThemePreferences;change:ChangeTheme}){
  return <div className="palette-grid" role="group" aria-label="配色方案">
    {(Object.entries(PALETTES) as [PaletteId,(typeof PALETTES)[PaletteId]][]).map(([id,palette])=>
      <button key={id} className="palette-choice" type="button" aria-pressed={id===p.palette} aria-label={palette.name} onClick={()=>change({palette:id})}>
        <span className="palette-sample" aria-hidden="true" style={{background:palette.background}}>
          <span style={{background:palette.surface}}><i style={{background:palette.accent}}/><i style={{background:palette.mode==='dark'?'#98bdad':'#69a48e'}}/><i style={{background:palette.mode==='dark'?'#dc9aac':'#bd798e'}}/></span>
        </span><span>{palette.name}</span>
      </button>)}
  </div>;
}
function ScaleControl({scale,change}:{scale:number;change:ChangeTheme}){
  const [preview,setPreview]=useState<number|null>(null);
  function commit(value:number){setPreview(null);if(value!==scale)change({scale:value});}
  return <label className="theme-row scale-control"><span>界面缩放</span>
    <Input type="range" min={80} max={125} step={5} aria-label="界面缩放" value={preview??scale}
      onChange={e=>setPreview(Number(e.target.value))} onPointerUp={e=>commit(Number(e.currentTarget.value))}
      onKeyUp={e=>commit(Number(e.currentTarget.value))} onBlur={e=>{if(preview!==null)commit(Number(e.currentTarget.value));}}/>
    <output>{preview??scale}%</output></label>;
}
export function AppearanceSettings({p,dark,appearance,change}:{p:ThemePreferences;dark:boolean;appearance:AppearanceController;change:ChangeTheme}){
  const preset=ACCENTS.some(([,color])=>color===p.accent);
  const effective=resolveTheme(p,dark);
  const tokenVars:Record<ThemeToken,string>={background:'--bg',text:'--text',surface:'--surface',accent:'--gold',muted:'--muted',border:'--line',sidebar:'--sidebar',danger:'--red'};
  return <div className="appearance-settings">
    <Section title="主题" icon="sun">
      <div className="palette-field"><h3>配色方案</h3><PaletteChoices p={p} change={change}/></div>
      <Choices label="显示模式" value={p.palette==='default'?p.mode:PALETTES[p.palette].mode} options={['light','dark','system']} labels={['浅色','深色','跟随系统']} disabled={p.palette!=='default'} onChange={mode=>change({mode})}/>
      {p.palette!=='default'&&<p className="theme-hint">此配色自带{dark?'深':'浅'}色外观。选择默认配色可切换显示模式。</p>}
      {dark&&<Choices label="深色强度" value={p.darkness} options={['soft','oled']} labels={['柔和','纯黑（OLED）']} onChange={darkness=>change({darkness})}/>}
    </Section>
    <Section title="强调色" icon="palette">
      <div className="theme-row accent-row"><span>预设色</span><div className="accent-options" role="group" aria-label="强调色">
        {ACCENTS.map(([label,color])=><button key={color} aria-label={label} title={label} aria-pressed={p.accent===color} style={{backgroundColor:color,color:onColor(color)}} onClick={()=>change({accent:color})}>{p.accent===color&&<Icon name="check"/>}</button>)}
        <label className={'custom-accent'+(preset?'':' selected')} title="自定义强调色" style={preset?undefined:{background:p.accent,color:onColor(p.accent)}}>
          {!preset&&<Icon name="check"/>}<Input type="color" aria-label="自定义强调色" value={p.accent} onChange={e=>change({accent:e.target.value})}/>
        </label>
      </div></div>
      <Choices label="应用范围" value={p.scope} options={['global','sidebar']} labels={['全局','仅侧栏']} onChange={scope=>change({scope})}/>
      <Choices label="侧栏样式" value={p.sidebar} options={['follow','panel','tinted']} labels={['跟随背景','浅色面板','强调色']} onChange={sidebar=>change({sidebar})}/>
    </Section>
    <Section title="背景" icon="image"><BackgroundControls appearance={appearance}/></Section>
    <Section title="排版与界面" icon="sliders">
      <FontChoice p={p} change={change}/><FontChoice mono p={p} change={change}/>
      <Choices label="圆角" value={p.radius} options={['small','normal','comfortable','round']} labels={['紧凑','默认','舒适','圆润']} onChange={radius=>change({radius})}/>
      <ScaleControl scale={p.scale} change={change}/>
      <Choices label="显示密度" value={p.density} options={['comfortable','compact']} labels={['舒适','紧凑']} onChange={density=>change({density})}/>
    </Section>
    <Section title="主题微调" icon="palette">
      {(Object.entries(THEME_TOKENS) as [ThemeToken,string][]).map(([key,label])=>
        <div className="theme-row token-row" key={key}><span>{label}</span><div>
          <small>{p.colors[key]??'默认'}</small><label className="token-color" style={{background:'var('+tokenVars[key]+')'}}>
          <Input type="color" aria-label={label+'颜色'} value={effective[key]} onChange={e=>change({colors:{[key]:e.target.value}})}/></label>
          <button className="icon-button" aria-label={'恢复'+label} title={'恢复'+label} disabled={!p.colors[key]} onClick={()=>change({colors:{[key]:null}})}><Icon name="undo"/></button>
        </div></div>)}
    </Section>
    <div className="theme-reset"><button className="btn" onClick={()=>change({...DEFAULT_THEME,colors:null})}><Icon name="undo"/>恢复默认主题</button></div>
  </div>;
}
