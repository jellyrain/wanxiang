/** Content operations shared by IPC, the local HTTP service and the browser. */
export const CONTENT_CHANNELS = {
  savePlace:'place:save',archivePlace:'place:archive',
  saveTechnique:'technique:save',archiveTechnique:'technique:archive',
  saveItem:'item:save',archiveItem:'item:archive',
  previewDeletion:'content:preview-deletion',deleteContent:'content:delete',
  exportTransfer:'transfer:export',previewTransferImport:'transfer:preview',importTransfer:'transfer:import',cancelTransferImport:'transfer:cancel',
  listHistory:'history:list',getHistory:'history:detail',previewHistoryRestore:'history:preview',restoreHistory:'history:restore',
  snapshot:'library:snapshot', createWork:'work:create', saveWork:'work:save', archiveWork:'work:archive', saveWorld:'world:save', selectWork:'work:select',
  saveMedia:'media:save', archiveMedia:'media:archive', saveMediaCatalog:'media:catalog', saveDashboard:'dashboard:save',
  saveCharacter:'character:save', archiveCharacter:'character:archive', saveTag:'tag:save', deleteTag:'tag:delete', setTheme:'theme:set',
  saveAttributeTemplate:'attribute-template:save', saveCharacterVariants:'character:variants', saveCharacterStage:'character:stage', reorderCharacterStages:'character:stage-order',
  saveRelationType:'relation-type:save', saveRelation:'relation:save', archiveRelation:'relation:archive', saveGraphLayout:'graph:layout',
  saveWorldCategory:'world-category:save', saveWorldEntry:'world-entry:save', archiveWorldEntry:'world-entry:archive',
  saveMap:'map:save', archiveMap:'map:archive', saveOutline:'outline:save', saveChapter:'chapter:save', archiveChapter:'chapter:archive',
  saveTimeline:'timeline:save', archiveTimeline:'timeline:archive'
} as const;
export type ContentCommand = keyof typeof CONTENT_CHANNELS;
export interface LocalConnection {
  available:boolean; baseUrl:string|null; apiUrl:string|null; descriptorPath:string; error?:string;
  lanEnabled?:boolean; listenHost?:string; lanUrls?:string[]; mcpUrl?:string;
  browserAccessMode?:BrowserAccessMode; rememberedDeviceCount?:number;
}
export type BrowserAccessMode='direct'|'password';
export interface ConnectionPairing {code:string;expiresAt:number}
export interface McpConnectionConfig {url:string;headers:{Authorization:string}}
