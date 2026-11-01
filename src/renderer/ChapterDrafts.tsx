import React,{useEffect,useRef,useState} from 'react';
import {Dialog,AlertDialog} from 'radix-ui';
import type {Chapter,ChapterInput,WorkOutline} from '../shared/types.ts';
import {parseChapterDraft,chapterDraftConflict,type ChapterDraft} from '../shared/chapter-drafts.ts';
import {Textarea} from './Fields.tsx';

let database:Promise<IDBDatabase>|undefined;
function openDrafts(){
  return database??=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('wanxiang-chapter-drafts',1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('drafts',{keyPath:'key'});store.createIndex('workId','workId');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=undefined;reject(request.error);};});
}
async function readDrafts(workId:string):Promise<ChapterDraft[]>{const db=await openDrafts();return new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').index('workId').getAll(workId);request.onsuccess=()=>resolve(request.result.flatMap((row:{raw:string})=>{const value=parseChapterDraft(row.raw,workId);return value?[value]:[];}).sort((a:ChapterDraft,b:ChapterDraft)=>b.savedAt.localeCompare(a.savedAt)));request.onerror=()=>reject(request.error);});}
async function writeDraft(workId:string,id:string|undefined,value:ChapterDraft|null){
  const db=await openDrafts();return new Promise<void>((resolve,reject)=>{const transaction=db.transaction('drafts','readwrite',{durability:'strict'}),store=transaction.objectStore('drafts'),key=workId+':'+(id??'new');if(value)store.put({key,workId,raw:JSON.stringify(value)});else store.delete(key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
}
export function useChapterDrafts({workId,generation,draft,baseline}:{workId:string;generation:string;draft:ChapterInput|null;baseline:string}){
  const [entries,setEntries]=useState<ChapterDraft[]>([]),[storageError,setStorageError]=useState(''),[savedInput,setSavedInput]=useState('');
  const current=useRef({draft,baseline,generation});current.current={draft,baseline,generation};
  const suppressed=useRef(''),queue=useRef(Promise.resolve());
  const enqueue=(action:()=>Promise<void>)=>{queue.current=queue.current.then(action).catch(()=>setStorageError('本机草稿未能暂存，请及时保存章节。当前输入仍保留。'));};
  const flush=()=>{
    const {draft:input,baseline:base,generation:gen}=current.current,serialized=JSON.stringify(input);if(!input||serialized===base||suppressed.current===serialized)return;
    const value:ChapterDraft={format:1,workId,generation:gen,input,baseline:base,savedAt:new Date().toISOString()};
    enqueue(async()=>{await writeDraft(workId,input.id,value);setSavedInput(serialized);setStorageError('');setEntries(await readDrafts(workId));});
  };
  useEffect(()=>{enqueue(async()=>setEntries(await readDrafts(workId)));},[workId]);
  useEffect(()=>{if(!draft)return;const id=setTimeout(flush,300);return()=>clearTimeout(id);},[draft,baseline,generation]);
  useEffect(()=>{const hide=()=>{if(document.visibilityState==='hidden')flush();};const discard=()=>drop();window.addEventListener('beforeunload',flush);document.addEventListener('visibilitychange',hide);window.addEventListener('wanxiang:discard-draft',discard);return()=>{window.removeEventListener('beforeunload',flush);document.removeEventListener('visibilitychange',hide);window.removeEventListener('wanxiang:discard-draft',discard);};},[workId]);
  const drop=(input:ChapterInput|null=current.current.draft)=>{if(!input)return;suppressed.current=JSON.stringify(input);enqueue(async()=>{await writeDraft(workId,input.id,null);setEntries(await readDrafts(workId));setSavedInput('');});};
  return {entries:entries.filter(e=>!draft||e.input.id!==draft.id),drop,storageError,stored:Boolean(draft&&savedInput===JSON.stringify(draft))};
}

export function ChapterDraftNotice({entries,generation,chapters,outline,onRecover,onRemove}:{entries:ChapterDraft[];generation:string;chapters:Chapter[];outline:WorkOutline;onRecover:(d:ChapterDraft)=>void;onRemove:(input:ChapterInput)=>void}){
  const [viewing,setViewing]=useState<ChapterDraft|null>(null),[deleting,setDeleting]=useState<ChapterDraft|null>(null),[copyError,setCopyError]=useState('');
  return <>{entries.length>0&&<div className="chapter-draft-notice" role="status"><strong>本机有未保存的章节草稿</strong>{entries.map(d=>{const conflict=chapterDraftConflict(d,generation,chapters,outline);return <div key={d.input.id??'new'} className="row wrap"><span>{d.input.name||'未命名章节'} · {new Date(d.savedAt).toLocaleString('zh-CN')}</span><button className="text-link" onClick={()=>conflict?setViewing(d):onRecover(d)}>{conflict?'查看旧草稿':'继续草稿'}</button><button className="text-link" onClick={()=>setDeleting(d)}>清除</button></div>;})}</div>}
    <Dialog.Root open={Boolean(viewing)} onOpenChange={v=>{if(!v)setViewing(null);}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="editor-dialog draft-recovery-dialog"><div className="editor-heading"><div><Dialog.Title>核对旧草稿</Dialog.Title><Dialog.Description>{viewing&&chapterDraftConflict(viewing,generation,chapters,outline)} 请将需要的内容合并到最新章节。</Dialog.Description></div></div><div className="draft-recovery-body"><h3>{viewing?.input.name}</h3><Textarea readOnly aria-label="旧草稿正文" value={viewing?.input.body??''} rows={15}/><details><summary>梗概、备注与关联记录</summary><pre>{viewing&&JSON.stringify({...viewing.input,body:undefined},null,2)}</pre></details>{copyError&&<p role="alert">{copyError}</p>}</div><div className="editor-footer"><button className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(viewing?.input.body??'');setCopyError('已复制草稿正文');}catch{setCopyError('请选中上方正文后复制。');}}}>复制正文</button><button className="btn primary" onClick={()=>setViewing(null)}>关闭</button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
    <AlertDialog.Root open={Boolean(deleting)} onOpenChange={v=>{if(!v)setDeleting(null);}}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay"/><AlertDialog.Content className="confirm-dialog"><AlertDialog.Title>清除本机草稿？</AlertDialog.Title><AlertDialog.Description>清除“{deleting?.input.name||'未命名章节'}”未保存的本机副本，已保存的章节保留。</AlertDialog.Description><div className="dialog-buttons"><AlertDialog.Cancel className="btn">取消</AlertDialog.Cancel><AlertDialog.Action className="btn danger" onClick={()=>{if(deleting)onRemove(deleting.input);setDeleting(null);}}>清除草稿</AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </>;
}
