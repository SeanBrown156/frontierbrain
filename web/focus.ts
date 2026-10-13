// Tells the server what the player is looking at, so an assistant connected over MCP can answer "this one".
// Ids and calc inputs only, never anything typed. Throttled to one post per 2 s (the latest state wins), sent only
// from the visible tab, and silent when it fails (it is a convenience, not part of saving).
import {api} from './ui.tsx';
const tab=Math.random().toString(36).slice(2,10);
let base:any=null,detail:any={},last=0,timer:ReturnType<typeof setTimeout>|undefined,lastSent='';
function flush(){timer=undefined;if(!base||document.visibilityState!=='visible')return;
  const body={...base,...detail,tab},s=JSON.stringify(body);if(s===lastSent)return;lastSent=s;last=Date.now();void api('/focus',body).catch(()=>{});}
function schedule(){if(timer)return;timer=setTimeout(flush,Math.max(0,2000-(Date.now()-last)));}
// The page, team, version and slot (one object, from the same route state the Ask dock reads).
export function setFocusBase(next:{page:string;teamId?:string;versionId?:string;slot?:number}){base=next;schedule();}
// Extra detail from the open panel: {replayId} or {calc:{kind,input}}; pass undefined to clear a key.
export function setFocusDetail(patch:{replayId?:string;calc?:{kind:'damage'|'speed';input:any}}){detail={...detail,...patch};schedule();}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastSent='';schedule();}});
