import type { AttributeTemplate, Character, CharacterForm, CharacterIdentity, CharacterStage, CharacterStageInput, CharacterVariantsInput, StageSnapshot } from '../shared/types.ts';
import { BASE_FORM, profileOf, resolveForms } from '../shared/journey.ts';
import { emptyAttributes, validateAttributes } from './attributes.ts';

type Reject=(message:string)=>never;
export const validJourneyId=(v:unknown):v is string=>typeof v==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) && !['__proto__','constructor','prototype',BASE_FORM].includes(v);
function string(v:unknown,label:string,max:number,reject:Reject):string {if(typeof v!=='string'||v.length>max)return reject(`${label}格式不正确或内容过长。`);return v;}
function named(v:unknown,label:string,reject:Reject):string {const s=string(v,label,100,reject).trim();return s||reject(`请填写${label}。`);}
function array<T>(v:unknown,label:string,max:number,reject:Reject):T[] {if(!Array.isArray(v)||v.length>max)return reject(`${label}数量或格式不正确。`);return v;}

export function validateVariants(input:CharacterVariantsInput,current:Character,templates:AttributeTemplate[],assetAllowed:(id:string)=>boolean,reject:Reject) {
  const identities=input.identities===undefined ? current.identities : array<CharacterIdentity>(input.identities,'身份',60,reject).map(i=>{
    if(!i || !validJourneyId(i.id) || typeof i.active!=='boolean' || !['public','secret'].includes(i.visibility))return reject('身份信息不正确。');
    return {id:i.id,name:named(i.name,'身份名称',reject),alias:string(i.alias,'化名',100,reject),title:string(i.title,'称号',200,reject),organization:string(i.organization,'所属势力',200,reject),visibility:i.visibility,description:string(i.description,'身份说明',20000,reject),active:i.active};
  });
  const forms=input.forms===undefined ? current.forms : array<CharacterForm>(input.forms,'形态',40,reject).map(f=>{
    if(!f || !validJourneyId(f.id) || typeof f.active!=='boolean' || !['inherit','custom','none'].includes(f.portraitMode) || !['inherit','custom'].includes(f.attributeMode))return reject('形态信息不正确。');
    if(!Number.isFinite(f.portraitWidth)||f.portraitWidth<15||f.portraitWidth>100)return reject('形态图片取景范围不正确。');
    if(f.portraitId!==null && (typeof f.portraitId!=='string'||!assetAllowed(f.portraitId)))return reject('形态图片不属于当前世界。');
    if(f.portraitMode==='custom'&&!f.portraitId)return reject('请为独立图片选择一张图片，或改为共用基础图片。');
    const previous=current.forms.find(x=>x.id===f.id);
    const cloningBase=(!previous || (!previous.attributes.templateId&&!Object.keys(previous.attributes.values).length)) && JSON.stringify(f.attributes)===JSON.stringify(current.attributes);
    const attributes=validateAttributes(f.attributes,cloningBase ? current.attributes : previous?.attributes ?? emptyAttributes(),templates,reject);
    return {id:f.id,name:named(f.name,'形态名称',reject),appearance:string(f.appearance,'形态外观',20000,reject),condition:string(f.condition,'变化条件',10000,reject),cost:string(f.cost,'代价与限制',10000,reject),abilities:f.abilities===null ? null : string(f.abilities,'形态能力',50000,reject),portraitMode:f.portraitMode,portraitId:f.portraitId,portraitWidth:f.portraitWidth,attributeMode:f.attributeMode,attributes,active:f.active};
  });
  for(const [label,list,old] of [['身份',identities,current.identities],['形态',forms,current.forms]] as const) {
    if(new Set(list.map(i=>i.id)).size!==list.length)return reject(`${label}编号重复。`);
    if(new Set(list.map(i=>i.name)).size!==list.length)return reject(`${label}名称重复。`);
    if(old.some(i=>!list.some(n=>n.id===i.id)))return reject(`已有${label}请使用停用，资料与阶段记录会保留。`);
  }
  if(forms.some(f=>f.name==='基础形态'))return reject('“基础形态”已由人物基础档案使用，请为新增形态取另一个名称。');
  const defaultFormId=input.defaultFormId ?? current.defaultFormId;
  if(defaultFormId!==BASE_FORM && !forms.some(f=>f.id===defaultFormId&&f.active))return reject('默认展示形态必须是启用中的形态。');
  return {identities,forms,defaultFormId};
}

export function buildStage(input:CharacterStageInput,current:Character,previous:CharacterStage|undefined,templates:AttributeTemplate[],id:string,reject:Reject):CharacterStage {
  const name=named(input.name,'阶段名称',reject), period=string(input.period,'时间或章节',200,reject), summary=string(input.summary,'阶段说明',30000,reject);
  if(typeof input.archived!=='boolean' || (input.recapture!==undefined&&typeof input.recapture!=='boolean'))return reject('阶段状态不正确。');
  const identityIds=array<string>(input.identityIds,'阶段身份',60,reject), formIds=array<string>(input.formIds,'阶段形态',41,reject);
  if(new Set(identityIds).size!==identityIds.length || new Set(formIds).size!==formIds.length || identityIds.some(id=>!validJourneyId(id)) || formIds.some(id=>id!==BASE_FORM&&!validJourneyId(id)))return reject('阶段关联编号无效或重复。');
  if(!input.attributeValues || typeof input.attributeValues!=='object' || Array.isArray(input.attributeValues))return reject('阶段属性格式不正确。');
  const recapture=!previous || input.recapture===true;
  const profile=recapture ? profileOf(current) : previous.snapshot.profile;
  const liveForms=resolveForms(profileOf(current),current.forms,templates);
  const availableForms=recapture ? liveForms : [...previous.snapshot.forms,...liveForms.filter(f=>!previous.snapshot.forms.some(old=>old.id===f.id))];
  const liveIdentities=current.identities.filter(i=>i.active);
  const availableIdentities=recapture ? liveIdentities : [...previous.snapshot.identities,...liveIdentities.filter(i=>!previous.snapshot.identities.some(old=>old.id===i.id))];
  if(identityIds.some(id=>!availableIdentities.some(i=>i.id===id)))return reject('所选身份不属于该人物或已停用。');
  const selectedFormIds=[BASE_FORM,...formIds.filter(id=>id!==BASE_FORM)];
  if(selectedFormIds.some(id=>!availableForms.some(f=>f.id===id)) || !selectedFormIds.includes(input.defaultFormId))return reject('请从该阶段可用的形态中选择默认形态。');
  if(Object.keys(input.attributeValues).some(id=>!selectedFormIds.includes(id)))return reject('属性值关联了未选用的阶段形态。');
  const forms=selectedFormIds.map(formId=>{
    const form=structuredClone(availableForms.find(f=>f.id===formId)!);
    if(Object.hasOwn(input.attributeValues,formId)) form.attributes=validateAttributes(input.attributeValues[formId],form.attributes,form.attributeSchemas,reject);
    return form;
  });
  const snapshot:StageSnapshot={profile:structuredClone(profile),identities:identityIds.map(id=>structuredClone(availableIdentities.find(i=>i.id===id)!)),forms,defaultFormId:input.defaultFormId};
  const now=new Date().toISOString();
  return {id,name,period,summary,archived:input.archived,capturedAt:recapture ? now : previous.capturedAt,updatedAt:now,sourceVersion:recapture ? current.version : previous.sourceVersion,snapshot};
}
