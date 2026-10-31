import type {HistoryKind,HistoryDifference,LibrarySnapshot} from './types.ts';

export const HISTORY_KINDS:Record<HistoryKind,string>={place:'地点',technique:'功法',item:'物品',character:'人物档案',worldEntry:'世界条目',worldCategory:'世界分类',relation:'人物关系',relationType:'关系类型',map:'地图',timeline:'年表',chapter:'章节',outline:'大纲与目录',media:'素材资料',mediaCatalog:'素材分类与标签',dashboard:'创作计划',work:'作品信息',world:'世界信息'};
export function historyEntities(library:LibrarySnapshot,kind:HistoryKind):{id:string;name:string;scope:string;version:number;value:object}[] {
  const scope=(worldId:string)=>library.worlds.find(w=>w.id===worldId)?.name??worldId;
  const workName=(workId:string)=>library.works.find(w=>w.id===workId)?.name??workId;
  const named=(items:{id:string;name:string;worldId:string;version:number;archived?:boolean}[])=>items.map(v=>({id:v.id,name:v.name+(v.archived?'（已归档）':''),scope:scope(v.worldId),version:v.version,value:v}));
  switch(kind){
    case 'place':return named(library.places??[]);
    case 'technique':return named(library.techniques??[]);
    case 'item':return named(library.items??[]);
    case 'character':return named(library.characters);
    case 'worldEntry':return named(library.worldEntries);
    case 'worldCategory':return named(library.worldCategories);
    case 'relationType':return named(library.relationTypes);
    case 'map':return named(library.maps);
    case 'timeline':return named(library.timelines);
    case 'chapter':return named(library.chapters).map(v=>({...v,scope:workName(library.chapters.find(c=>c.id===v.id)!.workId)}));
    case 'media':return named(library.media);
    case 'work':return named(library.works);
    case 'world':return library.worlds.map(v=>({id:v.id,name:v.name,scope:'共用世界',version:v.version,value:v}));
    case 'relation':return library.relations.map(v=>({id:v.id,name:`${library.characters.find(c=>c.id===v.sourceId)?.name??'未知人物'} · ${v.label||library.relationTypes.find(t=>t.id===v.typeId)?.name||'关系'} · ${library.characters.find(c=>c.id===v.targetId)?.name??'未知人物'}`,scope:scope(v.worldId),version:v.version,value:v}));
    case 'mediaCatalog':return library.mediaCatalogs.map(v=>({id:v.worldId,name:scope(v.worldId),scope:'素材分类与标签',version:v.version,value:v}));
    case 'dashboard':return library.dashboards.map(v=>({id:v.workId,name:workName(v.workId),scope:scope(v.worldId),version:v.version,value:v}));
    case 'outline':return library.outlines.map(v=>({id:v.workId,name:workName(v.workId),scope:scope(v.worldId),version:v.version,value:v}));
  }
}

const metadata=new Set(['version','versions','updatedAt','createdAt','capturedAt','sourceVersion']);
const extraRoot=new Set(['id','worldId','workId','worldName','attributeSchemas','category','references','type','sourceName','targetName','sourceStage','targetStage','fileName','mime','width','height','byteSize','importedAt']);
function comparable(value:unknown,root=false):unknown {
  if(Array.isArray(value))return value.map(v=>comparable(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!metadata.has(key)&&!(root&&extraRoot.has(key))).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,comparable(v)]));
  return value;
}
export function historyDifferences(current:object,target:object):HistoryDifference[] {
  const before=comparable(current,true) as Record<string,unknown>,after=comparable(target,true) as Record<string,unknown>;
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])).map(field=>({field,before:before[field]??null,after:after[field]??null}));
}
export const HISTORY_FIELDS:Record<string,string>={designImageId:'设定图',itemType:'物品类型',rarity:'品阶',effect:'效果',usage:'使用条件',holders:'持有与装备',quantity:'数量',state:'状态',school:'流派',requirements:'修习条件',levels:'层级与阶段',practitioners:'修习人物',progress:'修习进度',placeType:'场地类型',region:'所属区域',environment:'环境与布局',access:'进入条件',positions:'地图位置',name:'名称',caption:'称号',status:'状态',quote:'题记',intro:'简介',body:'正文',pending:'待定内容',facts:'自定义字段',tags:'标签',tagIds:'标签',portraitId:'人物图片',portraitWidth:'图片取景',archived:'已归档',attributes:'属性数值',abilities:'能力',identities:'身份',forms:'形态',defaultFormId:'默认形态',stages:'阶段',categoryId:'分类',aliases:'别名',summary:'概要',source:'来源',links:'关联资料',description:'说明',color:'颜色',active:'启用',sourceId:'起点人物',targetId:'终点人物',sourceStageId:'起点阶段',targetStageId:'终点阶段',typeId:'关系类型',label:'名称',direction:'方向',backgroundId:'底图',locations:'地点',terrain:'地形',eras:'时代',events:'事件',volumeId:'所属分卷',notes:'备注',participants:'参与人物',entryIds:'世界条目',mapProgress:'地图进度',synopsis:'故事大纲',volumes:'分卷',chapterIds:'章节顺序',prompt:'提示词',favorite:'收藏',categories:'分类',genre:'题材',phase:'创作阶段',coverId:'封面',coverFlip:'封面镜像',targetCharacters:'目标字数',memo:'备忘',tasks:'待办',id:'编号',value:'内容',alias:'化名',title:'称号',organization:'所属势力',visibility:'公开范围',appearance:'外观',condition:'触发条件',cost:'代价',portraitMode:'图片模式',attributeMode:'属性模式',templateId:'属性模板',values:'数值',period:'时期',snapshot:'阶段存档',profile:'基础档案',characterId:'人物',stageId:'阶段',mapId:'地图',locationId:'地点',eventId:'事件',timelineId:'年表',done:'已完成',x:'横坐标',y:'纵坐标',kind:'类型',points:'路径',unlockStageId:'解锁阶段',imageId:'图片',characterIds:'人物',formIds:'形态',endPeriod:'结束时期',eraId:'时代',places:'地点'};
