import React from 'react';
import type { AttributeTemplate, Character } from '../shared/types.ts';
import { profileOf, resolveForms } from '../shared/journey.ts';
import { CharacterImage } from './CharacterImage.tsx';
import { TagBadge } from './TagManager.tsx';
import { Icon } from './Icon.tsx';

export function CharacterCard({character:c,index,templates,onOpen}:{character:Character;index:number;templates:AttributeTemplate[];onOpen:()=>void}) {
  const forms=resolveForms(profileOf(c),c.forms,templates),form=forms.find(f=>f.id===c.defaultFormId)??forms[0];
  return <button className="cast-card" onClick={onOpen} aria-label={`查看${c.name}档案`}>
    <CharacterImage character={{name:c.name,portraitId:form.portraitId,portraitWidth:form.portraitWidth}}/>
    <div className="card-top"><span className="tag green">{c.archived?'已归档':c.status||'草稿'}</span><span className="label">角色 {String(index+1).padStart(2,'0')}</span></div>
    <div className="card-bottom"><div className="subtitle">{c.caption}</div><h2>{c.name}</h2><p>{c.intro}</p><div className="chip-row">{c.tags.map(tag=><TagBadge key={tag.id} tag={tag}/>)}</div><span className="entry-arrow"><Icon name="arrow"/></span></div>
  </button>;
}
