import type { MapLocation, MapStage, WorldMap, WorldMapInput } from './types.ts';
export const MAP_WIDTH=1600,MAP_HEIGHT=900;
export function locationDiscovered(stages:MapStage[],location:MapLocation,stageId:string) {
  const current=stages.findIndex(s=>s.id===stageId),unlock=stages.findIndex(s=>s.id===location.unlockStageId);
  return current>=0&&unlock>=0&&unlock<=current;
}
export function filterMapLocations(map:Pick<WorldMap,'locations'|'stages'>,mode:'author'|'explore',stageId:string,query:string,kind:string,favorites:boolean,includeArchived:boolean) {
  const search=query.trim().toLowerCase();
  return map.locations.filter(l=>{
    if(l.archived&&(!includeArchived||mode==='explore'))return false;
    const known=mode==='author'||locationDiscovered(map.stages,l,stageId);
    // Undiscovered details must not be searchable through category or favorite filters.
    if(!known)return !search&&!kind&&!favorites;
    return (!kind||l.kind===kind)&&(!favorites||l.favorite)&&(!search||`${l.name} ${l.kind} ${l.description}`.toLowerCase().includes(search));
  });
}
export function mapInput(map:WorldMap):WorldMapInput {
  return {id:map.id,worldId:map.worldId,expectedVersion:map.version,name:map.name,description:map.description,backgroundId:map.backgroundId,stages:structuredClone(map.stages),locations:structuredClone(map.locations),terrain:structuredClone(map.terrain)};
}
