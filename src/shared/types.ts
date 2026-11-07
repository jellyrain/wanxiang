import type { ThemeId, ThemePreferences, ThemePatch } from './themes.ts';
export type RecordKind='character'|CatalogKind;
export interface CatalogCategory {id:string;name:string;active:boolean}
export interface RecordConfig {categories:CatalogCategory[];fields:Fact[];templateId:string|null}
export interface LibraryConfig {worldId:string;groups:Record<RecordKind,RecordConfig>;version:number;updatedAt:string}
export interface LibraryConfigInput {worldId:string;groups:Record<RecordKind,RecordConfig>;expectedVersion:number}
export interface Tag { id: string; worldId: string; name: string; color: string; version: number }
export interface TagInput { id?: string; worldId: string; name: string; color: string; expectedVersion: number }
export interface Fact { id: string; label: string; value: string }
export interface AttributeDimension { id:string; name:string; min:number; max:number; unit:string; enabled:boolean }
export interface AttributeTemplate { id:string; worldId:string; name:string; version:number; dimensions:AttributeDimension[] }
export interface AttributeDefault { worldId:string; templateId:string|null; version:number }
export interface AttributeTemplateInput { id?:string; worldId:string; name:string; expectedVersion:number; dimensions:AttributeDimension[]; makeDefault:boolean; expectedDefaultVersion:number }
export interface CharacterAttributes { templateId:string|null; values:Record<string,Record<string,number|null>>; versions:Record<string,number> }
export interface CharacterIdentity { id:string; name:string; alias:string; title:string; organization:string; visibility:'public'|'secret'; description:string; active:boolean }
export interface CharacterForm { id:string; name:string; appearance:string; condition:string; cost:string; abilities:string|null; portraitMode:'inherit'|'custom'|'none'; portraitId:string|null; portraitWidth:number; attributeMode:'inherit'|'custom'; attributes:CharacterAttributes; active:boolean }
export interface CharacterProfile { designImageId?:string|null; name:string; caption:string; status:string; quote:string; intro:string; body:string; pending:string; abilities:string; facts:Fact[]; tags:Tag[]; portraitId:string|null; portraitWidth:number; attributes:CharacterAttributes }
export interface ResolvedForm { id:string; name:string; appearance:string; condition:string; cost:string; abilities:string; portraitId:string|null; portraitWidth:number; attributes:CharacterAttributes; attributeSchemas:AttributeTemplate[] }
export interface StageSnapshot { profile:CharacterProfile; identities:CharacterIdentity[]; forms:ResolvedForm[]; defaultFormId:string }
export interface CharacterStage { id:string; name:string; period:string; summary:string; archived:boolean; capturedAt:string; updatedAt:string; sourceVersion:number; snapshot:StageSnapshot }
export interface CharacterVariantsInput { characterId:string; expectedVersion:number; identities?:CharacterIdentity[]; forms?:CharacterForm[]; defaultFormId?:string }
export interface CharacterStageInput { id?:string; characterId:string; expectedVersion:number; name:string; period:string; summary:string; identityIds:string[]; formIds:string[]; defaultFormId:string; attributeValues:Record<string,CharacterAttributes>; archived:boolean; recapture?:boolean }
export type StudioPage='创作概览'|'角色图鉴'|'世界档案'|'物品库'|'功法库'|'地点库'|'地图探索'|'关系图谱'|'历史年表'|'剧情与章节'|'素材画廊'|'作品设置'|'软件设置';
export interface World { id:string; name:string; description:string; version:number; updatedAt:string }
export interface Work { id:string; worldId:string; name:string; worldName:string; version:number; archived:boolean; updatedAt:string }
export interface WorldInput { id?:string; name:string; description:string; expectedVersion:number }
export interface WorkInput { id:string; name:string; expectedVersion:number }
export interface NewWorkInput { name:string; world:{kind:'existing';id:string}|{kind:'new';name:string;description:string} }
export interface Character {
  designImageId:string|null;
  id: string; worldId: string; version: number; name: string; caption: string;
  status: string; quote: string; intro: string; body: string; pending: string;
  facts: Fact[]; tags: Tag[]; portraitId: string | null; portraitWidth: number; archived: boolean; updatedAt: string;
  attributes: CharacterAttributes;
  abilities:string; identities:CharacterIdentity[]; forms:CharacterForm[]; defaultFormId:string; stages:CharacterStage[];
}
export interface CharacterInput {
  designImageId?:string|null;
  id?: string; worldId: string; expectedVersion: number; name: string; caption: string;
  status: string; quote: string; intro: string; body: string; pending: string;
  facts: Fact[]; tagIds: string[]; portraitId: string | null; portraitWidth?: number;
  attributes?: CharacterAttributes;
  abilities?:string;
}
export interface Asset { id: string; worldId: string; fileName: string; mime: string; sourceName: string }
export interface MediaLabel { id:string; name:string; color:string; active:boolean }
export interface MediaCatalog { worldId:string; categories:MediaLabel[]; tags:MediaLabel[]; version:number; updatedAt:string }
export interface MediaCatalogInput { worldId:string; categories:MediaLabel[]; tags:MediaLabel[]; expectedVersion:number }
export interface MediaAsset extends Asset { name:string; description:string; source:string; prompt:string; categoryId:string|null; tagIds:string[]; favorite:boolean; archived:boolean; version:number; importedAt:string; updatedAt:string; width:number|null; height:number|null; byteSize:number|null }
export interface MediaInput { id:string; expectedVersion:number; name:string; description:string; source:string; prompt:string; categoryId:string|null; tagIds:string[]; favorite:boolean }
export interface MediaImportReport { importedIds:string[]; existingIds:string[]; errors:{name:string;message:string}[] }
export type WorkPhase='worldbuilding'|'outlining'|'writing'|'revising'|'completed';
export interface WorkTask { id:string; title:string; done:boolean }
export interface WorkDashboard { workId:string; worldId:string; description:string; genre:string; phase:WorkPhase; coverId:string|null; coverFlip?:boolean; targetCharacters:number|null; memo:string; tasks:WorkTask[]; version:number; updatedAt:string }
export interface WorkDashboardInput { workId:string; description:string; genre:string; phase:WorkPhase; coverId:string|null; coverFlip?:boolean; targetCharacters:number|null; memo:string; tasks:WorkTask[]; expectedVersion:number }
export interface RelationType { id:string; worldId:string; name:string; color:string; active:boolean; version:number }
export interface RelationTypeInput { id?:string; worldId:string; name:string; color:string; active:boolean; expectedVersion:number }
export interface CharacterRelation { id:string; worldId:string; sourceId:string; targetId:string; sourceStageId:string|null; targetStageId:string|null; typeId:string; label:string; description:string; direction:'forward'|'mutual'; status:'confirmed'|'pending'; archived:boolean; version:number; updatedAt:string }
export interface RelationInput { id?:string; worldId:string; sourceId:string; targetId:string; sourceStageId:string|null; targetStageId:string|null; typeId:string; expectedTypeVersion:number; label:string; description:string; direction:'forward'|'mutual'; status:'confirmed'|'pending'; expectedVersion:number }
export interface GraphLayout { worldId:string; version:number; positions:Record<string,{x:number;y:number}> }
export interface GraphLayoutInput { worldId:string; expectedVersion:number; positions:Record<string,{x:number;y:number}> }
export interface WorldCategory { id:string; worldId:string; name:string; color:string; description:string; active:boolean; version:number }
export interface WorldCategoryInput { id?:string; worldId:string; name:string; color:string; description:string; active:boolean; expectedVersion:number }
export type WorldEntryStatus = 'draft'|'pending'|'adopted';
export interface WorldLink { kind:'character'|'entry'; targetId:string; label:string }
export interface WorldEntry { id:string; worldId:string; categoryId:string; name:string; aliases:string; summary:string; body:string; pending:string; source:string; status:WorldEntryStatus; facts:Fact[]; imageId:string|null; links:WorldLink[]; archived:boolean; version:number; updatedAt:string }
export interface WorldEntryInput { id?:string; worldId:string; categoryId:string; expectedCategoryVersion:number; name:string; aliases:string; summary:string; body:string; pending:string; source:string; status:WorldEntryStatus; facts:Fact[]; imageId:string|null; links:WorldLink[]; expectedVersion:number }
export interface MapPoint { x:number; y:number }
export type TerrainKind='land'|'forest'|'mountain'|'river'|'road';
export interface TerrainStroke { id:string; kind:TerrainKind; points:MapPoint[] }
export interface MapStage { id:string; name:string }
export interface MapLocation extends MapPoint { id:string; name:string; kind:string; description:string; unlockStageId:string; imageId:string|null; entryIds:string[]; characterIds:string[]; favorite:boolean; archived:boolean }
export interface WorldMap { id:string; worldId:string; name:string; description:string; backgroundId:string|null; stages:MapStage[]; locations:MapLocation[]; terrain:TerrainStroke[]; archived:boolean; version:number; updatedAt:string }
export interface WorldMapInput { id?:string; worldId:string; name:string; description:string; backgroundId:string|null; stages:MapStage[]; locations:MapLocation[]; terrain:TerrainStroke[]; expectedVersion:number }
export interface TimelineEra { id:string; name:string; description:string }
export interface EventParticipant { characterId:string; stageId:string|null }
export interface EventPlace { mapId:string; locationId:string }
export interface EventMapProgress { mapId:string; stageId:string }
export type TimelineEventStatus='draft'|'pending'|'confirmed';
export interface TimelineEvent { id:string; eraId:string; name:string; period:string; endPeriod:string; summary:string; body:string; status:TimelineEventStatus; participants:EventParticipant[]; entryIds:string[]; places:EventPlace[]; mapProgress:EventMapProgress[]; archived:boolean }
export interface WorldTimeline { id:string; worldId:string; name:string; description:string; eras:TimelineEra[]; events:TimelineEvent[]; archived:boolean; version:number; updatedAt:string }
export interface TimelineInput { id?:string; worldId:string; name:string; description:string; eras:TimelineEra[]; events:TimelineEvent[]; expectedVersion:number }
export interface BookVolume { id:string; name:string; summary:string }
export interface WorkOutline { workId:string; worldId:string; synopsis:string; volumes:BookVolume[]; chapterIds:string[]; version:number; updatedAt:string }
export interface OutlineInput { workId:string; synopsis:string; volumes:BookVolume[]; chapterIds:string[]; expectedVersion:number }
export type ChapterStatus='planned'|'draft'|'revising'|'finished';
export interface ChapterEvent { timelineId:string; eventId:string }
export interface Chapter { id:string; workId:string; worldId:string; volumeId:string|null; name:string; summary:string; body:string; notes:string; status:ChapterStatus; participants:EventParticipant[]; events:ChapterEvent[]; entryIds:string[]; mapProgress:EventMapProgress[]; archived:boolean; version:number; updatedAt:string }
export interface ChapterInput { id?:string; workId:string; volumeId:string|null; name:string; summary:string; body:string; notes:string; status:ChapterStatus; participants:EventParticipant[]; events:ChapterEvent[]; entryIds:string[]; mapProgress:EventMapProgress[]; expectedVersion:number; expectedOutlineVersion:number }
export type CatalogKind='item'|'technique'|'place';
export interface CatalogBase { categoryId?:string|null; designImageId:string|null; tagIds:string[]; attributes:CharacterAttributes; facts:Fact[]; id:string; worldId:string; name:string; aliases:string; summary:string; body:string; pending:string; source:string; status:'draft'|'pending'|'adopted'; imageId:string|null; entryIds:string[]; archived:boolean; version:number; updatedAt:string }
export interface ItemHolding { id:string; characterId:string; quantity:number; state:'stored'|'equipped'|'spent'|'lost'; notes:string }
export interface TechniquePractice { id:string; characterId:string; progress:string; state:'learning'|'mastered'|'paused'|'abandoned'; notes:string }
export interface PlacePosition { mapId:string; locationId:string }
export interface ItemRecord extends CatalogBase { kind:'item'; itemType:string; rarity:string; effect:string; usage:string; cost:string; holders:ItemHolding[] }
export interface TechniqueRecord extends CatalogBase { kind:'technique'; school:string; requirements:string; effect:string; cost:string; levels:string; practitioners:TechniquePractice[] }
export interface PlaceRecord extends CatalogBase { kind:'place'; placeType:string; region:string; environment:string; access:string; characterIds:string[]; positions:PlacePosition[] }
export type CatalogRecord=ItemRecord|TechniqueRecord|PlaceRecord;
export interface CatalogExtrasInput { designImageId?:string|null; tagIds?:string[]; attributes?:CharacterAttributes; facts?:Fact[] }
export interface ItemInput extends CatalogExtrasInput, Omit<ItemRecord,'id'|'version'|'updatedAt'|'archived'|'designImageId'|'tagIds'|'attributes'|'facts'> { id?:string; expectedVersion:number }
export interface TechniqueInput extends CatalogExtrasInput, Omit<TechniqueRecord,'id'|'version'|'updatedAt'|'archived'|'designImageId'|'tagIds'|'attributes'|'facts'> { id?:string; expectedVersion:number }
export interface PlaceInput extends CatalogExtrasInput, Omit<PlaceRecord,'id'|'version'|'updatedAt'|'archived'|'designImageId'|'tagIds'|'attributes'|'facts'> { id?:string; expectedVersion:number }
export type CatalogInput=ItemInput|TechniqueInput|PlaceInput;
export type CatalogLinkTarget={kind:'character'|'worldEntry';id:string;expectedVersion:number}|{kind:'mapLocation';id:string;locationId:string;expectedVersion:number};
export interface CatalogLinkInput {
  target:CatalogLinkTarget;kind:CatalogKind;catalogId:string;expectedVersion:number;linked:boolean;
  holding?:Pick<ItemHolding,'quantity'|'state'|'notes'>;
  practice?:Pick<TechniquePractice,'progress'|'state'|'notes'>;
}

export interface LibrarySnapshot { libraryConfigs:LibraryConfig[]; items:ItemRecord[]; techniques:TechniqueRecord[]; places:PlaceRecord[]; generation:string; worlds:World[]; activeWorkId:string|null; media:MediaAsset[]; mediaCatalogs:MediaCatalog[]; dashboards:WorkDashboard[]; works: Work[]; characters: Character[]; tags: Tag[]; theme: ThemeId; themePreferences: ThemePreferences; attributeTemplates:AttributeTemplate[]; attributeDefaults:AttributeDefault[]; relationTypes:RelationType[]; relations:CharacterRelation[]; graphLayouts:GraphLayout[]; worldCategories:WorldCategory[]; worldEntries:WorldEntry[]; maps:WorldMap[]; timelines:WorldTimeline[]; outlines:WorkOutline[]; chapters:Chapter[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export type HistoryKind='libraryConfig'|'item'|'technique'|'place'|'character'|'worldEntry'|'worldCategory'|'relation'|'relationType'|'map'|'timeline'|'chapter'|'outline'|'media'|'mediaCatalog'|'dashboard'|'work'|'world';
export interface HistoryTarget { kind:HistoryKind; entityId:string }
export interface HistoryQuery extends HistoryTarget { beforeVersion?:number }
export interface HistorySelection extends HistoryTarget { version:number }
export interface HistoryRecord { version:number; action:string; createdAt:string }
export interface HistoryPage { records:HistoryRecord[]; hasMore:boolean; currentVersion:number }
export interface HistoryDifference { field:string; before:unknown; after:unknown }
export interface HistoryDetail { selection:HistorySelection; record:HistoryRecord; currentVersion:number; differences:HistoryDifference[] }
export interface HistoryPreview { token:string; expiresAt:string; selection:HistorySelection; currentVersion:number; differences:HistoryDifference[]; affected:{kind:HistoryKind;entityId:string;name:string}[]; notes:string[] }
export interface HistoryRestoreResult { kind:HistoryKind; entityId:string; version:number }
export interface DesktopApi {
  saveLibraryConfig(input:LibraryConfigInput):Promise<Result<LibraryConfig>>;
  saveCatalogLink(input:CatalogLinkInput): Promise<Result<CatalogRecord>>;
  saveItem(input:ItemInput): Promise<Result<ItemRecord>>;
  archiveItem(id:string, expectedVersion:number, archived:boolean): Promise<Result<ItemRecord>>;
  saveTechnique(input:TechniqueInput): Promise<Result<TechniqueRecord>>;
  archiveTechnique(id:string, expectedVersion:number, archived:boolean): Promise<Result<TechniqueRecord>>;
  savePlace(input:PlaceInput): Promise<Result<PlaceRecord>>;
  archivePlace(id:string, expectedVersion:number, archived:boolean): Promise<Result<PlaceRecord>>;
  previewDeletion(input:import('./deletion.ts').DeletionTarget):Promise<Result<import('./deletion.ts').DeletionPreview>>;
  deleteContent(input:{token:string;name:string}):Promise<Result<{deleted:import('./deletion.ts').DeletionTarget[];activeWorkId:string|null}>>;
  exportTransfer(input:import('./transfer.ts').TransferExportInput):Promise<Result<import('./transfer.ts').TransferFile>>;
  previewTransferImport(input:import('./transfer.ts').TransferImportInput):Promise<Result<import('./transfer.ts').TransferPreview>>;
  importTransfer(input:{token:string}):Promise<Result<import('./transfer.ts').TransferResult>>;
  cancelTransferImport(input:{token:string}):Promise<Result<void>>;
  pickTransferFile():Promise<Result<import('./transfer.ts').TransferFile|null>>;
  saveTransferFile(input:import('./transfer.ts').TransferExportInput):Promise<Result<string|null>>;
  listHistory(input:HistoryQuery):Promise<Result<HistoryPage>>;
  getHistory(input:HistorySelection):Promise<Result<HistoryDetail>>;
  previewHistoryRestore(input:HistorySelection):Promise<Result<HistoryPreview>>;
  restoreHistory(input:{token:string}):Promise<Result<HistoryRestoreResult>>;
  getDesktopStatus():Promise<Result<import('./desktop.ts').DesktopStatus>>;
  openDataDirectory():Promise<Result<void>>;
  completeOnboarding():Promise<Result<import('./desktop.ts').DesktopStatus>>;
  setLoginAtStartup(enabled:boolean):Promise<Result<import('./desktop.ts').DesktopStatus>>;
  setCloseToTray(enabled:boolean):Promise<Result<import('./desktop.ts').DesktopStatus>>;
  hideToTray():Promise<Result<void>>;
  quitApplication():Promise<Result<void>>;
  getUpdateStatus():Promise<Result<import('./update.ts').UpdateStatus>>;
  getUpdateCache():Promise<Result<{bytes:number;files:number}>>;
  clearUpdateCache():Promise<Result<{bytes:number;files:number}>>;
  saveUpdateSettings(input:import('./update.ts').UpdateSettings):Promise<Result<import('./update.ts').UpdateStatus>>;
  checkForUpdates():Promise<Result<import('./update.ts').UpdateStatus>>;
  downloadUpdate():Promise<Result<import('./update.ts').UpdateStatus>>;
  installUpdate():Promise<Result<void>>;
  openUpgradeRecovery():Promise<Result<void>>;
  getBackupStatus():Promise<Result<import('./backup.ts').BackupStatus>>;
  saveBackupSettings(input:import('./backup.ts').BackupSettings):Promise<Result<import('./backup.ts').BackupStatus>>;
  estimateBackup():Promise<Result<import('./backup.ts').BackupEstimate>>;
  createBackupBaseline(input:{generation:string;sequence:number}):Promise<Result<import('./backup.ts').BackupRun>>;
  runIncrementalBackup():Promise<Result<import('./backup.ts').BackupRun>>;
  previewBackupRestore(id:string):Promise<Result<import('./backup.ts').RestorePreview>>;
  restoreBackup(token:string):Promise<Result<void>>;
  deleteBackupPoint(id:string):Promise<Result<void>>;
  pickBackupDirectory():Promise<Result<string|null>>;
  getConnectionInfo():Promise<Result<import('./api.ts').LocalConnection>>;
  setLanEnabled(enabled:boolean):Promise<Result<import('./api.ts').LocalConnection>>;
  setBrowserAccessMode(mode:import('./api.ts').BrowserAccessMode):Promise<Result<import('./api.ts').LocalConnection>>;
  clearBrowserSessions():Promise<Result<import('./api.ts').LocalConnection>>;
  createConnectionPairing():Promise<Result<import('./api.ts').ConnectionPairing>>;
  getMcpConfig():Promise<Result<import('./api.ts').McpConnectionConfig>>;
  rotateConnectionCredentials():Promise<Result<void>>;
  getRevision():Promise<Result<string>>;
  openWeb():Promise<Result<void>>;
  downloadSkill(kind:import('./skills.ts').SkillKind):Promise<Result<string|null>>;
  createWork(input:NewWorkInput):Promise<Result<Work>>;
  saveWork(input:WorkInput):Promise<Result<Work>>;
  archiveWork(id:string,version:number,archived:boolean):Promise<Result<Work>>;
  saveWorld(input:WorldInput):Promise<Result<World>>;
  selectWork(id:string):Promise<Result<string>>;
  snapshot(): Promise<Result<LibrarySnapshot>>;
  importMedia(worldId:string):Promise<Result<MediaImportReport|null>>;
  saveMedia(input:MediaInput):Promise<Result<MediaAsset>>;
  archiveMedia(id:string,version:number,archived:boolean):Promise<Result<MediaAsset>>;
  saveMediaCatalog(input:MediaCatalogInput):Promise<Result<MediaCatalog>>;
  saveDashboard(input:WorkDashboardInput):Promise<Result<WorkDashboard>>;
  saveOutline(input:OutlineInput): Promise<Result<WorkOutline>>;
  saveChapter(input:ChapterInput): Promise<Result<Chapter>>;
  archiveChapter(id:string,version:number,archived:boolean): Promise<Result<Chapter>>;
  saveCharacter(input: CharacterInput): Promise<Result<Character>>;
  archiveCharacter(id: string, version: number, archived: boolean): Promise<Result<Character>>;
  pickPortrait(worldId: string): Promise<Result<Asset | null>>;
  saveTag(input: TagInput): Promise<Result<Tag>>;
  deleteTag(id: string, version: number): Promise<Result<void>>;
  setThemePreferences(patch: ThemePatch): Promise<Result<ThemePreferences>>;
  setTheme(theme: ThemeId): Promise<Result<ThemeId>>;
  saveAttributeTemplate(input:AttributeTemplateInput): Promise<Result<AttributeTemplate>>;
  saveCharacterVariants(input:CharacterVariantsInput): Promise<Result<Character>>;
  saveCharacterStage(input:CharacterStageInput): Promise<Result<CharacterStage>>;
  reorderCharacterStages(characterId:string,expectedVersion:number,stageIds:string[]): Promise<Result<Character>>;
  saveRelationType(input:RelationTypeInput): Promise<Result<RelationType>>;
  saveRelation(input:RelationInput): Promise<Result<CharacterRelation>>;
  archiveRelation(id:string,version:number,archived:boolean): Promise<Result<CharacterRelation>>;
  saveGraphLayout(input:GraphLayoutInput): Promise<Result<GraphLayout>>;
  saveWorldCategory(input:WorldCategoryInput): Promise<Result<WorldCategory>>;
  saveWorldEntry(input:WorldEntryInput): Promise<Result<WorldEntry>>;
  archiveWorldEntry(id:string,version:number,archived:boolean): Promise<Result<WorldEntry>>;
  pickWorldImage(worldId:string): Promise<Result<Asset|null>>;
  saveTimeline(input:TimelineInput): Promise<Result<WorldTimeline>>;
  archiveTimeline(id:string,version:number,archived:boolean): Promise<Result<WorldTimeline>>;
  saveMap(input:WorldMapInput): Promise<Result<WorldMap>>;
  archiveMap(id:string,version:number,archived:boolean): Promise<Result<WorldMap>>;
  pickMapImage(worldId:string): Promise<Result<Asset|null>>;
}
