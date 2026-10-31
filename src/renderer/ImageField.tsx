import React,{useState} from 'react';
import {LibraryImageButton,MediaImage} from './AssetPicker.tsx';

export function ImageField({worldId,label,value,onChange,onBusyChange}:{worldId:string;label:string;value:string|null;onChange:(id:string|null)=>void;onBusyChange?:(busy:boolean)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pick=async()=>{setBusy(true);onBusyChange?.(true);setError('');try{const r=await window.studio!.pickPortrait(worldId);if(!r.ok)throw Error(r.error.message);if(r.value)onChange(r.value.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusyChange?.(false);}};
  return <section className="image-field"><div><h3>{label}</h3><p>{label.includes('设定')?'保存完整造型、结构与细节参考。':'用于卡片展示与近景细节。'}</p></div>{value?<MediaImage id={value} name={label}/>:<div className="image-field-empty">尚未选择{label}</div>}<div className="row wrap"><button type="button" className="btn small" disabled={busy} onClick={()=>void pick()}>{busy?'正在导入…':'选择'+label}</button><LibraryImageButton worldId={worldId} disabled={busy} onChoose={a=>onChange(a.id)}/>{value&&<button type="button" className="text-link" disabled={busy} onClick={()=>onChange(null)}>移除{label}关联</button>}</div>{error&&<p role="alert">{error}</p>}</section>;
}
