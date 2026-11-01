import type {CatalogKind,CatalogRecord,CatalogInput,ItemInput,TechniqueInput,PlaceInput,CatalogLinkTarget} from './types.ts';

export const catalogLabels={item:'物品库',technique:'功法库',place:'地点库'} as const;
export const catalogNames={item:'物品',technique:'功法',place:'地点'} as const;
export const catalogIcons={item:'item',technique:'technique',place:'place'} as const;
export function hasCatalogLink(record:CatalogRecord,target:CatalogLinkTarget):boolean {
  if(target.kind==='worldEntry')return record.entryIds.includes(target.id);
  if(target.kind==='mapLocation')return record.kind==='place'&&record.positions.some(p=>p.mapId===target.id&&p.locationId===target.locationId);
  return record.kind==='item'?record.holders.some(h=>h.characterId===target.id):record.kind==='technique'?record.practitioners.some(p=>p.characterId===target.id):record.characterIds.includes(target.id);
}
export const itemTypes={equipment:'装备',prop:'道具',material:'材料',consumable:'消耗品',other:'其他物品'} as const;
export const holdingStates={stored:'持有',equipped:'装备中',spent:'已消耗',lost:'已失去'} as const;
export const practiceStates={learning:'修习中',mastered:'已掌握',paused:'暂停',abandoned:'已放弃'} as const;
export function blankCatalog(kind:CatalogKind,worldId:string):CatalogInput {
  const base={designImageId:null,tagIds:[],attributes:{templateId:null,values:{},versions:{}},facts:[],worldId,expectedVersion:0,name:'',aliases:'',summary:'',body:'',pending:'',source:'',status:'draft' as const,imageId:null,entryIds:[]};
  if(kind==='item')return {...base,kind,itemType:'equipment',rarity:'',effect:'',usage:'',cost:'',holders:[]} satisfies ItemInput;
  if(kind==='technique')return {...base,kind,school:'',requirements:'',effect:'',cost:'',levels:'',practitioners:[]} satisfies TechniqueInput;
  return {...base,kind,placeType:'',region:'',environment:'',access:'',characterIds:[],positions:[]} satisfies PlaceInput;
}
export function catalogInput(record:CatalogRecord):CatalogInput {const {version,updatedAt,archived,...value}=record;return structuredClone({...value,expectedVersion:version});}
