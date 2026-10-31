import React,{useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import type {LibrarySnapshot,Result} from '../shared/types.ts';
import type {TransferFile,TransferPreview,TransferExportInput} from '../shared/transfer.ts';
import {SelectField,CheckField} from './Fields.tsx';
import {Icon} from './Icon.tsx';
import {isDesktop} from './runtime.ts';

const unwrap=<T,>(r:Result<T>):T=>{if(!r.ok)throw Error(r.error.message);return r.value;};
export function TransferDialog({library,onClose,onChanged,initialTab='export',onImported}:{library:LibrarySnapshot;onClose:()=>void;onChanged:()=>Promise<void>;initialTab?:'export'|'import';onImported?:(workId?:string)=>Promise<void>}){
  const [tab,setTab]=useState<'export'|'import'>(initialTab);
  const [format,setFormat]=useState<TransferExportInput['format']>('package'),[scope,setScope]=useState<TransferExportInput['scope']>('work');
  const [workId,setWorkId]=useState(library.activeWorkId??library.works[0]?.id??''),[worldId,setWorldId]=useState(library.worlds[0]?.id??'');
  const [includeArchived,setIncludeArchived]=useState(false),[split,setSplit]=useState<'headings'|'single'>('headings');
  const [file,setFile]=useState<TransferFile|null>(null),[preview,setPreview]=useState<TransferPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const token=useRef<string|null>(null);
  const discard=()=>{if(token.current)void window.studio!.cancelTransferImport({token:token.current});token.current=null;setPreview(null);};
  const perform=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();}catch(e){discard();setError((e as Error).message);}finally{setBusy(false);}};
  const close=()=>{if(!busy){discard();onClose();}};
  const workSelect=(disabled=false)=><SelectField aria-label={tab==='export'?'导出作品':'导入目标作品'} value={workId} disabled={disabled} onValueChange={v=>{discard();setWorkId(v);}}>{library.works.filter(w=>tab==='export'||!w.archived).map(w=><option key={w.id} value={w.id}>{w.name}{w.archived?'（已归档）':''} · {w.worldName}</option>)}</SelectField>;
  const textFile=file&&/\.(txt|md)$/i.test(file.name);
  return <Dialog.Root open onOpenChange={open=>{if(!open)close();}}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="transfer-dialog" onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
    <header className="transfer-header"><div><Dialog.Title>导入与导出</Dialog.Title><Dialog.Description className="sr-only">导入或导出作品资料与章节正文。</Dialog.Description></div><button className="icon-button" aria-label="关闭导入导出" disabled={busy} onClick={close}><Icon name="close"/></button></header>
    <div className="transfer-tabs" role="tablist" aria-label="导入导出方式">{(['export','import'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'active':''} disabled={busy} onClick={()=>{discard();setTab(t);setError('');setNotice('');}}>{t==='export'?'导出资料':'导入文件'}</button>)}</div>
    <div className="transfer-content">
      {error&&<div className="error-banner" role="alert">{error}</div>}{notice&&<div className="transfer-notice" role="status"><Icon name="check"/>{notice}</div>}
      {tab==='export'?<>
        <div className="transfer-form"><label className="editor-field"><span>文件格式</span><SelectField aria-label="导出格式" value={format} disabled={busy} onValueChange={v=>{setFormat(v as typeof format);if(v!=='package')setScope('work');}}><option value="package">万象工坊资料包（可完整导回）</option><option value="markdown">Markdown 作品正文</option><option value="text">TXT 作品正文</option></SelectField></label>
        {format==='package'&&<label className="editor-field"><span>导出范围</span><SelectField aria-label="导出范围" value={scope} disabled={busy} onValueChange={v=>setScope(v as typeof scope)}><option value="work">一部作品与共用世界</option><option value="world">一个世界及其全部作品</option><option value="library">整个资料库</option></SelectField></label>}
        {scope==='work'&&<label className="editor-field"><span>选择作品</span>{workSelect(busy)}</label>}{scope==='world'&&<label className="editor-field"><span>选择世界</span><SelectField aria-label="导出世界" value={worldId} disabled={busy} onValueChange={setWorldId}>{library.worlds.map(w=><option value={w.id} key={w.id}>{w.name}</option>)}</SelectField></label>}
        </div>
        <section className="transfer-explanation"><Icon name={format==='package'?'archive':'book'}/><div><h3>{format==='package'?'完整资料包':'按作品目录整理正文'}</h3><p>{format==='package'?'包含所选资料、图片、历史和归档内容。导出作品时会同时携带整个共用世界。':'按目录顺序导出章节标题和正文。分卷梗概、人物与设定资料、批注和修改历史请用资料包保存。'}</p><small>{format==='package'?'单个资料包上限 64 MB；不包含连接密钥、软件设置与备份链。':'导出文件采用 UTF-8 编码，可用常见文本编辑器打开。'}</small></div></section>
        {format!=='package'&&<label className="backup-toggle"><CheckField checked={includeArchived} disabled={busy} onCheckedChange={setIncludeArchived}/>包含已归档章节</label>}
        <button className="btn primary" disabled={busy||scope==='work'&&!workId||scope==='world'&&!worldId} onClick={()=>void perform(async()=>{const result=unwrap(await window.studio!.saveTransferFile({format,scope,id:scope==='work'?workId:worldId,includeArchived}));if(result)setNotice(isDesktop?`已保存到 ${result}`:`已开始下载 ${result}`);})}><Icon name="archive"/>{busy?'正在准备文件…':'导出文件'}</button>
      </>:<>
        <div className="transfer-file"><div><strong>{file?.name??'选择要导入的文件'}</strong><p>资料包 .wanxiang · UTF-8 正文 .txt / .md</p><small>资料包最多 64 MB，正文最多 2 MB。</small></div><button className="btn" disabled={busy} onClick={()=>void perform(async()=>{const selected=unwrap(await window.studio!.pickTransferFile());if(selected){discard();setFile(selected);}})}><Icon name="folder"/>{file?'重新选择':'选择文件'}</button></div>
        {textFile&&<div className="transfer-form"><label className="editor-field"><span>追加到作品</span>{workSelect(busy)}</label><label className="editor-field"><span>正文分章</span><SelectField aria-label="正文分章方式" value={split} disabled={busy} onValueChange={v=>{discard();setSplit(v as typeof split);}}><option value="headings">按章节标题识别</option><option value="single">整篇作为一章</option></SelectField></label></div>}
        {file&&!preview&&<button className="btn primary" disabled={busy||Boolean(textFile&&!workId)} onClick={()=>void perform(async()=>{discard();const p=unwrap(await window.studio!.previewTransferImport({...file,workId,split}));token.current=p.token;setPreview(p);})}>{busy?'正在校验文件…':'校验并预览导入'}</button>}
        {preview&&<section className="transfer-preview"><h3>{preview.kind==='package'?'将创建以下独立副本':'将追加以下章节'}</h3><div className="transfer-counts"><span><b>{preview.worlds.length}</b> 世界</span><span><b>{preview.works.length}</b> 作品</span><span><b>{preview.characters}</b> 人物</span><span><b>{preview.entries}</b> 世界设定</span><span><b>{preview.items}</b> 物品</span><span><b>{preview.techniques}</b> 功法</span><span><b>{preview.places}</b> 地点</span><span><b>{preview.chapters}</b> 章节</span><span><b>{preview.images}</b> 图片</span></div>
          <p className="transfer-names">{preview.kind==='package'&&`世界：${preview.worlds.join('、')||'无'}　`}作品：{preview.works.join('、')||'无'}</p>
          {preview.histories>0&&<p>同时保留 {preview.histories} 条修改历史。</p>}
          {preview.warnings.map(w=><p className="backup-help" key={w}>{w}</p>)}
          {preview.chapterPreviews.length>0&&<div className="transfer-chapters">{preview.chapterPreviews.map((c,i)=><details key={i}><summary>{i+1}. {c.name}<small>{c.characters} 字符</small></summary><pre>{c.excerpt||'（正文为空）'}{c.characters>300?'…':''}</pre></details>)}</div>}
          <footer><small>预览 10 分钟内有效。资料变更后需重新预览。</small><button className="btn primary" disabled={busy} onClick={()=>void perform(async()=>{const result=unwrap(await window.studio!.importTransfer({token:preview.token}));token.current=null;setPreview(null);setFile(null);setNotice(preview.kind==='package'?`已导入 ${result.worldIds.length} 个世界、${result.workIds.length} 部作品的独立副本。可从作品列表打开。`:`已追加 ${result.chapterIds.length} 章草稿。`);await onChanged();await onImported?.(result.workIds[0]??workId);})}>{busy?'正在导入…':'确认导入'}</button></footer>
        </section>}
      </>}
    </div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
