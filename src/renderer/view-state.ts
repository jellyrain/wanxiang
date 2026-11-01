import {useState,type Dispatch,type SetStateAction} from 'react';

/** UI preferences only; drafts and content never go through this cache. */
export function useViewState<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
  const storageKey='wanxiang-view:'+key;
  const [value,setValue]=useState<T>(()=>{try{const raw=sessionStorage.getItem(storageKey);if(raw!==null){const saved=JSON.parse(raw);if(saved===null||typeof saved===typeof initial||initial===null&&typeof saved==='string')return saved;}}catch{}return initial;});
  const update:Dispatch<SetStateAction<T>>=next=>setValue(previous=>{const saved=typeof next==='function'?(next as (previous:T)=>T)(previous):next;try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}return saved;});
  return [value,update];
}
