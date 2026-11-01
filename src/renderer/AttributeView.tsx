import { Input, SelectField } from './Fields.tsx';
import React from 'react';
import type { AttributeTemplate, CharacterAttributes } from '../shared/types.ts';
import { Icon } from './Icon.tsx';

export const blankAttributes = ():CharacterAttributes => ({templateId:null,values:{},versions:{}});
function Radar({template,attributes}:{template:AttributeTemplate;attributes:CharacterAttributes}) {
  const dims=template.dimensions.filter(d=>d.enabled), n=dims.length, values=attributes.values[template.id] ?? {};
  if (n<3 || n>10) return null;
  const point=(i:number,r:number)=>[160+Math.cos(-Math.PI/2+i*2*Math.PI/n)*r,147+Math.sin(-Math.PI/2+i*2*Math.PI/n)*r];
  const points=(r:number)=>dims.map((_,i)=>point(i,r).join(',')).join(' ');
  const ready=dims.every(d=>values[d.id]!=null), valid=ready && dims.every(d=>values[d.id]!>=d.min && values[d.id]!<=d.max);
  return <svg className="attribute-radar" viewBox="0 0 320 300" role="img" aria-label={`${template.name}属性雷达图${valid ? '' : '：'+(ready ? '数值超出范围' : '等待完整数值')}`}>
    {[.25,.5,.75,1].map(r=><polygon key={r} points={points(94*r)} className="radar-grid"/>)}
    {dims.map((d,i)=><path key={d.id} d={`M160 147 L${point(i,94).join(' ')}`} className="radar-grid"/>)}
    {valid ? <polygon points={dims.map((d,i)=>point(i,94*(values[d.id]!-d.min)/(d.max-d.min)).join(',')).join(' ')} className="radar-value"/>
      : <text x={160} y={150} textAnchor="middle" className="radar-placeholder">{ready ? '数值超出范围' : '等待填写属性'}</text>}
    {dims.map((d,i)=>{const [x,y]=point(i,122);return <text key={d.id} x={x} y={y} textAnchor="middle" dominantBaseline="middle"><title>{d.name}</title>{d.name.length>7 ? d.name.slice(0,6)+'…' : d.name}</text>;})}
  </svg>;
}

export function AttributeView({template,attributes}:{template:AttributeTemplate|undefined;attributes:CharacterAttributes}) {
  if (!template) return <div className="attribute-empty"><Icon name="radar"/><h3>用你自己的维度描述资料</h3><p>先配置模板，再填写数值属性。</p></div>;
  const dims=template.dimensions.filter(d=>d.enabled), values=attributes.values[template.id] ?? {}, chart=dims.length>=3 && dims.length<=10;
  return <div className={`attribute-summary ${chart ? 'with-radar' : ''}`}>
    {chart && <div className="attribute-chart"><Radar template={template} attributes={attributes}/><small>{dims.length} 维 · {dims.filter(d=>values[d.id]!=null).length} 项已填写</small></div>}
    <div className="attribute-bars">{dims.map(d=>{const v=values[d.id] ?? null, outside=v!==null && (v<d.min || v>d.max), percent=v===null ? 0 : Math.max(0,Math.min(100,(v-d.min)/(d.max-d.min)*100));return <div className="attribute-bar" key={d.id}>
      <div className="between"><span>{d.name}</span><strong className={outside ? 'attribute-warning' : ''}>{v===null ? '未填写' : `${v}${d.unit ? ' '+d.unit : ''}`}</strong></div>
      <div className="attribute-track"><span style={{width:`${percent}%`}}/></div><small>{d.min} — {d.max}{d.unit ? ` ${d.unit}` : ''}{outside && <span className="attribute-warning"> · 超出范围，原值保留</span>}</small>
    </div>;})}</div>
  </div>;
}

export function AttributeFields({templates,value,onChange}:{templates:AttributeTemplate[];value:CharacterAttributes;onChange:(next:CharacterAttributes)=>void}) {
  const template=templates.find(t=>t.id===value.templateId), bank=template ? value.values[template.id] ?? {} : {};
  const select=(id:string)=>onChange({...value,templateId:id || null,versions:{...value.versions,...(id ? {[id]:templates.find(t=>t.id===id)!.version} : {})}});
  return <div className="attribute-editor">
    <div className="field-section-head"><h3>属性数值</h3><p>留空为未定，0 为零。</p></div>
    <label className="editor-field"><span>使用的属性模板</span><SelectField value={value.templateId ?? ''} onValueChange={nextValue=>select(nextValue)}><option value="">暂不使用属性模板</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.dimensions.filter(d=>d.enabled).length} 维</option>)}</SelectField></label>
    {!templates.length && <div className="note-box">尚无数值模板。</div>}
    {template && <><div className="attribute-value-grid">{template.dimensions.filter(d=>d.enabled).map(d=>{const v=bank[d.id] ?? null, outside=v!==null && (v<d.min || v>d.max);return <label key={`${template.id}-${d.id}`} className="editor-field"><span>{d.name}{d.unit && ` / ${d.unit}`}</span><Input type="number" step="any" placeholder="未填写" value={v ?? ''} aria-label={`属性 ${d.name}`} aria-describedby={`range-${d.id}`} onChange={e=>onChange({...value,values:{...value.values,[template.id]:{...bank,[d.id]:e.target.value==='' ? null : Number(e.target.value)}}})}/><small id={`range-${d.id}`} className={outside ? 'attribute-warning' : ''}>{d.min} — {d.max}{outside ? ' · 超出范围，旧值不会自动改写' : ''}</small></label>;})}</div>
      <details className="attribute-live-preview"><summary>查看属性图表</summary><AttributeView template={template} attributes={value}/></details></>}
    <p className="attribute-hint">切换模板或停用维度会保留已填数值。</p>
  </div>;
}
