import React,{useState} from 'react';
import {Dialog} from 'radix-ui';
import type {LibrarySnapshot,Result} from '../shared/types.ts';
import {Input} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {NewWorkEditor} from './WorkSettings.tsx';
import {TransferDialog} from './TransferDialog.tsx';
import {isDesktop} from './runtime.ts';

const unwrap=<T,>(r:Result<T>):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
export function GettingStarted({library,fresh,onChanged,onOpenWork,onClose}:{library:LibrarySnapshot;fresh:boolean;onChanged:()=>Promise<void>;onOpenWork:(id:string)=>Promise<void>;onClose:()=>void}){
  const [mode,setMode]=useState<'choose'|'new'|'import'>('choose'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [name,setName]=useState(''),[worldName,setWorldName]=useState('');
  const [starter]=useState(()=>fresh&&library.works.length===1&&library.works[0].name==='我的第一部作品'&&!library.characters.length&&!library.chapters.length&&!library.media.length?library.works[0]:null);
  const finish=async(id?:string)=>{
    if(id)await onOpenWork(id);
    if(isDesktop)unwrap(await window.studio!.completeOnboarding());
    onClose();
  };
  const skip=async()=>{setBusy(true);setError('');try{await finish();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const start=async(e:React.FormEvent)=>{
    e.preventDefault();if(!starter)return;setBusy(true);setError('');
    try{
      // Read fresh versions before each retry; onboarding never duplicates the starter book.
      const current=unwrap(await window.studio!.snapshot()),work=current.works.find(w=>w.id===starter.id)!,world=current.worlds.find(w=>w.id===work.worldId)!;
      unwrap(await window.studio!.saveWorld({id:world.id,name:worldName.trim(),description:world.description,expectedVersion:world.version}));
      unwrap(await window.studio!.saveWork({id:work.id,name:name.trim(),expectedVersion:work.version}));
      await onChanged();await finish(work.id);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  if(mode==='import')return <TransferDialog library={library} initialTab="import" onClose={()=>setMode('choose')} onChanged={onChanged} onImported={finish}/>;
  if(mode==='new'&&!starter)return <NewWorkEditor worlds={library.worlds} selectedWorldId={library.worlds[0]?.id??''} shared={false} onClose={()=>setMode('choose')} onCreated={async work=>{await onChanged();await finish(work.id);}}/>;
  return <Dialog.Root open onOpenChange={open=>{if(!open&&!busy)void skip();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="getting-started" onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
    <header><div><Dialog.Title>{mode==='choose'?'从这里开始':'新建作品'}</Dialog.Title><Dialog.Description>{mode==='choose'?'新建一个故事，或带入已有资料。':'为作品和世界取个名字。'}</Dialog.Description></div><button className="icon-button" disabled={busy} aria-label="暂时跳过引导" onClick={()=>void skip()}><Icon name="close"/></button></header>
    {mode==='choose'?<><div className="welcome-choices"><button onClick={()=>setMode('new')}><Icon name="book"/><strong>新建作品</strong><span>从空白故事开始</span><Icon name="arrow"/></button><button onClick={()=>setMode('import')}><Icon name="folder"/><strong>导入已有资料</strong><span>资料包或章节正文</span><Icon name="arrow"/></button></div><footer><button className="text-link" disabled={busy} onClick={()=>void skip()}>先看看</button></footer></>:<form onSubmit={e=>void start(e)}><label className="editor-field"><span>作品名称</span><Input autoFocus required maxLength={200} disabled={busy} value={name} onChange={e=>setName(e.target.value)} placeholder="作品名称"/></label><label className="editor-field"><span>世界名称</span><Input required maxLength={200} disabled={busy} value={worldName} onChange={e=>setWorldName(e.target.value)} placeholder="世界名称"/></label><footer><button className="btn" type="button" disabled={busy} onClick={()=>setMode('choose')}>返回</button><button className="btn primary" disabled={busy||!name.trim()||!worldName.trim()}>{busy?'正在保存…':'开始创作'}</button></footer></form>}
    {error&&<p className="editor-error" role="alert">{error}</p>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
