// The team pool: one deduplicated table of individual teams collected from upstream sources, so every
// percentage is computed here once instead of re-mixing other sites' aggregates (which overlap).
//   official — Limitless official events (RK9 open team sheets): Day 2 lists with placings, no stat points
//   online   — Limitless online tournaments (public API): full lists with placings/records, no stat points
//   shared   — VGCPastes → PokePaste: exact sets WITH stat points, often tagged with event/placing
// A shared paste that matches a tournament team (same six, same player or same event+placing, shared after the
// event) is merged into that team: the verified list gains exact spreads and the paste is not counted twice.
// Mirrors (StatCrusher, MunchStats' Showdown tabs, Top Cut Explorer) and composites (Suckerpunch, Pikalytics,
// LabMaus) are never ingested. Output: knowledge/pool/teams.json and knowledge/pool/status.json.
import {resolve} from 'node:path';
import {optionalJSON,save,readText,modifiedAt} from './io.ts';
import {fetchText} from './research.ts';
import {dex,resolveSpecies} from './mechanics.ts';
import {recentEvents,standings,teamList} from './limitless.ts';
import {pasteIndex,setsFromPaste} from './vgcpastes.ts';
import {correctName,type NameKind} from './pool-names.ts';
import type {MetaSets,Share,MetaSpread} from './meta-sets.ts';

export type Lane='official'|'online'|'shared';
export interface PoolSet {species:string;item:string;ability:string;nature:string;moves:string[];statPoints?:MetaSpread['statPoints'];}
export interface PoolTeam {id:string;lane:Lane;event:string;eventId:string;date:string|null;players:number|null;player:string;placing:number|null;record:string|null;pokemon:string[];sets:PoolSet[];
  sources:{name:string;url:string}[];spreadsFrom?:{name:string;url:string};}
const STATUS='knowledge/pool/status.json',TEAMS='knowledge/pool/teams.json';
const base=(s:string)=>dex.species.get(s).baseSpecies||s;
// Limitless display names ("Eternal Flower Floette", "Wash Rotom") resolve to Showdown forms, so usage isn't split.
const species=(s:string)=>resolveSpecies(s)??s;
export const playerKey=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
const sixKey=(mons:string[])=>mons.map(base).sort().join('|');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
type Log=(s:string)=>void;

async function officialTeams(log:Log):Promise<PoolTeam[]>{
  const out:PoolTeam[]=[];
  for(const e of await recentEvents('M-C',{limit:16})){const rows=await standings(e.id,e.date);log(`Official · ${e.name}: ${rows.length} Day 2 teams`);
    for(const r of rows){let sets:PoolSet[]=[];if(r.teamId){try{sets=(await teamList(r.teamId)).map(s=>({...s,species:species(s.species)}));}catch(err){log(`  team ${r.teamId}: ${(err as Error).message}`);}}
      out.push({id:`official:${e.id}:${r.place}:${playerKey(r.player)}`,lane:'official',event:e.name,eventId:e.id,date:e.date,players:e.entrants,player:r.player,placing:r.place,record:null,pokemon:r.pokemon.map(species),sets,sources:[{name:'Limitless',url:r.teamId?`https://limitlessvgc.com/teams/${r.teamId}`:e.url}]});}}
  return out;
}
const ONLINE='https://play.limitlesstcg.com/api';
export const NONSTANDARD=/mono ?type|gen ?\d+ edition|draft|little cup|singles|\bbss\b|1v1|no mega|\bnfe\b|random|inverse|doubles? ?ou/i;
async function onlineTeams(log:Log,minPlayers:number):Promise<PoolTeam[]>{
  const list=JSON.parse((await fetchText(`${ONLINE}/tournaments?game=VGC&format=M-C&limit=500`,5_000_000)).text) as any[];const out:PoolTeam[]=[];let read=0;
  // Organisers tag custom-rule events as M-C too; their teams would distort standard usage.
  const custom=list.filter(t=>t.players>=minPlayers&&NONSTANDARD.test(t.name));if(custom.length)log(`Online · skipped ${custom.length} custom-rule event(s): ${custom.map(t=>t.name).join('; ')}`);
  for(const t of list.filter(t=>t.players>=minPlayers&&!NONSTANDARD.test(t.name))){const path=`knowledge/metagame/limitless-online/${t.id}.json`;let rows=await optionalJSON<any[]|null>(path,null);
    const finished=Date.parse(t.date)<Date.now()-2*86400_000;
    if(!rows){try{rows=JSON.parse((await fetchText(`${ONLINE}/tournaments/${t.id}/standings`,10_000_000)).text);if(finished)await save(path,rows);read++;await sleep(200);}catch(err){log(`Online · ${t.name}: ${(err as Error).message}`);continue;}}
    for(const r of rows??[]){if(!Array.isArray(r.decklist)||r.decklist.length!==6)continue;const sets=r.decklist.map((p:any)=>({species:species(p.name??p.id),item:p.item??'',ability:p.ability??'',nature:p.nature??'',moves:p.attacks??[]}));
      out.push({id:`online:${t.id}:${playerKey(r.player??r.name)}`,lane:'online',event:t.name,eventId:t.id,date:t.date.slice(0,10),players:t.players,player:r.name??r.player,placing:r.placing??null,record:r.record?`${r.record.wins}-${r.record.losses}${r.record.ties?'-'+r.record.ties:''}`:null,pokemon:sets.map((s:PoolSet)=>s.species),sets,sources:[{name:'Limitless online',url:`https://play.limitlesstcg.com/tournament/${t.id}/standings`}]});}}
  log(`Online · ${list.length} M-C tournaments listed, ${list.filter(t=>t.players>=minPlayers).length} with ≥${minPlayers} players (${read} newly read)`);return out;
}
async function pasteText(id:string){const path=`knowledge/metagame/vgcpastes/pastes/${id}.txt`;try{return await readText(path);}catch{const {text}=await fetchText(`https://pokepast.es/${id}/raw`,200_000);await save(path,text);await sleep(150);return text;}}
async function sharedTeams(log:Log):Promise<PoolTeam[]>{
  const index=await pasteIndex();const out:PoolTeam[]=[];let failed=0;
  for(const r of index.rows.filter(r=>r.hasSpreads)){const id=r.paste.match(/pokepast\.es\/([a-f0-9]{8,32})/)?.[1];if(!id)continue;
    try{const sets=setsFromPaste(await pasteText(id));if(sets.length!==6)continue;const date=Number.isFinite(Date.parse(r.date))?new Date(Date.parse(r.date+' UTC')).toISOString().slice(0,10):null;
      out.push({id:`shared:${r.teamId}`,lane:'shared',event:r.event,eventId:'',date,players:null,player:r.player,placing:parseInt(r.rank)||null,record:null,pokemon:sets.map(s=>species(s.species)),
        sets:sets.map(s=>({species:species(s.species),item:s.item??'',ability:s.ability??'',nature:s.nature??'Serious',moves:s.moves??[],statPoints:{hp:0,atk:0,def:0,spa:0,spd:0,spe:0,...s.statPoints} as MetaSpread['statPoints']})),
        sources:[{name:'VGCPastes',url:r.paste}]});}catch{failed++;}}
  log(`Shared · ${index.rows.length} VGCPastes teams indexed, ${out.length} with readable Champions spreads${failed?`, ${failed} unreadable`:''}`);return out;
}
const words=(s:string)=>new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2&&!['regional','championships','the','vgc','champions'].includes(w)));
// Merge a shared paste into a tournament team when it is plainly the same team.
export function matchShared(shared:PoolTeam,candidates:PoolTeam[]){
  const six=sixKey(shared.pokemon);const when=shared.date?Date.parse(shared.date):NaN;
  return candidates.find(t=>{if(sixKey(t.pokemon)!==six)return false;if(t.date&&Number.isFinite(when)){const d=(when-Date.parse(t.date))/86400_000;if(d<-2||d>45)return false;}
    if(playerKey(t.player)&&playerKey(t.player)===playerKey(shared.player))return true;
    const ev=words(shared.event);return ev.size>0&&[...words(t.event)].some(w=>ev.has(w))&&shared.placing!==null&&shared.placing===t.placing;});
}
export function consolidate(official:PoolTeam[],online:PoolTeam[],shared:PoolTeam[]){
  const tournament=[...official,...online];let merged=0,duplicates=0;const kept:PoolTeam[]=[];const seen=new Set<string>();
  for(const s of shared){const match=matchShared(s,tournament);
    if(match){merged++;match.spreadsFrom=s.sources[0];match.sources.push(...s.sources);
      match.sets=match.sets.length?match.sets.map(set=>{const exact=s.sets.find(x=>base(x.species)===base(set.species));return exact?.statPoints?{...set,statPoints:exact.statPoints,nature:set.nature||exact.nature}:set;}):s.sets;continue;}
    // The same paste is sometimes re-shared; identical six + spreads + player is one team.
    const key=`${playerKey(s.player)}:${JSON.stringify(s.sets.map(x=>[base(x.species),x.statPoints]).sort())}`;if(seen.has(key)){duplicates++;continue;}seen.add(key);kept.push(s);}
  return {teams:[...tournament,...kept],merged,duplicates};
}
// Keep the existing pool when any lane failed (or nothing came back) and there is one to keep.
export const keepPreviousPool=(fresh:PoolTeam[],previous:{teams:PoolTeam[]}|null,errors:string[])=>!!previous?.teams.length&&(errors.length>0||!fresh.length);
export function laneCounts(teams:PoolTeam[]){const n=(lane:string)=>teams.filter(t=>t.lane===lane).length;
  return {official:n('official'),online:n('online'),shared:n('shared'),mergedSpreads:teams.filter(t=>t.spreadsFrom).length,total:teams.length,withSpreads:teams.filter(t=>t.sets.some(s=>s.statPoints)).length};}
let running:Promise<unknown>|null=null;
export async function refreshPool({minPlayers=16,log=(s:string)=>console.log(s)}:{minPlayers?:number;log?:Log}={}){
  if(running)return running;
  running=(async()=>{const started=new Date().toISOString();const notes:string[]=[];const say=(s:string)=>{notes.push(s);log(s);};const errors:string[]=[];
    const safe=async<T>(name:string,fn:()=>Promise<T[]>)=>{try{return await fn();}catch(e){errors.push(`${name}: ${(e as Error).message}`);say(`${name} failed: ${(e as Error).message}`);return [] as T[];}};
    const official=await safe('Official',()=>officialTeams(say));const online=await safe('Online',()=>onlineTeams(say,minPlayers));const shared=await safe('Shared',()=>sharedTeams(say));
    const {teams,merged,duplicates}=consolidate(official,online,shared);
    const counts={official:official.length,online:online.length,shared:shared.length,mergedSpreads:merged,duplicateShares:duplicates,total:teams.length,withSpreads:teams.filter(t=>t.sets.some(s=>s.statPoints)).length};
    const excluded='Mirrors (StatCrusher, MunchStats Showdown tabs, Top Cut Explorer) and composites (Suckerpunch, Pikalytics, LabMaus) are not ingested; they repackage these upstreams or blend them.';
    const now=new Date().toISOString(),previous=await optionalJSON<{refreshedAt:string;teams:PoolTeam[]}|null>(TEAMS,null);
    // A failed lane would silently shrink the pool (and the hosted tables loaded from it), so the previous complete pool
    // stays in place and its status keeps describing it; the failed attempt is recorded alongside.
    if(keepPreviousPool(teams,previous,errors)){const before=await optionalJSON<any>(STATUS,null);
      const status={...(before?.refreshedAt===previous!.refreshedAt?before:{counts:laneCounts(previous!.teams)}),refreshedAt:previous!.refreshedAt,errors,
        notes:[...notes,`Kept the previous pool (refreshed ${previous!.refreshedAt}): this refresh had errors.`],lastAttempt:{started,at:now,counts,errors},excluded};
      await save(STATUS,status);return status;}
    const status={refreshedAt:now,started,minPlayers,counts,notes,errors,excluded};
    await save(TEAMS,{refreshedAt:now,teams});memo=null;await save(STATUS,status);return status;})();
  try{return await running;}finally{running=null;}
}
export const poolStatus=()=>optionalJSON<any>(STATUS,null);
// Names are re-resolved on read, so pools built before a resolver fix are counted correctly without a rebuild.
// A team that lists the same Pokémon twice is a source error; it counts once.
// Parsed once per minute per server (the file is ~19 MB); a refresh shows up within that minute.
let memo:{at:number;teams:Promise<PoolTeam[]>}|null=null;
export function poolTeams():Promise<PoolTeam[]>{if(memo&&Date.now()-memo.at<60_000)return memo.teams;const teams=loadPoolTeams();memo={at:Date.now(),teams};teams.catch(()=>{memo=null;});return teams;}
async function loadPoolTeams():Promise<PoolTeam[]>{return (await optionalJSON<{teams:PoolTeam[]}>(TEAMS,{teams:[]})).teams.map(t=>({...t,pokemon:[...new Set(t.pokemon.map(species))],sets:t.sets.map(s=>({...s,species:species(s.species),...corrected(s)}))}));}
// The reviewed name corrections (tools/pool-names.ts) apply on read, as in the hosted tables.
const fix=(kind:NameKind,v:string)=>{const c=correctName(kind,v);return c===undefined?v:c??'';};
const corrected=(s:PoolSet)=>({item:fix('item',s.item),ability:fix('ability',s.ability),nature:fix('nature',s.nature),moves:s.moves.map(m=>fix('move',m))});
export interface PoolQuery {lanes?:Lane[];sinceDays?:number;}
const inScope=(t:PoolTeam,q:PoolQuery)=>(!q.lanes||q.lanes.includes(t.lane))&&(!q.sinceDays||!t.date||Date.parse(t.date)>=Date.now()-q.sinceDays*86400_000);
const tally=(values:string[],n:number):Share[]=>{const m=new Map<string,number>();for(const v of values)if(v)m.set(v,(m.get(v)??0)+1);return [...m].sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count,percent:Math.round(1000*count/Math.max(1,n))/10}));};
// Best evidence first: official placings, then large online events by placing, then unmatched shared pastes.
const rank=(t:PoolTeam)=>(t.lane==='official'?0:t.lane==='online'?1e4:2e4)+(t.placing??999)*(t.lane==='online'?Math.max(1,64/(t.players??64)):1);
export async function poolSets(name:string,q:PoolQuery={}):Promise<MetaSets>{
  const target=species(name);const all=(await poolTeams()).filter(t=>inScope(t,q));const teams=all.filter(t=>t.pokemon.some(p=>base(p)===base(target)));
  if(!teams.length)throw new Error(`No pooled teams include ${target}${all.length?'':' (the pool is empty: run a pool refresh)'}`);
  const sets=teams.map(t=>({team:t,set:t.sets.find(s=>base(s.species)===base(target))})).filter((x):x is {team:PoolTeam;set:PoolSet}=>!!x.set);const withSP=sets.filter(x=>x.set.statPoints);
  const lanes=(['official','online','shared'] as Lane[]).map(l=>`${teams.filter(t=>t.lane===l).length} ${l}`).join(' · ');
  const spreads=tally(withSP.map(x=>`${x.set.nature}|${Object.values(x.set.statPoints!).join('/')}`),withSP.length).map(s=>{const [nature,sp]=s.name.split('|');const v=sp.split('/').map(Number);return {nature,statPoints:{hp:v[0],atk:v[1],def:v[2],spa:v[3],spd:v[4],spe:v[5]},percent:s.percent,count:s.count};});
  const dates=teams.map(t=>t.date).filter(Boolean).sort() as string[];
  return {source:'pool',species:target,url:'knowledge/pool/teams.json',retrievedAt:(await poolStatus())?.refreshedAt??'',period:`${dates[0]??'?'} – ${dates.at(-1)??'?'}`,population:'Frontier Brain team pool: Limitless official + online team lists and VGCPastes spreads, deduplicated',
    sample:`${teams.length} of ${all.length} pooled teams (${lanes}); ${withSP.length} with exact stat points; usage ${Math.round(1000*teams.length/all.length)/10}%`,
    moves:tally(sets.flatMap(x=>x.set.moves),sets.length),items:tally(sets.map(x=>x.set.item),sets.length),abilities:tally(sets.map(x=>x.set.ability),sets.length),natures:tally(sets.map(x=>x.set.nature),sets.length),spreads,
    teammates:tally(teams.flatMap(t=>t.pokemon.filter(p=>base(p)!==base(target))),teams.length).slice(0,15),
    notes:'Every team counted once. Move % = share of sets running the move. Spreads come only from pastes (VGCPastes), merged into the tournament team when it is the same team.',
    examples:[...sets].sort((a,b)=>Number(!!b.set.statPoints)-Number(!!a.set.statPoints)||rank(a.team)-rank(b.team)).slice(0,12).map(x=>({...x.set,player:x.team.player,lane:x.team.lane,event:x.team.event,placing:x.team.placing,players:x.team.players,record:x.team.record,date:x.team.date,source:x.team.sources[0]?.url,spreadsFrom:x.team.spreadsFrom?.url}))};
}
// Usage leaders and best-placed teams across the pool: meta context and team-building input.
export async function poolOverview(q:PoolQuery&{top?:number}={}){
  const all=(await poolTeams()).filter(t=>inScope(t,q));const n=all.length;
  return {teams:n,lanes:Object.fromEntries((['official','online','shared'] as Lane[]).map(l=>[l,all.filter(t=>t.lane===l).length])),
    usage:tally(all.flatMap(t=>[...new Set(t.pokemon.map(base))]),n).slice(0,q.top??30),
    cores:tally(all.flatMap(t=>{const m=[...new Set(t.pokemon.map(base))].sort();return m.flatMap((a,i)=>m.slice(i+1).map(b=>`${a} + ${b}`));}),n).slice(0,15),
    bestTeams:[...all].filter(t=>t.lane!=='shared'&&t.placing!==null&&t.placing<=4).sort((a,b)=>(b.date??'').localeCompare(a.date??'')||rank(a)-rank(b)).slice(0,12).map(t=>({player:t.player,placing:t.placing,event:t.event,lane:t.lane,players:t.players,date:t.date,pokemon:t.pokemon,hasSpreads:!!t.spreadsFrom,source:t.sources[0]?.url}))};
}
if(import.meta.main){const status:any=await refreshPool({minPlayers:Number(process.argv[2]??16)});console.log(JSON.stringify(status.counts,null,2));}
