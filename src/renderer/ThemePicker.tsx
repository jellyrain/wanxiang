import React from 'react';
import { Icon } from './Icon.tsx';

export function ThemePicker({onOpen}:{onOpen:()=>void}) {
  return <button className="btn small theme-trigger" onClick={onOpen}><Icon name="palette"/>主题</button>;
}
