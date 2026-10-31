import type { Character, CharacterRelation } from './types.ts';
export function relationsForCharacter(relations:CharacterRelation[],characterId:string,stageId:string|null=null):CharacterRelation[] {
  return relations.filter(r=>(r.sourceId===characterId&&(!stageId||r.sourceStageId===null||r.sourceStageId===stageId))||(r.targetId===characterId&&(!stageId||r.targetStageId===null||r.targetStageId===stageId)));
}
export function relationEndpoint(character:Character|undefined,stageId:string|null):string {
  return `${character?.name??'人物不存在'}${stageId?' · '+(character?.stages.find(s=>s.id===stageId)?.name??'阶段不存在'):''}`;
}
