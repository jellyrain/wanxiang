import { randomUUID } from 'node:crypto';
import { ContentError, type LibraryStore } from './store.ts';
import { CONTENT_CHANNELS, type ContentCommand } from '../shared/api.ts';
import type { DesktopApi, Result } from '../shared/types.ts';

type Unwrap<T> = T extends Result<infer V> ? V : never;
type Handlers = { [K in ContentCommand]:(...args:Parameters<DesktopApi[K]>)=>Unwrap<Awaited<ReturnType<DesktopApi[K]>>> };

export function contentCommands(store:LibraryStore,onChange:()=>void=()=>{}) {
  const instanceId=randomUUID();let counter=0;
  const changed=()=>{counter++;onChange();};
  const handlers:Handlers={
    saveLibraryConfig:i=>store.config.save(i),
    saveCatalogLink:i=>store.catalogs.saveLink(i),
    savePlace:i=>store.catalogs.save('place',i),archivePlace:(...a)=>store.catalogs.archive('place',...a),
    saveTechnique:i=>store.catalogs.save('technique',i),archiveTechnique:(...a)=>store.catalogs.archive('technique',...a),
    saveItem:i=>store.catalogs.save('item',i),archiveItem:(...a)=>store.catalogs.archive('item',...a),
    previewDeletion:i=>store.deletion.preview(i),deleteContent:i=>store.deletion.confirm(i),
    exportTransfer:i=>store.transfer.export(i),previewTransferImport:i=>store.transfer.preview(i),importTransfer:i=>store.transfer.confirm(i),cancelTransferImport:i=>store.transfer.cancel(i),
    listHistory:i=>store.history.list(i),getHistory:i=>store.history.detail(i),previewHistoryRestore:i=>store.history.preview(i),restoreHistory:i=>store.history.restore(i),
    snapshot:()=>store.snapshot(),createWork:i=>store.workspace.createWork(i),saveWork:i=>store.workspace.saveWork(i),archiveWork:(...a)=>store.workspace.archiveWork(...a),saveWorld:i=>store.workspace.saveWorld(i),selectWork:id=>store.workspace.selectWork(id),
    saveMedia:i=>store.gallery.save(i),archiveMedia:(...a)=>store.gallery.archive(...a),saveMediaCatalog:i=>store.gallery.saveCatalog(i),saveDashboard:i=>store.dashboard.save(i),
    saveCharacter:i=>store.saveCharacter(i),archiveCharacter:(...a)=>store.archiveCharacter(...a),saveTag:i=>store.saveTag(i),deleteTag:(...a)=>store.deleteTag(...a),setTheme:i=>store.setTheme(i),setThemePreferences:i=>store.setThemePreferences(i),
    saveAttributeTemplate:i=>store.saveAttributeTemplate(i),saveCharacterVariants:i=>store.saveCharacterVariants(i),saveCharacterStage:i=>store.saveCharacterStage(i),reorderCharacterStages:(...a)=>store.reorderCharacterStages(...a),
    saveRelationType:i=>store.graph.saveType(i),saveRelation:i=>store.graph.saveRelation(i),archiveRelation:(...a)=>store.graph.archiveRelation(...a),saveGraphLayout:i=>store.graph.saveLayout(i),
    saveWorldCategory:i=>store.world.saveCategory(i),saveWorldEntry:i=>store.world.saveEntry(i),archiveWorldEntry:(...a)=>store.world.archiveEntry(...a),
    saveMap:i=>store.maps.save(i),archiveMap:(...a)=>store.maps.archive(...a),saveOutline:i=>store.chapters.saveOutline(i),saveChapter:i=>store.chapters.save(i),archiveChapter:(...a)=>store.chapters.archive(...a),
    saveTimeline:i=>store.timeline.save(i),archiveTimeline:(...a)=>store.timeline.archive(...a)
  };
  const invoke=(name:string,args:unknown,generation?:string)=>{
    if(!Object.hasOwn(CONTENT_CHANNELS,name))throw new ContentError('NOT_FOUND','没有这个内容操作。');
    const readOnly=['previewDeletion','snapshot','listHistory','getHistory','previewHistoryRestore','exportTransfer','previewTransferImport','cancelTransferImport'].includes(name);
    if(!readOnly||name==='previewDeletion'||name==='previewHistoryRestore'||name==='previewTransferImport')store.assertWritable(generation);
    const array=Array.isArray(args)?args:null;
    const count=name==='snapshot'?0:name==='deleteTag'?2:name.startsWith('archive')||name==='reorderCharacterStages'?3:1;
    if(!array||array.length!==count)throw new ContentError('VALIDATION',`此操作需要 ${count} 个参数，使用 {args:[...]} 传入。`);
    if(count===1){
      const scalar=name==='selectWork'||name==='setTheme';
      if(scalar?typeof array[0]!=='string':!array[0]||typeof array[0]!=='object'||Array.isArray(array[0]))throw new ContentError('VALIDATION','参数格式不正确。');
    }
    if(count>1&&(typeof array[0]!=='string'||!Number.isSafeInteger(array[1])||Number(array[1])<0||(count===3&&(name==='reorderCharacterStages'?!Array.isArray(array[2]):typeof array[2]!=='boolean'))))throw new ContentError('VALIDATION','编号、版本或操作参数格式不正确。');
    const value=(handlers[name as ContentCommand] as (...a:unknown[])=>unknown)(...array);
    if(!readOnly)changed();
    return value;
  };
  return {invoke,changed,revision:()=>`${instanceId}:${store.journal.get('generation')}:${counter}`,instanceId};
}
export type ContentCommands=ReturnType<typeof contentCommands>;
