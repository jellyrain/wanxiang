import type { Chapter, ChapterInput, Work, WorkOutline, OutlineInput } from './types.ts';

export const chapterStatuses={planned:'待写',draft:'初稿',revising:'修订中',finished:'定稿'} as const;
export function emptyOutline(work:Pick<Work,'id'|'worldId'>):WorkOutline {
  return {workId:work.id,worldId:work.worldId,synopsis:'',volumes:[],chapterIds:[],version:0,updatedAt:''};
}
export function outlineInput(outline:WorkOutline):OutlineInput {
  const {workId,synopsis,volumes,chapterIds,version}=outline;
  return structuredClone({workId,synopsis,volumes,chapterIds,expectedVersion:version});
}
export function chapterInput(chapter:Chapter,outline:WorkOutline):ChapterInput {
  const {id,workId,volumeId,name,summary,body,notes,status,participants,events,entryIds,mapProgress,version}=chapter;
  return structuredClone({id,workId,volumeId,name,summary,body,notes,status,participants,events,entryIds,mapProgress,expectedVersion:version,expectedOutlineVersion:outline.version});
}
export function blankChapter(outline:WorkOutline,volumeId:string|null=null):ChapterInput {
  return {workId:outline.workId,volumeId,name:'',summary:'',body:'',notes:'',status:'planned',participants:[],events:[],entryIds:[],mapProgress:[],expectedVersion:0,expectedOutlineVersion:outline.version};
}
export function orderedChapters(outline:WorkOutline,chapters:Chapter[]):Chapter[] {
  const lookup=new Map(chapters.filter(c=>c.workId===outline.workId).map(c=>[c.id,c]));
  const ordered=outline.chapterIds.flatMap(id=>lookup.has(id)?[lookup.get(id)!]:[]);
  return [...outline.volumes.map(v=>v.id),null].flatMap(id=>ordered.filter(c=>c.volumeId===id));
}
export function moveChapter(outline:WorkOutline,chapters:Chapter[],id:string,offset:-1|1,includeArchived=false):string[] {
  const chapter=chapters.find(c=>c.id===id&&c.workId===outline.workId);
  if(!chapter)return outline.chapterIds;
  const siblings=orderedChapters(outline,chapters).filter(c=>c.volumeId===chapter.volumeId&&(includeArchived||!c.archived));
  const index=siblings.findIndex(c=>c.id===id),target=siblings[index+offset];
  if(index<0||!target)return outline.chapterIds;
  const ids=[...outline.chapterIds],a=ids.indexOf(id),b=ids.indexOf(target.id);
  [ids[a],ids[b]]=[ids[b],ids[a]];return ids;
}
// Chinese-friendly character count. Includes punctuation; excludes whitespace.
export function textCount(text:string):number {return Array.from(text.replace(/\s/gu,'')).length;}
