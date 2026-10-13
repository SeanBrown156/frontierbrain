// Which regulation the app calls "current", and the records behind it. knowledge/regulations/index.json names the
// active regulation (and the next one when it is known); knowledge/regulations/<id>.json holds each record. Read through
// the usual data channels (data directory, then shared rows, then the repository) so a switch ships as data, no deploy.
// The routine in regulation-routine.ts is the only writer. A switch changes this label only: teams, replays and data
// are never rewritten, and the pinned engine (tools/mechanics.ts FORMAT) stays what it is until it is verified.
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE,ROOT,optionalJSON,listDir} from './io.ts';

export type RegulationStatus='active'|'upcoming'|'ended'|'draft';
export interface RegulationRecord {
  id:string;game?:string;battleType?:string;officialURL?:string;startsAt?:string;endsAt?:string;verifiedAt?:string;
  status?:RegulationStatus;confidence?:'official'|'secondary';engine?:{verified:boolean;format?:string;note?:string};
  showdownFormats?:string[];megaEvolutionPerBattle?:number|null;duplicateHeldItems?:boolean|null;timers?:any;
  eligibilityPolicy?:string;notes?:string;discoveredAt?:string;evidence?:string[];[key:string]:any;
}
export interface HistoryEntry {id:string;switchedAt:string;from:string;to:string;confidence:'official'|'secondary';evidence:string[]}
export interface RegulationIndex {
  active:string;next:string|null;nextCheckAt:string;lastCheckedAt:string|null;history:HistoryEntry[];
  lastError?:string|null;errorStreak?:number;issuesRequested?:string[];
  // Optional overrides: where announcements are looked for (defaults come from the active record's official URL).
  sources?:{official?:string[];secondary?:string[]};
}
export interface RegulationNotice {id:string;at:string;kind:'regulation';level:'info'|'warning';title:string;body:string;url?:string}
export interface RegulationState {index:RegulationIndex;records:Record<string,RegulationRecord>}

export const REGULATIONS_DIR='knowledge/regulations';
export const INDEX_PATH=`${REGULATIONS_DIR}/index.json`,NOTICES_PATH=`${REGULATIONS_DIR}/notices.json`;
export const recordPath=(id:string)=>`${REGULATIONS_DIR}/${id.toLowerCase()}.json`;
const RESERVED=new Set(['index.json','notices.json']);
const dayMs=86_400_000;

// An index for a data directory that predates the routine: the only shipped record is the active one.
function defaultIndex(records:Record<string,RegulationRecord>):RegulationIndex{
  const ids=Object.keys(records);const active=ids.find(id=>records[id].status==='active')??ids[0]??'M-C';
  return {active,next:null,nextCheckAt:records[active]?.endsAt??new Date(0).toISOString(),lastCheckedAt:null,history:[]};
}
function assemble(index:RegulationIndex|null,records:Record<string,RegulationRecord>):RegulationState|null{
  if(!index&&!Object.keys(records).length)return null;const i=index??defaultIndex(records);
  return {index:{...i,history:i.history??[]},records};
}

// Async: through the data channels (hosted shared rows included). Null when no regulation record exists at all.
export async function loadRegulations():Promise<RegulationState|null>{
  const index=await optionalJSON<RegulationIndex|null>(INDEX_PATH,null);const records:Record<string,RegulationRecord>={};
  const names=new Set((await listDir(REGULATIONS_DIR).catch(()=>[] as string[])).filter(f=>f.endsWith('.json')&&!RESERVED.has(f)));
  for(const id of [index?.active,index?.next,...(index?.history??[]).flatMap(h=>[h.from,h.to])])if(id)names.add(`${id.toLowerCase()}.json`);
  for(const f of names){const r=await optionalJSON<RegulationRecord|null>(`${REGULATIONS_DIR}/${f}`,null);if(r?.id)records[r.id]=r;}
  return assemble(index,records);
}
// Sync (the rules and primer are built synchronously): data directory first, then the repository.
export function loadRegulationsSync(roots:string[]=[ROOT,CODE]):RegulationState|null{
  const read=(rel:string)=>{for(const root of new Set(roots)){const p=resolve(root,rel);if(existsSync(p)){try{return JSON.parse(readFileSync(p,'utf8'));}catch{}}}return null;};
  const index=read(INDEX_PATH) as RegulationIndex|null;const records:Record<string,RegulationRecord>={};
  const files=new Set<string>();for(const root of new Set(roots)){try{for(const f of readdirSync(resolve(root,REGULATIONS_DIR)))if(f.endsWith('.json')&&!RESERVED.has(f))files.add(f);}catch{}}
  for(const f of files){const r=read(`${REGULATIONS_DIR}/${f}`) as RegulationRecord|null;if(r?.id)records[r.id]=r;}
  return assemble(index,records);
}
// Hosted requests prime this from the shared rows; otherwise the files are read on every call (they are tiny).
let primed:{at:number;state:RegulationState|null}|null=null;
export async function refreshRegulations(maxAgeMs=60_000){
  if(primed&&Date.now()-primed.at<maxAgeMs)return primed.state;
  try{primed={at:Date.now(),state:await loadRegulations()};}catch{primed=null;}return primed?.state??loadRegulationsSync();
}
export const resetRegulationCache=()=>{primed=null;};
export const currentRegulations=()=>primed&&Date.now()-primed.at<5*60_000?primed.state:loadRegulationsSync();

// The record the app calls current. A record without an explicit status is read as active when the index names it.
export function activeRegulation(state:RegulationState|null=currentRegulations()):RegulationRecord|null{
  return state?state.records[state.index.active]??null:null;
}
export const nextRegulation=(state:RegulationState|null=currentRegulations())=>state?.index.next?state.records[state.index.next]??null:null;
export const recordForFormat=(state:RegulationState|null,format:string)=>{
  const f=format.replace(/bo3$/,'');return state?Object.values(state.records).find(r=>(r.showdownFormats??[]).some(x=>x.replace(/bo3$/,'')===f||x===format))??null:null;
};
export const isoDate=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)&&Number.isFinite(Date.parse(v));

// Structural problems, one string each (empty = valid). The routine refuses to write an index that fails this.
export function validateRegulations(index:RegulationIndex,records:Record<string,RegulationRecord>):string[]{
  const p:string[]=[];const rec=(id:string|null|undefined)=>id?records[id]:undefined;
  if(!index.active)p.push('index.active is required');else if(!rec(index.active))p.push(`active regulation ${index.active} has no record`);
  if(index.next){const n=rec(index.next);if(!n)p.push(`next regulation ${index.next} has no record`);else if(!['upcoming','draft'].includes(n.status??''))p.push(`next ${index.next} must be upcoming or draft, not ${n.status}`);if(index.next===index.active)p.push('next equals active');}
  if(!isoDate(index.nextCheckAt))p.push('index.nextCheckAt must be an ISO UTC timestamp');
  if(index.lastCheckedAt!=null&&!isoDate(index.lastCheckedAt))p.push('index.lastCheckedAt must be an ISO UTC timestamp or null');
  const actives=Object.values(records).filter(r=>r.status==='active');
  if(actives.length>1)p.push(`more than one record is active: ${actives.map(r=>r.id).join(', ')}`);
  if(actives.length===1&&actives[0].id!==index.active)p.push(`record ${actives[0].id} is active but the index names ${index.active}`);
  for(const r of Object.values(records)){
    if(r.status&&!['active','upcoming','ended','draft'].includes(r.status))p.push(`${r.id}: unknown status ${r.status}`);
    if(r.confidence&&!['official','secondary'].includes(r.confidence))p.push(`${r.id}: unknown confidence ${r.confidence}`);
    for(const k of ['startsAt','endsAt'] as const)if(r[k]!=null&&!isoDate(r[k]))p.push(`${r.id}: ${k} must be an ISO UTC timestamp`);
    if(r.startsAt&&r.endsAt&&Date.parse(r.startsAt)>=Date.parse(r.endsAt))p.push(`${r.id}: startsAt must be before endsAt`);
    if(r.status==='upcoming'||r.id===index.active){if(!r.officialURL||!/^https:\/\//.test(r.officialURL))p.push(`${r.id}: officialURL (https) is required`);if(!r.startsAt)p.push(`${r.id}: startsAt is required`);}
    if(r.status==='upcoming'&&r.confidence!=='official')p.push(`${r.id}: an upcoming regulation must have official confidence`);
    if(r.engine&&typeof r.engine.verified!=='boolean')p.push(`${r.id}: engine.verified must be a boolean`);
  }
  for(const h of index.history??[]){
    if(!h.id||!h.from||!h.to||!isoDate(h.switchedAt)||!Array.isArray(h.evidence)||!['official','secondary'].includes(h.confidence))p.push(`history entry ${h.id??'?'} is malformed`);
  }
  return p;
}
export function validateNotices(file:unknown):string[]{
  const p:string[]=[];const n=(file as any)?.notices;if(!Array.isArray(n))return ['notices must be an array'];
  if(n.length>50)p.push('notices holds more than 50 entries');const ids=new Set<string>();
  for(const x of n){
    if(!x.id||ids.has(x.id))p.push(`duplicate or empty notice id ${x.id}`);ids.add(x.id);
    if(!isoDate(x.at))p.push(`${x.id}: at must be an ISO UTC timestamp`);if(x.kind!=='regulation')p.push(`${x.id}: kind must be "regulation"`);
    if(!['info','warning'].includes(x.level))p.push(`${x.id}: level`);if(!x.title||!x.body)p.push(`${x.id}: title and body are required`);
    if(x.url!=null&&!/^https:\/\//.test(x.url))p.push(`${x.id}: url must be https`);
  }
  return p;
}

// The status object the banner, rules and primer read. `format` omitted means "the regulation the app calls current".
export function regulationStatusFor(state:RegulationState|null,format:string|undefined,now:number){
  const reg=format?recordForFormat(state,format):activeRegulation(state);
  if(!state||!reg)return null;
  const ends=reg.endsAt?Date.parse(reg.endsAt):null,starts=reg.startsAt?Date.parse(reg.startsAt):null;
  const daysLeft=ends==null?null:Math.ceil((ends-now)/dayMs);
  const status=ends!=null&&now>ends?'ended':starts!=null&&now<starts?'upcoming':daysLeft!=null&&daysLeft<=21?'ending':'active';
  const isActive=reg.id===state.index.active;
  const last=[...state.index.history].reverse().find(h=>h.to===reg.id);
  const switched=isActive&&last&&now-Date.parse(last.switchedAt)<14*dayMs&&now>=Date.parse(last.switchedAt)?{at:last.switchedAt,from:last.from,confidence:last.confidence}:null;
  const n=isActive?nextRegulation(state):null;
  return {id:reg.id,format:(reg.showdownFormats?.[0]??'').replace(/bo3$/,'')||undefined,startsAt:reg.startsAt as string,endsAt:reg.endsAt as string,verifiedAt:reg.verifiedAt as string,
    source:reg.officialURL as string,status,daysLeft:daysLeft as number,isActive,confidence:reg.confidence??'official',
    // The pinned engine only knows what the record says it verified. Anything else is "not verified yet".
    engineVerified:reg.engine?.verified===true,switched,
    next:n?{id:n.id,startsAt:n.startsAt??null,endsAt:n.endsAt??null,status:n.status??'draft',confidence:n.confidence??'secondary',source:n.officialURL??null}:null};
}
