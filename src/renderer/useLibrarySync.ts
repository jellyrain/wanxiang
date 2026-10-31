import {useEffect,useRef,useState} from 'react';
import type {LibrarySnapshot} from '../shared/types.ts';

/** Poll a cheap revision, not the full library; never replace an open draft. */
export function useLibrarySync(blocked:boolean,onSnapshot:(snapshot:LibrarySnapshot)=>void,generation?:string){
  const initialGeneration=useRef<string|undefined>(undefined);
  if(initialGeneration.current===undefined&&generation)initialGeneration.current=generation;
  const state=useRef({blocked,onSnapshot,generation});state.current={blocked,onSnapshot,generation:initialGeneration.current};
  const [offline,setOffline]=useState(false);
  const [restored,setRestored]=useState(false);
  useEffect(()=>{
    let alive=true,running=false,seen='';
    const blockedNow=()=>state.current.blocked||Boolean(document.querySelector('[role="dialog"],[role="alertdialog"]'));
    const check=async()=>{
      if(running||!window.studio||document.hidden)return;running=true;
      try{
        const revision=await window.studio.getRevision();if(!revision.ok)throw Error(revision.error.message);
        if(alive)setOffline(false);
        if(state.current.generation&&revision.value.split(':')[1]!==state.current.generation){
          if(alive)setRestored(true);
          if(!blockedNow())window.location.reload();
          return;
        }
        if(revision.value!==seen&&!blockedNow()){
          const snapshot=await window.studio.snapshot();if(!snapshot.ok)throw Error(snapshot.error.message);
          if(state.current.generation&&snapshot.value.generation!==state.current.generation){
            if(alive)setRestored(true);
            if(!blockedNow())window.location.reload();
            return;
          }
          if(alive&&!blockedNow()){state.current.onSnapshot(snapshot.value);seen=revision.value;}
        }
      }catch{if(alive)setOffline(true);}finally{running=false;}
    };
    const timer=setInterval(()=>void check(),2000);const focus=()=>void check();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[]);
  return {offline,restored};
}
