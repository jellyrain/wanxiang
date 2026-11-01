import type {CatalogKind,CatalogRecord,LibraryConfig,LibrarySnapshot,RecordKind,RecordConfig} from './types.ts';

export const recordKinds:Record<RecordKind,string>={character:'人物',item:'物品',technique:'功法',place:'地点'};
export const categoryLabels:Record<CatalogKind,string>={item:'物品类别',technique:'功法流派',place:'地点类型'};
export const initialItemCategories=[['equipment','装备'],['prop','道具'],['material','材料'],['consumable','消耗品'],['other','其他物品']];
export const emptyRecordConfig=():RecordConfig=>({categories:[],fields:[],templateId:null});
export function libraryConfig(library:LibrarySnapshot,worldId:string):LibraryConfig {
  return library.libraryConfigs?.find(c=>c.worldId===worldId)??{worldId,version:0,updatedAt:'',groups:{character:{...emptyRecordConfig(),templateId:library.attributeDefaults.find(d=>d.worldId===worldId)?.templateId??null},item:{...emptyRecordConfig(),categories:initialItemCategories.map(([id,name])=>({id,name,active:true}))},technique:emptyRecordConfig(),place:emptyRecordConfig()}};
}
export function categoryName(record:CatalogRecord,config:LibraryConfig):string {
  const category=config.groups[record.kind].categories.find(c=>c.id===record.categoryId);
  return category?.name??(record.categoryId===null?'':record.kind==='item'?initialItemCategories.find(([id])=>id===record.itemType)?.[1]??record.itemType:record.kind==='technique'?record.school:record.placeType);
}
export function catalogSearchText(record:CatalogRecord,library:LibrarySnapshot):string {
  const text=(value:unknown):string=>typeof value==='string'?value:Array.isArray(value)?value.map(text).join(' '):value&&typeof value==='object'?Object.entries(value).filter(([k])=>!/(^id$|Ids?$|At$|^worldId$)/.test(k)).map(([,v])=>text(v)).join(' '):'';
  return [text(record),categoryName(record,libraryConfig(library,record.worldId)),...library.tags.filter(t=>record.tagIds.includes(t.id)).map(t=>t.name)].join(' ').toLocaleLowerCase();
}
