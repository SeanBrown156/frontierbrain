import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
// Save state for the whole app: which editors hold unsaved drafts, and whether the last save worked. The header pill
// reads it; navigation asks before throwing a draft away. Also a tiny "offer" channel so the Ask Frontier Brain dock can
// hand a proposal to an open editor (it loads into the draft instead of saving behind the player's back).
type Status={state:'idle'|'saving'|'saved'|'error';at?:number;error?:string};
const dirty=new Map<string,string>();let status:Status={state:'idle'};const listeners=new Set<()=>void>();let snapshot={status,dirty:[] as string[]};
const emit=()=>{snapshot={status,dirty:[...dirty.values()]};for(const l of listeners)l();};
const subscribe=(l:()=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};};
export const useSaveState=()=>useSyncExternalStore(subscribe,()=>snapshot);
export const saving=()=>{status={state:'saving'};emit();};
export const saved=()=>{status={state:'saved',at:Date.now()};emit();};
export const failed=(error:string)=>{status={state:'error',at:Date.now(),error};emit();};
export const clearDirty=(key:string)=>{if(dirty.delete(key))emit();};
export const hasDirty=()=>dirty.size>0;
// Ask before discarding drafts. Returns true when it's fine to continue (and forgets the drafts).
export function confirmDiscard(){if(!dirty.size)return true;const ok=confirm(`Discard unsaved changes (${[...new Set(dirty.values())].join(', ')})?`);if(ok){dirty.clear();emit();}return ok;}
addEventListener('beforeunload',e=>{if(dirty.size){e.preventDefault();e.returnValue='';}});
export function useDirty(key:string,isDirty:boolean,label:string){
  useEffect(()=>{if(isDirty){dirty.set(key,label);emit();}else clearDirty(key);},[key,isDirty,label]);
  useEffect(()=>()=>clearDirty(key),[key]);
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// An editable copy of a saved value. `baseId` identifies the saved version (e.g. a revision id). When it changes
// because of this editor's own save, typing carries on untouched. When something else changed it under a clean draft
// the draft follows; under a dirty draft the player chooses (changedElsewhere). `guard` marks drafts that navigation
// should warn about (autosaving editors only guard drafts they can't save yet).
export function useDraft<T>(key:string,savedValue:T,baseId:string,label:string,{guard}:{guard?:boolean}={}){
  const [draft,setDraft]=useState<T>(()=>structuredClone(savedValue)),[origin,setOrigin]=useState<T>(()=>structuredClone(savedValue)),[base,setBase]=useState(baseId),[elsewhere,setElsewhere]=useState(false);
  const justSaved=useRef(false),own=useRef(new Set<string>()),draftRef=useRef(draft);draftRef.current=draft;
  const isDirty=!same(draft,origin);
  useEffect(()=>{if(baseId===base)return;
    if(own.current.has(baseId)){ // our own save came back: the saved copy becomes the origin; anything typed since stays
      if(same(draftRef.current,origin))setDraft(structuredClone(savedValue));setOrigin(structuredClone(savedValue));setBase(baseId);setElsewhere(false);justSaved.current=false;return;}
    if(!isDirty||justSaved.current||same(draft,savedValue)){justSaved.current=false;setDraft(structuredClone(savedValue));setOrigin(structuredClone(savedValue));setBase(baseId);setElsewhere(false);}
    else setElsewhere(true);},[baseId]);
  useDirty(key,guard??isDirty,label);
  return {draft,setDraft,dirty:isDirty,base,changedElsewhere:elsewhere,
    discard:()=>{setDraft(structuredClone(origin));},
    loadLatest:()=>{setDraft(structuredClone(savedValue));setOrigin(structuredClone(savedValue));setBase(baseId);setElsewhere(false);},
    keepMine:()=>{setOrigin(structuredClone(savedValue));setBase(baseId);setElsewhere(false);},
    // Call right before saving: the draft becomes the origin so the save's own reload doesn't look like a conflict.
    markSaving:(value:T=draftRef.current)=>{justSaved.current=true;setOrigin(structuredClone(value));},
    // After a save: the ids it produced are this editor's own (their arrival never counts as "changed elsewhere").
    markSaved:(id?:string)=>{if(id)own.current.add(id);},
    markFailed:()=>{justSaved.current=false;setOrigin(structuredClone(savedValue));}};
}
// Offers from the dock to whichever editor is open: `offer` returns false when nobody took it.
type Handler=(payload:any)=>boolean;const handlers=new Map<string,Set<Handler>>();
export function offer(channel:string,payload:any){for(const h of handlers.get(channel)??[])if(h(payload))return true;return false;}
export function useOffers(channel:string,handler:Handler){const ref=useRef(handler);ref.current=handler;
  useEffect(()=>{const h:Handler=p=>ref.current(p);if(!handlers.has(channel))handlers.set(channel,new Set());handlers.get(channel)!.add(h);return()=>{handlers.get(channel)!.delete(h);};},[channel]);}
// Offers waiting for an editor that isn't mounted yet (e.g. a strategy accepted from another tab).
const pending=new Map<string,any>();
export const leaveOffer=(channel:string,payload:any)=>{pending.set(channel,payload);};
export const takeOffer=(channel:string)=>{const p=pending.get(channel);pending.delete(channel);return p;};
