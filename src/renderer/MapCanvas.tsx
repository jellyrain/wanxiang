import {assetUrl} from './runtime.ts';
import React, { useRef, useState } from 'react';
import type { MapLocation, MapPoint, TerrainKind, TerrainStroke, WorldMapInput } from '../shared/types.ts';
import { MAP_WIDTH as W, MAP_HEIGHT as H, locationDiscovered } from '../shared/maps.ts';
import { Icon } from './Icon.tsx';
export type MapTool='browse'|'pin'|'erase'|TerrainKind;
export const mapTools:{id:MapTool;name:string;icon:string;hint:string}[]=[
  {id:'browse',name:'浏览',icon:'hand',hint:'拖动空白处平移，拖动地点调整位置；点击地点阅读资料。'},
  {id:'pin',name:'地点',icon:'pin',hint:'在地图上点击，为这里添加地点。'},
  {id:'land',name:'陆地',icon:'world',hint:'按住拖动画出陆地轮廓，松开后自动闭合区域。'},
  {id:'forest',name:'森林',icon:'forest',hint:'按住拖动画出森林范围，松开后自动闭合区域。'},
  {id:'mountain',name:'山脉',icon:'mountain',hint:'按住拖动，绘制山脉走势。'},
  {id:'river',name:'河流',icon:'river',hint:'按住拖动，绘制河流。'},
  {id:'road',name:'路线',icon:'route',hint:'按住拖动，绘制道路或行进路线。'},
  {id:'erase',name:'擦除',icon:'eraser',hint:'点击一笔地形将其擦除；操作可以撤销，点击保存地图后才会保存。'}
];
function Terrain({stroke}:{stroke:TerrainStroke}) {const points=stroke.points.map(p=>`${p.x},${p.y}`).join(' ');return <g data-stroke-id={stroke.id}>{['land','forest'].includes(stroke.kind)?<polygon className={`terrain-${stroke.kind}`} points={points}/>:<polyline className={`terrain-${stroke.kind}`} points={points}/>} {stroke.kind==='forest'&&<polygon points={points} fill="url(#atlas-forest)" className="forest-pattern"/>}</g>;}
type Gesture={type:'pan'|'draw'|'location';start:MapPoint;points:MapPoint[];id?:string;kind?:TerrainKind;moved:boolean;pointerId:number};
export function MapCanvas({map,locations,mode,stageId,tool,selectedId,disabled,editable,onSelect,onAdd,onMove,onDraw,onErase,onMessage}:{map:WorldMapInput;locations:MapLocation[];mode:'author'|'explore';stageId:string;tool:MapTool;selectedId:string|null;disabled:boolean;editable:boolean;onSelect:(id:string)=>void;onAdd:(point:MapPoint)=>void;onMove:(id:string,point:MapPoint)=>void;onDraw:(stroke:TerrainStroke)=>void;onErase:(id:string)=>void;onMessage:(message:string)=>void}) {
  const ref=useRef<SVGSVGElement>(null),gesture=useRef<Gesture|null>(null),[zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0}),[preview,setPreview]=useState<TerrainStroke|null>(null),[moving,setMoving]=useState<{id:string;point:MapPoint}|null>(null);
  const point=(e:React.PointerEvent):MapPoint=>{const matrix=ref.current?.getScreenCTM();if(!matrix)return {x:0,y:0};const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());return {x:p.x,y:p.y};};
  const bounded=(p:MapPoint)=>({x:Math.round(Math.max(0,Math.min(W,p.x))*10)/10,y:Math.round(Math.max(0,Math.min(H,p.y))*10)/10});
  const start=(e:React.PointerEvent,id?:string)=>{
    if(e.button!==0||disabled)return;e.preventDefault();e.stopPropagation();const p=point(e);if(!id&&(p.x<0||p.y<0||p.x>W||p.y>H))return;
    if(id&&(!editable||tool!=='browse')){onSelect(id);return;}
    if(!id&&editable&&tool==='pin'){onAdd(bounded(p));return;}
    if(!id&&editable&&tool==='erase'){const strokeId=(e.target as Element).closest('[data-stroke-id]')?.getAttribute('data-stroke-id');if(strokeId)onErase(strokeId);return;}
    const type=id?'location':editable&&tool!=='browse'?'draw':'pan';
    gesture.current={type,start:p,points:[bounded(p)],id,kind:type==='draw'?tool as TerrainKind:undefined,moved:false,pointerId:e.pointerId};ref.current!.setPointerCapture(e.pointerId);
    if(type==='draw')setPreview({id:'preview',kind:tool as TerrainKind,points:[bounded(p)]});
  };
  const move=(e:React.PointerEvent)=>{
    const g=gesture.current;if(!g)return;const p=point(e),b=bounded(p);
    if(g.type==='pan'){const dx=p.x-g.start.x,dy=p.y-g.start.y;setOffset(o=>({x:Math.max(-W,Math.min(W,o.x-dx)),y:Math.max(-H,Math.min(H,o.y-dy))}));return;}
    if(Math.hypot(p.x-g.start.x,p.y-g.start.y)>4)g.moved=true;
    if(g.type==='location'){setMoving({id:g.id!,point:b});return;}
    const last=g.points[g.points.length-1];if(g.points.length<999&&Math.hypot(b.x-last.x,b.y-last.y)>4){g.points.push(b);setPreview({id:'preview',kind:g.kind!,points:[...g.points]});}
  };
  const finish=(e:React.PointerEvent,cancel=false)=>{
    const g=gesture.current;if(!g)return;gesture.current=null;ref.current?.releasePointerCapture(g.pointerId);setPreview(null);setMoving(null);if(cancel)return;const p=bounded(point(e));
    if(g.type==='location'){if(g.moved||Math.hypot(p.x-g.start.x,p.y-g.start.y)>4)onMove(g.id!,p);onSelect(g.id!);return;}
    if(g.type==='draw'){
      const last=g.points[g.points.length-1];if(Math.hypot(p.x-last.x,p.y-last.y)>1)g.points.push(p);
      const area=['land','forest'].includes(g.kind!);if(g.points.length<(area?3:2)){onMessage(area?'画出一块区域后再松开鼠标。':'按住鼠标并拖动，才能画出线条。');return;}
      onDraw({id:crypto.randomUUID(),kind:g.kind!,points:g.points});
    }
  };
  const zoomTo=(next:number)=>{const z=Math.max(.5,Math.min(4,next));setOffset(o=>({x:o.x+W/(2*zoom)-W/(2*z),y:o.y+H/(2*zoom)-H/(2*z)}));setZoom(z);};
  return <div className={`atlas-canvas tool-${editable?tool:'browse'}`}>
    <svg ref={ref} viewBox={`${offset.x} ${offset.y} ${W/zoom} ${H/zoom}`} aria-label={editable?'可编辑世界地图':'世界地图'} onPointerDown={e=>start(e)} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)}>
      <defs><pattern id="atlas-grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="currentColor" strokeWidth="1"/></pattern><pattern id="atlas-forest" width="26" height="26" patternUnits="userSpaceOnUse"><path d="m8 18 5-10 5 10Z" fill="none" stroke="currentColor" strokeWidth="1.5"/></pattern><clipPath id="atlas-bounds"><rect width={W} height={H}/></clipPath></defs>
      <rect className="atlas-ocean" width={W} height={H}/><rect className="atlas-grid" width={W} height={H} fill="url(#atlas-grid)"/>
      <g clipPath="url(#atlas-bounds)">{map.backgroundId&&<image href={assetUrl(map.backgroundId)} width={W} height={H} preserveAspectRatio="xMidYMid meet"/>}{map.terrain.map(s=><Terrain key={s.id} stroke={s}/>)}{preview&&<g opacity=".6"><Terrain stroke={preview}/></g>}</g>
      <rect className="atlas-border" width={W} height={H}/>
      {locations.map(l=>{const known=mode==='author'||locationDiscovered(map.stages,l,stageId),p=moving?.id===l.id?moving.point:l,name=known?l.name:'未知地点';return <g key={l.id} className={`atlas-pin ${known?'':'locked'} ${selectedId===l.id?'selected':''} ${l.archived?'archived':''}`} transform={`translate(${p.x},${p.y}) scale(${1/Math.sqrt(zoom)})`} role="button" tabIndex={0} aria-label={name} onPointerDown={e=>start(e,l.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(l.id);}}}><circle r="22"/><path d={known?'M0 -10 9 0 0 10 -9 0Z':'M-6 -1H6V9H-6ZM-4 -1V-5a4 4 0 0 1 8 0v4'}/>{known&&l.favorite&&<text className="pin-star" x="18" y="-16">★</text>}<text y="45" textAnchor="middle">{name.length>14?`${name.slice(0,14)}…`:name}</text><title>{name}</title></g>;})}
    </svg>
    <div className="atlas-compass" aria-hidden="true">北<span>✧</span></div>
    {!map.backgroundId&&!map.terrain.length&&!map.locations.length&&<div className="atlas-empty"><Icon name="world"/><strong>{editable?'从一片空白，画出你的世界':'地图尚未绘制'}</strong><span>{editable?'选择上方“陆地”勾勒轮廓，或用“地点”放置第一个标记。':'作者可以在“作者全貌”中绘制地形、添加地点。'}</span></div>}
    <div className="atlas-zoom"><button className="icon-button" onClick={()=>zoomTo(zoom/1.25)} aria-label="缩小地图">−</button><button className="atlas-zoom-label" onClick={()=>{setZoom(1);setOffset({x:0,y:0});}} title="显示完整地图" aria-label="显示完整地图">{Math.round(zoom*100)}%</button><button className="icon-button" onClick={()=>zoomTo(zoom*1.25)} aria-label="放大地图">+</button></div>
    <div className="atlas-caption"><strong>{map.name}</strong><small>{mode==='author'?'作者全貌':'探索视图'} · {map.stages.find(s=>s.id===stageId)?.name}</small></div>
  </div>;
}
