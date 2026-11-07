import React,{useEffect,useState} from 'react';
import {Input} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {isFontName,type ThemeMode,type ThemePatch,type ThemePreferences} from '../shared/themes.ts';

export function Choices<T extends string>({label,value,options,labels,disabled,onChange}:{
  label:string; value:T; options:readonly T[]; labels:readonly string[]; disabled?:boolean; onChange:(value:T)=>void;
}){
  return <div className="theme-row">
    <span>{label}</span><div className="theme-segments" role="group" aria-label={label}>
      {options.map((id,i)=><button type="button" key={id} disabled={disabled} aria-pressed={value===id} onClick={()=>onChange(id)}>{labels[i]}</button>)}
    </div>
  </div>;
}
export const modeLabels:Record<ThemeMode,string>={system:'跟随系统',light:'浅色',dark:'深色'};
export function QuickModes({mode,locked,onChange}:{mode:ThemeMode;locked:boolean;onChange:(mode:ThemeMode)=>void}){
  const icons={system:'monitor',light:'sun',dark:'moon'};
  return <div className="quick-modes" role="group" aria-label="快速切换显示模式">
    {(Object.keys(modeLabels) as ThemeMode[]).map(key=><button key={key} aria-label={modeLabels[key]} title={locked?'命名配色已固定明暗':modeLabels[key]} aria-pressed={!locked&&mode===key} disabled={locked} onClick={()=>onChange(key)}><Icon name={icons[key]}/></button>)}
  </div>;
}
export type ChangeTheme=(patch:ThemePatch)=>void;

export function FontChoice({mono=false,p,change}:{mono?:boolean;p:ThemePreferences;change:ChangeTheme}){
  const label=mono?'等宽字体':'界面字体';
  const saved=mono?p.customMono:p.customFont;
  const [draft,setDraft]=useState(saved),[error,setError]=useState('');
  useEffect(()=>{setDraft(saved);setError('');},[saved]);
  function save(){
    const name=draft.trim();
    if(!name||!isFontName(name)){setError('请填写有效的本机字体名称。');return;}
    setError('');
    if(name!==saved)change(mono?{customMono:name}:{customFont:name});
  }
  return <div>
    {mono?<Choices label={label} value={p.mono} options={['default','system','custom']} labels={['默认等宽','平台等宽','自定义']} onChange={mono=>change(mono==='custom'?{mono,customMono:saved||'Consolas'}:{mono})}/>:
      <Choices label={label} value={p.font} options={['default','system','rounded','serif','custom']} labels={['默认','平台原生','圆润','衬线','自定义']} onChange={font=>change(font==='custom'?{font,customFont:saved||'Microsoft YaHei'}:{font})}/>}
    {(mono?p.mono:p.font)==='custom'&&<label className="theme-row theme-font-name"><span>本机字体名称</span>
      <Input aria-label={label+'名称'} value={draft} maxLength={80} onChange={e=>setDraft(e.target.value)} onBlur={save} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
    </label>}
    {error&&<p role="alert" className="inline-error">{error}</p>}
  </div>;
}
