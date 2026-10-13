// The Inbox: everything waiting on the player, gathered from the same records the per-team views read. Nothing here
// is stored: unlinked replays are games with no association, suggestions are db.pending, summaries are linked games
// with no saved summary, calcs are the assistant-calcs queue, notices come from shared reference data. The only thing
// this file writes is which notices the player dismissed (inbox-state.json, per user; a user_files row when hosted).
import {json,optionalJSON,save,listDir} from './io.ts';
import {currentTeam} from './workbench-store.ts';
import {autoLink,type LinkResult} from './replay-link.ts';
import {speciesKey} from './mechanics.ts';
import {listCalcs} from './focus.ts';
import {BENCH_LABEL} from '../shared/workbench.ts';
import type {Game,ReplayIndex} from './replays.ts';
import type {Workbench} from '../shared/workbench.ts';

export const INBOX_KINDS=['unlinked-replay','suggestion','summaries','calc','notice'] as const;
export type InboxKind=typeof INBOX_KINDS[number];
export interface InboxItem {id:string;kind:InboxKind;at:string|null;title:string;detail?:string;href?:string;[k:string]:any}
export interface Inbox {items:InboxItem[];count:number;byKind:Record<InboxKind,number>}
export const STATE_FILE='inbox-state.json',NOTICES_FILE='knowledge/regulations/notices.json',MAX_DISMISSED=200;

const text=(v:unknown,max:number)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max):'';
export interface Notice {id:string;at:string;kind:'regulation';level:'info'|'warning';title:string;body:string;url?:string}
// Player-facing notices written by the regulation routine. A missing or malformed file, or a malformed entry, is
// skipped rather than an error: the Inbox must never fail because of this file. Links are https only.
export async function readNotices():Promise<Notice[]>{
  let raw:any;try{raw=await optionalJSON<any>(NOTICES_FILE,{notices:[]});}catch{return [];}
  const list=Array.isArray(raw?.notices)?raw.notices:[];const seen=new Set<string>(),out:Notice[]=[];
  for(const n of list){if(!n||typeof n!=='object')continue;const id=text(n.id,80),title=text(n.title,160),body=text(n.body,1200);
    if(!/^[\w.:-]{1,80}$/.test(id)||!title||!body||seen.has(id))continue;seen.add(id);
    const at=typeof n.at==='string'&&!Number.isNaN(Date.parse(n.at))?n.at:new Date(0).toISOString();
    const url=typeof n.url==='string'&&/^https:\/\//.test(n.url)&&n.url.length<=500?n.url:undefined;
    out.push({id,at,kind:'regulation',level:n.level==='warning'?'warning':'info',title,body,...url?{url}:{}});}
  return out;
}
export async function readInboxState():Promise<{dismissed:string[]}>{
  try{const s=await optionalJSON<any>(STATE_FILE,{});return {dismissed:Array.isArray(s?.dismissed)?s.dismissed.filter((x:unknown)=>typeof x==='string').slice(0,MAX_DISMISSED):[]};}catch{return {dismissed:[]};}
}
let chain:Promise<unknown>=Promise.resolve();
// Dismiss one notice for this player. Only notices that exist can be dismissed: unlinked replays and the other kinds go
// away by being dealt with, never by being hidden.
export function dismissNotice(id:string){
  const run=async()=>{const notices=await readNotices();if(!notices.some(n=>n.id===id))throw new Error('Only notices can be dismissed.');
    const s=await readInboxState();if(!s.dismissed.includes(id))await save(STATE_FILE,{dismissed:[...s.dismissed,id].slice(-MAX_DISMISSED)});return {dismissed:id};};
  const next=chain.then(run,run);chain=next.catch(()=>{});return next;
}

const six=(db:Workbench,t:Workbench['teams'][number])=>{try{return currentTeam(db,t).sets.map(s=>s.species);}catch{return [] as string[];}};
const baseName=(s?:string)=>String(s??'').replace(/-Mega(-[A-Z])?$/,'');
const other=(g:Game)=>g.ownSide==='p1'?'p2':'p1';
const WHY={
  'matches-one':(n:string)=>`Its six matches ${n}, but it has no link yet.`,
  'matches-several':(n:string)=>`Its six matches more than one team (${n}), so it can't pick one for you.`,
  'no-match':()=>'Its six doesn\'t match any of your teams.',
  'no-preview':()=>'The game has no team preview for your side, so there is no six to match.'};
// Why a replay has no link: the same roster test the automatic linker uses (a team with a saved edit of this six),
// plus how far each team's current six is from the game's.
export function unlinkedItem(db:Workbench,g:Game):InboxItem{
  const mine=g.preview[g.ownSide]??[],theirs=g.preview[other(g)]??[];const names=new Map(db.teams.map(t=>[t.id,t.name]));
  const r:LinkResult=mine.length?autoLink(db,g):{association:null};const ids=r.association?[r.association.teamId]:r.teamIds??[];
  const reason:'matches-one'|'matches-several'|'no-match'|'no-preview'=!mine.length?'no-preview':ids.length===1?'matches-one':ids.length>1?'matches-several':'no-match';
  const key=(s:string)=>speciesKey(s);
  const teams=db.teams.map(t=>{const t6=six(db,t);const missing=mine.filter(m=>!t6.some(x=>key(x)===key(m)));const extra=t6.filter(x=>!mine.some(m=>key(m)===key(x)));return {teamId:t.id,name:t.name,missing,extra};})
    .filter(x=>x.missing.length||x.extra.length||ids.includes(x.teamId)).sort((a,b)=>(a.missing.length+a.extra.length)-(b.missing.length+b.extra.length)).slice(0,3);
  const opp=g.players[other(g)]?.name??'opponent';const result=g.result==='win'?'Win':g.result==='loss'?'Loss':'Game';
  return {id:'unlinked:'+g.id,kind:'unlinked-replay',at:g.date,title:`${result} vs ${opp}`,replayId:g.id,date:g.date,result:g.result,opponent:opp,yours:mine,theirs,reason,
    why:WHY[reason](ids.map((i:string)=>names.get(i)).filter(Boolean).join(', ')),candidateTeamIds:ids,closest:teams,
    href:'#inbox'};
}
const describe=(p:any)=>{try{
  switch(p.kind){case 'set':return `${p.set.species} for slot ${p.slot+1}`;case 'bench':return `${p.set.species} for the ${BENCH_LABEL}`;case 'promote':return `Promote ${p.species} from the ${BENCH_LABEL}`;
    case 'team':return String(p.name??'A rebuilt team');case 'strategy':return 'A strategy rewrite';case 'lead':return `Lead plan: ${(p.lead??[]).join(' + ')}`;
    case 'matchup':return `Matchup plan: ${p.opponent}`;case 'objective':return String(p.text??'A to-do').slice(0,80);}}catch{}
  return 'A suggestion';};

// Replays linked to a team that have no saved summary: the Replays tab's "no summary yet" count, per team.
async function waiting(db:Workbench,index:ReplayIndex){
  const have=new Set((await listDir('reports/replay-summaries')).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)));
  const known=new Set(index.games.map(g=>g.id));const per=new Map<string,string[]>();
  for(const [id,a] of Object.entries(db.associations))if(known.has(id)&&!have.has(id)&&db.teams.some(t=>t.id===a.teamId))per.set(a.teamId,[...per.get(a.teamId)??[],id]);
  return per;
}
export async function buildInbox(db:Workbench):Promise<Inbox>{
  const items:InboxItem[]=[];
  const index=await optionalJSON<ReplayIndex>('replays/index.json',{schemaVersion:1,games:[],errors:[]});
  // Only unlinked games are read in full; everything else comes from ids.
  for(const e of index.games){if(db.associations[e.id])continue;try{items.push(unlinkedItem(db,await json<Game>(e.parsed)));}catch{}}
  const names=new Map(db.teams.map(t=>[t.id,t.name]));
  for(const p of db.pending??[]){const team=names.get(p.teamId);if(!team)continue;
    items.push({id:'suggestion:'+p.id,kind:'suggestion',at:p.createdAt,title:describe(p.proposal),detail:p.summary||undefined,pendingId:p.id,teamId:p.teamId,teamName:team,proposalKind:p.proposal.kind,href:`#team/${p.teamId}/overview/all`});}
  for(const [teamId,ids] of await waiting(db,index))items.push({id:'summaries:'+teamId,kind:'summaries',at:null,title:`${ids.length} game${ids.length===1?'':'s'} waiting for a summary`,detail:names.get(teamId),teamId,teamName:names.get(teamId),count:ids.length,replayIds:ids,
    request:`Summarise my new Frontier Brain replays for ${names.get(teamId)}.`,href:`#team/${teamId}/replays/all`});
  for(const c of await listCalcs().catch(()=>[])){
    const inv=[c.input?.attacker,c.input?.defender,c.input?.a,c.input?.b].map(x=>baseName(x?.species)).filter(Boolean);let at:{t:Workbench['teams'][number];slot:number}|null=null;
    for(const sp of inv){for(const t of db.teams){const slot=six(db,t).findIndex(s=>baseName(s)===sp);if(slot>=0){at={t,slot};break;}}if(at)break;}
    items.push({id:'calc:'+c.id,kind:'calc',at:c.at,title:c.label,detail:c.kind==='speed'?'Speed check from your assistant':'Damage calc from your assistant',calcId:c.id,calcKind:c.kind,
      ...at?{teamId:at.t.id,teamName:at.t.name,slot:at.slot,href:`#team/${at.t.id}/mon/${at.t.activeVersionId}/${at.slot}`}:{}});}
  const {dismissed}=await readInboxState();
  for(const n of await readNotices())if(!dismissed.includes(n.id))items.push({id:'notice:'+n.id,kind:'notice',at:n.at,title:n.title,detail:n.body,noticeId:n.id,level:n.level,...n.url?{url:n.url}:{}});
  // Newest first within each kind; items with no date (waiting summaries) follow the dated ones.
  const when=(i:InboxItem)=>i.at&&!Number.isNaN(Date.parse(i.at))?Date.parse(i.at):-Infinity;
  const order=(k:InboxKind)=>INBOX_KINDS.indexOf(k);
  items.sort((a,b)=>order(a.kind)-order(b.kind)||when(b)-when(a)||(b.count??0)-(a.count??0));
  const byKind=Object.fromEntries(INBOX_KINDS.map(k=>[k,items.filter(i=>i.kind===k).length])) as Record<InboxKind,number>;
  // The count is action items only: an assistant's calc result is shown on the page but needs nothing from the player.
  return {items,count:items.filter(i=>i.kind!=='calc').length,byKind};
}

// MCP: get_inbox (read-only), registered from tools/mcp.ts in its own block.
export const inboxTools=[
  {name:'get_inbox',description:'What is waiting on the player in Frontier Brain, newest first within each kind: replays saved with no team link (unlinked-replay: replayId, why it did not match, closest teams), your suggestions they have not accepted yet (suggestion: pendingId, teamId), games waiting for a summary (summaries: teamId, replayIds), calcs you ran that are still in their calc panel (calc: calcId, teamId) and regulation notices. Use it to say "you have 2 unlinked replays" or to pick up summaries. Ids are the ones the other tools accept (list_replays, replay_transcript, delete_replay, get_team). Read-only.',parameters:{type:'object',properties:{}}},
];
export const inboxNames=new Set(inboxTools.map(t=>t.name));
export async function inboxCall(name:string,db:Workbench){
  if(name!=='get_inbox')return undefined;const {items,count,byKind}=await buildInbox(db);
  return {count,byKind,items:items.map(({href,at,...i})=>({...i,at})),note:count?'These are waiting on the player in the Inbox page of Frontier Brain. Unlinked replays are linked or deleted there; delete_replay needs the player to ask.':'Nothing is waiting on the player.'};
}
