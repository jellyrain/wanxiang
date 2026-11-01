import {assetUrl} from './runtime.ts';
import React, { useEffect, useState } from 'react';
import { Icon } from './Icon.tsx';

export function CharacterImage({ character,placeholderIcon='users' }: { character: { name:string; portraitId:string|null; portraitWidth?:number };placeholderIcon?:string }) {
  const src = character.portraitId ? assetUrl(character.portraitId) : null;
  const [image,setImage] = useState<{src:string; width:number; height:number}|null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    let active = true;
    img.onload = () => { if (active) setImage({src,width:img.naturalWidth,height:img.naturalHeight}); };
    img.src = src;
    return () => { active = false; };
  },[src]);
  if (!src) return <div className="portrait-placeholder"><Icon name={placeholderIcon}/><span>{placeholderIcon==='users'?'等待一个形象':'暂无图片'}</span></div>;
  const width = character.portraitWidth ?? 100;
  // A viewBox frames the source without rewriting or losing the original image.
  return <div className="character-image" role="img" aria-label={`${character.name || '人物'}特写`}>
    {image?.src === src && <svg viewBox={`0 0 ${image.width * width / 100} ${image.height}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <image href={src} width={image.width} height={image.height}/>
    </svg>}
  </div>;
}
