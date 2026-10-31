import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SKILL_PACKAGES,type SkillKind} from '../shared/skills.ts';
import {ContentError} from './store.ts';

export function readSkillPackage(directory:string|undefined,kind:unknown){
  if(typeof kind!=='string'||!Object.hasOwn(SKILL_PACKAGES,kind))throw new ContentError('NOT_FOUND','没有这个 Skill 下载包。');
  if(!directory)throw new ContentError('UNAVAILABLE','Skill 下载包尚未准备好，请更新软件后重试。');
  const pack=SKILL_PACKAGES[kind as SkillKind];
  let bytes:Buffer;
  try{bytes=readFileSync(join(directory,pack.fileName));}
  catch{throw new ContentError('UNAVAILABLE','Skill 下载包暂时无法读取，请更新软件后重试。');}
  return {...pack,bytes};
}
