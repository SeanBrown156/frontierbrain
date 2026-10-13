// Transient, assistant-facing state: what the player is looking at (focus) and the calcs an assistant ran over MCP.
// Both are small per-user files outside the revisioned workspace (hosted: user_files rows), so navigating or running
// a calc never bumps the workspace revision or causes a stale-edit conflict. Latest record only, no history, and
// nothing the player is typing: ids, a page name, a slot, and calc inputs.
import {randomUUID} from 'node:crypto';
import {optionalJSON,save} from './io.ts';
import {currentTeam} from './workbench-store.ts';
import type {Workbench} from '../shared/workbench.ts';

export const FOCUS_FILE='.cache/focus.json',CALCS_FILE='.cache/assistant-calcs.json';
export const FOCUS_STALE_MS=10*60_000,CALC_LIMIT=20,CALC_TTL_MS=24*3600_000;
export const PAGES=['welcome','teams','overview','strategy','replays','versions','slot','news','data','references','account','inbox'] as const;
export interface FocusCalc {kind:'damage'|'speed';input:any}
export interface Focus {page:string;teamId?:string;versionId?:string;slot?:number;replayId?:string;calc?:FocusCalc;at:string;tab:string}
export interface AssistantCalc {id:string;kind:'damage'|'speed';input:any;result:any;label:string;at:string;from?:'chat'}

const idLike=(v:unknown)=>typeof v==='string'&&/^[\w.:-]{1,80}$/.test(v)?v:undefined;
// Pokémon nicknames are free text: calc inputs keep the species and set fields, never the nickname.
const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='nickname').map(([k,x])=>[k,clean(x)])):v;
const small=(v:any,max=8000)=>{try{return JSON.stringify(v).length<=max;}catch{return false;}};
export function cleanFocus(input:any,now=new Date()):Focus{
  if(!input||typeof input!=='object')throw new Error('Expected a focus object');
  const page=(PAGES as readonly string[]).includes(input.page)?input.page:'teams';
  const slot=Number.isInteger(input.slot)&&input.slot>=0&&input.slot<6?input.slot:undefined;
  const c=input.calc,calc=c&&(c.kind==='damage'||c.kind==='speed')&&c.input&&typeof c.input==='object'&&small(c.input)?{kind:c.kind as 'damage'|'speed',input:clean(c.input)}:undefined;
  return {page,teamId:idLike(input.teamId),versionId:idLike(input.versionId),slot,replayId:idLike(input.replayId),...calc?{calc}:{},at:now.toISOString(),tab:idLike(input.tab)??'unknown'};
}
export const readFocus=()=>optionalJSON<Focus|null>(FOCUS_FILE,null);
export async function writeFocus(input:any){const f=cleanFocus(input);await save(FOCUS_FILE,f);return f;}

// "Viewing Perish Drum › Pokémon › Mawile (slot 2)": what the focus points at, resolved against the workspace.
export function describeFocus(db:Workbench,f:Focus){
  const team=f.teamId?db.teams.find(t=>t.id===f.teamId):undefined;const parts:string[]=[];
  const where:Record<string,string>={welcome:'the welcome page',teams:'the Teams page',news:'the news page',data:'the data pool',references:'the references page',account:'Account settings',inbox:'the Inbox'};
  if(!team){parts.push(where[f.page]??'Frontier Brain');}
  else{parts.push(team.name);const v=team.versions.find(x=>x.id===(f.versionId??team.activeVersionId));
    if(f.page==='slot'){parts.push('Pokémon');try{const view=currentTeam(db,team,v?.id);const sp=f.slot!==undefined?view.sets[f.slot]?.species:undefined;if(sp)parts.push(`${sp} (slot ${f.slot!+1})`);}catch{}}
    else parts.push(({overview:'Overview',strategy:'Strategy',replays:'Replays',versions:'Versions'} as any)[f.page]??'Overview');
    if(f.replayId)parts.push(`replay ${f.replayId}`);
    if(v&&team.versions.length>1&&f.page!=='slot')parts.push(`V${v.number}`);}
  if(f.calc){const i=f.calc.input;parts.push(f.calc.kind==='speed'?`speed check ${i.a?.species} vs ${i.b?.species}`:`calc ${i.attacker?.species} → ${i.defender?.species}${i.move?` (${i.move})`:''}`);}
  return 'Viewing '+parts.join(' › ');
}
export async function getFocus(db:Workbench,now=Date.now()){
  const f=await readFocus();if(!f)return {focus:null,description:'Nothing is open yet: the player has not opened Frontier Brain in a browser, or it has not reported its page.',stale:true};
  const age=Math.max(0,Math.round((now-Date.parse(f.at))/1000));const stale=age*1000>FOCUS_STALE_MS;
  const team=f.teamId?db.teams.find(t=>t.id===f.teamId):undefined;let pokemon:string|undefined;
  if(team&&f.slot!==undefined)try{pokemon=currentTeam(db,team,f.versionId).sets[f.slot]?.species;}catch{}
  return {focus:f,description:describeFocus(db,f),stale,ageSeconds:age,
    ...stale?{note:`This was reported ${Math.round(age/60)} minutes ago: the player may have moved on. Confirm before acting on "this".`}:{},
    ids:{teamId:team?.id,teamName:team?.name,versionId:f.versionId,slot:f.slot,pokemon,replayId:f.replayId},
    teamMissing:!!f.teamId&&!team};
}

// Calcs run over MCP: newest first, at most 20, each gone after a day. One server instance serialises writes.
let chain:Promise<unknown>=Promise.resolve();
const serial=<T>(fn:()=>Promise<T>)=>{const next=chain.then(fn,fn);chain=next.catch(()=>{});return next;};
const live=(list:AssistantCalc[],now=Date.now())=>list.filter(c=>now-Date.parse(c.at)<CALC_TTL_MS).slice(0,CALC_LIMIT);
export const listCalcs=async()=>live(await optionalJSON<AssistantCalc[]>(CALCS_FILE,[]));
const labelOf=(kind:string,i:any)=>kind==='speed'?`${i.a?.species} vs ${i.b?.species} (speed)`:`${i.attacker?.species} → ${i.defender?.species}${i.move?` · ${i.move}`:''}`;
export function addCalc(kind:'damage'|'speed',input:any,result:any,from?:'chat'){
  return serial(async()=>{const entry:AssistantCalc={id:randomUUID().slice(0,8),kind,input:clean(input),result,label:labelOf(kind,input??{}),at:new Date().toISOString(),...from?{from}:{}};
    await save(CALCS_FILE,[entry,...await listCalcs()].slice(0,CALC_LIMIT));return entry;});
}
export const removeCalc=(id:string)=>serial(async()=>{const list=await listCalcs();await save(CALCS_FILE,list.filter(c=>c.id!==id));});

// MCP: get_focus, plus a hook that records calc_damage / calc_speed results. Returns undefined when the tool is not ours.
export const focusTools=[
  {name:'get_focus',description:'What the player is looking at in Frontier Brain right now: the page, team, version, Pokémon slot, open replay and any calc on screen, with the ids the other tools accept (teamId, pokemon, replayId). Call this FIRST whenever the player says "this", "here", "that one" or "this game", then pass the ids it returns to get_team, update_set, replay_transcript and the rest. If stale is true the player may have moved on: say what you assumed. Read-only.',parameters:{type:'object',properties:{}}},
];
export const focusInstructions=`- Frontier Brain shows you what the player has open. When they say "this", "here", "that one" or "this game", call get_focus first and pass the ids it returns (teamId, pokemon, replayId) to the other tools; if it is stale or empty, ask which team or Pokémon they mean. Calcs you run with calc_damage and calc_speed also appear in the app (the Pokémon page's calc panel, under "From your assistant") with a calcId, so say "I've put it in your calc panel" and let the player open it; saving it as a benchmark stays explicit (save_benchmark).`;
export async function focusCall(name:string,db:Workbench,input:any,run:()=>Promise<any>){
  if(name==='get_focus')return getFocus(db);
  if(name==='calc_damage'||name==='calc_speed'){const out=await run();if(out&&typeof out==='object'&&!(out as any).error){const e=await addCalc(name==='calc_damage'?'damage':'speed',input,out);
    return {...out,calcId:e.id,inApp:'Open it from "From your assistant" beside the calc panel on the Pokémon page. Not saved as a benchmark.'};}return out;}
  return undefined;
}
