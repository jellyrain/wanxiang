import {isDesktop} from './runtime.ts';
import React from 'react';
import { BRAND } from '../shared/brand.ts';

export function WindowTitleBar({ context }: { context: string }) {
  if(!isDesktop)return null;
  return <div className="window-titlebar" aria-label="窗口标题栏">
    <div className="window-titlebar-safe">
      <img src={`./brand/${BRAND.iconFile}`} alt="" draggable={false}/>
      <span className="window-titlebar-name">{BRAND.name}</span>
      <span className="window-titlebar-context">{context}</span>
    </div>
  </div>;
}
