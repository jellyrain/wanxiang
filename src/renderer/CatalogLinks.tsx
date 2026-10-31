import React from 'react';
import type {CatalogKind,LibrarySnapshot} from '../shared/types.ts';
import {itemTypes,holdingStates,practiceStates} from '../shared/catalogs.ts';
export function CharacterCatalogLinks({library,characterId,onOpen}:{library:LibrarySnapshot;characterId:string;onOpen:(kind:CatalogKind,id:string)=>void}){
  const rows=[...library.items.filter(r=>r.holders.some(h=>h.characterId===characterId)),...library.techniques.filter(r=>r.practitioners.some(p=>p.characterId===characterId)),...library.places.filter(r=>r.characterIds.includes(characterId))];
  return <div className="catalog-character-links">{rows.map(r=>{const detail=r.kind==='item'?r.holders.filter(h=>h.characterId===characterId).map(h=>`${itemTypes[r.itemType]} · ${h.quantity} · ${holdingStates[h.state]}`).join('；'):r.kind==='technique'?r.practitioners.filter(p=>p.characterId===characterId).map(p=>`功法 · ${practiceStates[p.state]} · ${p.progress||'进度未填写'}`).join('；'):'关联地点';return <button key={r.id} className="panel" onClick={()=>onOpen(r.kind,r.id)}><strong>{r.name}{r.archived?'（已归档）':''}</strong><small>{detail}</small></button>;})}{!rows.length&&<p>尚无关联。前往物品库、功法库或地点库，编辑资料并选择此人物。</p>}</div>;
}
