import type {Chapter,ChapterInput,WorkOutline} from './types.ts';

export interface ChapterDraft {format:1;generation:string;workId:string;input:ChapterInput;baseline:string;savedAt:string}
export function parseChapterDraft(raw:string,workId:string):ChapterDraft|null{
  try{const d=JSON.parse(raw) as ChapterDraft;
    if(d.format!==1||d.workId!==workId||typeof d.generation!=='string'||typeof d.baseline!=='string'||!Number.isFinite(Date.parse(d.savedAt))||!d.input||d.input.workId!==workId||typeof d.input.name!=='string'||typeof d.input.body!=='string'||!Number.isSafeInteger(d.input.expectedVersion)||!Number.isSafeInteger(d.input.expectedOutlineVersion))return null;
    const baseline=JSON.parse(d.baseline);if(!baseline||baseline.workId!==workId||baseline.id!==d.input.id||baseline.expectedVersion!==d.input.expectedVersion||baseline.expectedOutlineVersion!==d.input.expectedOutlineVersion)return null;
    return d;
  }catch{return null;}
}
export function chapterDraftConflict(d:ChapterDraft,generation:string,chapters:Chapter[],outline:WorkOutline):string|null{
  if(d.generation!==generation)return '资料库已恢复到其他时间点。';
  const current=chapters.find(c=>c.id===d.input.id);
  if(d.input.id&&(!current||current.archived||current.version!==d.input.expectedVersion))return '章节已被修改、归档或删除。';
  if(outline.version!==d.input.expectedOutlineVersion)return '章节目录已有修改。';
  return null;
}
