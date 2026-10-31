import React,{useMemo} from 'react';
import {parseMarkdown,type MarkdownNode} from '../shared/markdown.ts';
function render(nodes:MarkdownNode[]):React.ReactNode {
  return nodes.map((n,i)=>{
    if(n.tag==='text')return n.text;
    const props:Record<string,unknown>={key:i};
    if(n.tag==='a')Object.assign(props,{href:n.href,target:'_blank',rel:'noopener noreferrer'});
    if(n.tag==='ol'&&n.start!==undefined)props.start=n.start;
    if(n.align)props.style={textAlign:n.align};
    let children=n.text??(n.children?render(n.children):undefined);
    if(n.tag==='li'&&n.checked!==undefined)children=<><input type="checkbox" checked={n.checked} disabled aria-label={n.checked?'已完成':'未完成'}/>{children}</>;
    const element=React.createElement(n.tag,props,children);
    return n.tag==='table'?<div className="markdown-table" key={i}>{element}</div>:element;
  });
}
export function Markdown({children,className=''}:{children:string;className?:string}){
  const nodes=useMemo(()=>parseMarkdown(children),[children]);
  return <div className={`markdown-body ${className}`}>{render(nodes)}</div>;
}
