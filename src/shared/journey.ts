import type { AttributeTemplate, Character, CharacterForm, CharacterProfile, ResolvedForm } from './types.ts';
export const BASE_FORM = 'base';
export function characterSearchText(c:Character):string {
  const identities=[...c.identities,...c.stages.flatMap(s=>s.snapshot.identities)];
  return [c.name,c.caption,c.intro,...c.tags.map(t=>t.name),...identities.flatMap(i=>[i.name,i.alias,i.title,i.organization])].join('\n').toLowerCase();
}
export function profileOf(c:Character):CharacterProfile {
  const {name,caption,status,quote,intro,body,pending,abilities,facts,tags,designImageId,portraitId,portraitWidth,attributes}=c;
  return structuredClone({name,caption,status,quote,intro,body,pending,abilities,facts,tags,designImageId,portraitId,portraitWidth,attributes});
}
export function resolveForms(profile:CharacterProfile,forms:CharacterForm[],templates:AttributeTemplate[],includeInactive=false):ResolvedForm[] {
  const schemas=(attributes:CharacterProfile['attributes'])=>templates.filter(t=>t.id===attributes.templateId || Object.hasOwn(attributes.values,t.id));
  return [{id:BASE_FORM,name:'基础形态',appearance:'',condition:'',cost:'',abilities:profile.abilities,portraitId:profile.portraitId,portraitWidth:profile.portraitWidth,attributes:profile.attributes,attributeSchemas:schemas(profile.attributes)},
    ...forms.filter(f=>includeInactive || f.active).map(f=>{
      const attributes=f.attributeMode==='inherit' ? profile.attributes : f.attributes;
      return {id:f.id,name:f.name,appearance:f.appearance,condition:f.condition,cost:f.cost,abilities:f.abilities ?? profile.abilities,
        portraitId:f.portraitMode==='inherit' ? profile.portraitId : f.portraitMode==='none' ? null : f.portraitId,
        portraitWidth:f.portraitMode==='inherit' ? profile.portraitWidth : f.portraitWidth,attributes,attributeSchemas:schemas(attributes)};
    })];
}
