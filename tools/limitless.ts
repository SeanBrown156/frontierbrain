// Limitless VGC: official-event standings with every Day 2 team list (open team sheets). Team lists carry item,
// ability, nature and moves but NO stat points. Standings rows already show each team's six, so teammate/core
// statistics need no extra requests; individual team lists are fetched only for the species asked about.
// Finished events never change: standings and team lists are cached permanently. The event list refreshes every 6 h.
import {resolve} from 'node:path';
import {optionalJSON,save,readText,modifiedAt} from './io.ts';
import {fetchText} from './research.ts';
import {speciesKey,dex} from './mechanics.ts';
import type {MetaSets,Share} from './meta-sets.ts';

const SITE='https://limitlessvgc.com';
export interface Standing {place:number;player:string;country:string;pokemon:string[];teamId:string|null;}
export interface EventInfo {id:string;name:string;date:string|null;regulation:string|null;entrants:number|null;url:string;}
export interface TeamListSet {species:string;item:string;ability:string;nature:string;moves:string[];}
export interface TournamentExample extends TeamListSet {player:string;place:number;event:string;date:string|null;teamUrl:string;}
const clean=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#0?39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
const base=speciesKey;
// Limitless shows display names ("Eternal Flower Floette"); its URL slug maps to the dex name (floette-eternal → Floette-Eternal).
export function speciesName(slug:string,label:string){const d=dex.species.get(slug);return d.exists?d.name:label;}

export function parseEventList(html:string){return [...html.matchAll(/href="\/tournaments\/(\d+)">([^<]+)<\/a>/g)].map(m=>({id:m[1],name:clean(m[2])}));}
export function parseStandings(html:string):Standing[]{
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(m=>{const cells=[...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c=>c[1]);const place=Number(clean(cells[0]??''));if(!cells.length||!Number.isFinite(place)||place<1)return [];
    return [{place,player:clean(cells[1]??''),country:cells[2]?.match(/alt="([^"]+)"/)?.[1]??'',pokemon:[...m[1].matchAll(/href="\/pokemon\/([a-z0-9-]+)" data-tooltip="([^"]+)"><img class="pokemon"/g)].map(p=>speciesName(p[1],p[2])),teamId:m[1].match(/href="\/teams\/(\d+)"/)?.[1]??null}];});
}
export function parseTeamList(html:string):TeamListSet[]{
  return html.split('<div class="pkmn"').slice(1).map(block=>({species:clean(block.match(/<div class="name">([\s\S]*?)<\/div>/)?.[1]??''),item:clean(block.match(/<div class="item">([\s\S]*?)<\/div>/)?.[1]??''),
    ability:clean(block.match(/<div class="ability">([\s\S]*?)<\/div>/)?.[1]??'').replace(/^Ability:\s*/,''),nature:clean(block.match(/<div class="nature">([\s\S]*?)<\/div>/)?.[1]??'').replace(/\s*Nature$/,''),
    moves:[...(block.match(/<ul class="moves">([\s\S]*?)<\/ul>/)?.[1]??'').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m=>clean(m[1]))})).filter(s=>s.species);
}
export function parseEventMeta(html:string){
  const text=clean(html.replace(/<script[\s\S]*?<\/script>/g,''));const description=html.match(/<meta name="description" content="([^"]*)"/)?.[1]??'';
  const parsed=new Date(description.split(' - ')[0].replace(/(\d+)(st|nd|rd|th)/,'$1')+' UTC');
  return {date:Number.isFinite(parsed.getTime())?parsed.toISOString().slice(0,10):null,regulation:text.match(/Regulation Set ([A-Z]-[A-Z0-9]+)/)?.[1]??null,entrants:Number(text.match(/([\d,]+) Players/)?.[1]?.replaceAll(',',''))||null};
}
// permanent=false: refetch when the cached copy is over 6 h old (events still running or just finished).
async function cachedText(path:string,url:string,permanent=true){const at=await modifiedAt(path);if(at!==null&&(permanent||Date.now()-at<6*3600_000))return readText(path);const {text}=await fetchText(url,5_000_000);await save(path,text);await new Promise(r=>setTimeout(r,150));return text;}
const settled=(date:string|null)=>!!date&&Date.parse(date)<Date.now()-3*86400_000;
// Recent official events in one regulation (default M-C), newest first.
export async function recentEvents(regulation='M-C',{refresh=false,limit=12}={}):Promise<EventInfo[]>{
  const listPath='knowledge/metagame/limitless/events.json';let list=await optionalJSON<{retrievedAt:string;events:{id:string;name:string}[]}|null>(listPath,null);
  if(!list||refresh||Date.now()-Date.parse(list.retrievedAt)>6*3600_000){list={retrievedAt:new Date().toISOString(),events:parseEventList((await fetchText(`${SITE}/tournaments`,5_000_000)).text)};await save(listPath,list);}
  const out:EventInfo[]=[];
  for(const e of list.events.slice(0,limit)){const metaPath=`knowledge/metagame/limitless/events/${e.id}.json`;let meta=await optionalJSON<EventInfo|null>(metaPath,null);
    if(!meta){const m=parseEventMeta(await cachedText(`knowledge/metagame/limitless/events/${e.id}.html`,`${SITE}/tournaments/${e.id}`,false));meta={...e,...m,url:`${SITE}/tournaments/${e.id}`};if(settled(meta.date))await save(metaPath,meta);}
    if(meta.regulation===regulation)out.push(meta);}
  return out;
}
export async function standings(eventId:string,date:string|null=null){return parseStandings(await cachedText(`knowledge/metagame/limitless/events/${eventId}.html`,`${SITE}/tournaments/${eventId}`,settled(date)));}
export async function teamList(teamId:string){return parseTeamList(await cachedText(`knowledge/metagame/limitless/teams/${teamId}.html`,`${SITE}/teams/${teamId}`));}

export async function limitlessSets(species:string,{maxTeams=40,regulation='M-C'}={}):Promise<MetaSets>{
  const name=dex.species.get(species).name;const events=await recentEvents(regulation);const rows:(Standing&{event:EventInfo})[]=[];
  for(const e of events)for(const s of await standings(e.id,e.date))if(s.pokemon.some(p=>base(p)===base(name)))rows.push({...s,event:e});
  if(!rows.length)throw new Error(`No ${regulation} Limitless team lists include ${name}`);
  const total=rows.length;const tally=(values:string[],n:number):Share[]=>{const m=new Map<string,number>();for(const v of values)if(v)m.set(v,(m.get(v)??0)+1);return [...m].sort((a,b)=>b[1]-a[1]).map(([k,c])=>({name:k,count:c,percent:Math.round(1000*c/n)/10}));};
  // Teammates from all standings rows (complete); set details from the best-placed team lists (bounded fetches).
  const teammates=tally(rows.flatMap(r=>r.pokemon.filter(p=>base(p)!==base(name))),total).slice(0,15);
  const picked=[...rows].filter(r=>r.teamId).sort((a,b)=>a.place-b.place||(b.event.date??'').localeCompare(a.event.date??'')).slice(0,maxTeams);const examples:TournamentExample[]=[];
  for(const r of picked){try{const set=(await teamList(r.teamId!)).find(s=>base(s.species)===base(name));if(set)examples.push({...set,player:r.player,place:r.place,event:r.event.name,date:r.event.date,teamUrl:`${SITE}/teams/${r.teamId}`});}catch{}}
  const n=examples.length;
  return {source:'limitless',species:name,url:`${SITE}/tournaments`,retrievedAt:new Date().toISOString(),period:events.length?`${events.at(-1)!.date} – ${events[0].date} (${events.length} events)`:'no events',
    population:`Limitless official-event Day 2 team lists, Regulation ${regulation}`,sample:`${total} Day 2 teams with ${name}; set details from the ${n} best-placed`,
    moves:tally(examples.flatMap(e=>e.moves),n).map(s=>({...s,percent:Math.round(1000*s.count!/Math.max(1,n))/10})),items:tally(examples.map(e=>e.item),n),abilities:tally(examples.map(e=>e.ability),n),natures:tally(examples.map(e=>e.nature),n),spreads:[],teammates,
    notes:'Open team sheets: no stat points. Teammates use every Day 2 team; items/natures/moves use the best-placed team lists read. Move % = share of those teams running the move.',examples:examples as any};
}
// Top-cut teams from recent events, for team building and meta context.
export async function topTeams({regulation='M-C',top=8,events=3}={}){
  const list=(await recentEvents(regulation)).slice(0,events);
  return Promise.all(list.map(async e=>({event:e.name,date:e.date,entrants:e.entrants,url:e.url,teams:(await standings(e.id,e.date)).filter(s=>s.place<=top).map(s=>({place:s.place,player:s.player,pokemon:s.pokemon,teamUrl:s.teamId?`${SITE}/teams/${s.teamId}`:null}))})));
}
