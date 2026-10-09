import {ROOT,optionalJSON,save,localDay} from './io.ts';
import {fetchText,setDistribution} from './research.ts';
import {dex,FORMAT} from './mechanics.ts';
import {vgcPastesSets} from './vgcpastes.ts';
import {limitlessSets} from './limitless.ts';
import {poolSets} from './pool.ts';
import {resolve} from 'node:path';
import {readdir} from 'node:fs/promises';

// Standard opponent sets, one labelled source at a time. Sources are never blended:
// PokéBase = M-C tournament team lists (default) or the in-game ranked doubles season; Pikalytics = curated M-C teams/ladder (no spreads);
// Smogon = Showdown ladder moveset stats (fallback only).
export type MetaSource='pool'|'pokebase'|'pokebase-ladder'|'vgcpastes'|'limitless'|'pikalytics'|'smogon';
export interface Share {name:string;percent:number;count?:number;}
export interface MetaSpread {nature?:string;statPoints:Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe',number>;percent:number;}
export interface MetaSets {source:MetaSource;species:string;url:string;retrievedAt:string;period:string;population:string;sample:string|null;
  moves:Share[];items:Share[];abilities:Share[];natures:Share[];spreads:MetaSpread[];teammates:Share[];notes:string;examples?:any[];}

const MAX_AGE_DAYS=7;
const statKeys={hp:'hp',attack:'atk',defense:'def',specialAttack:'spa',specialDefense:'spd',speed:'spe'} as const;
export const pokebaseSlug=(species:string)=>{const s=dex.species.get(species);return (s.exists?s.name:species).toLowerCase().replace(/[’'.:%]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');};

// PokéBase is a Next.js app: the season stats live in the React flight payload, not the HTML.
export function pokebaseFlight(html:string){return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map(m=>JSON.parse('"'+m[1]+'"')).join('');}
function enclosingObject(text:string,at:number){
  let depth=0,start=at;for(;start>0;start--){const c=text[start];if(c==='}'||c===']')depth++;else if(c==='{'||c==='['){if(depth===0&&c==='{')break;depth--;}}
  let d=0,end=start;for(;end<text.length;end++){const c=text[end];if(c==='{'||c==='[')d++;else if(c==='}'||c===']'){d--;if(d===0)break;}}
  return JSON.parse(text.slice(start,end+1));
}
function arrayAt(text:string,at:number){let d=0,e=at;for(;e<text.length;e++){const c=text[e];if(c==='['||c==='{')d++;else if(c===']'||c==='}'){d--;if(d===0)break;}}return JSON.parse(text.slice(at,e+1));}
const toPoints=(values:any)=>Object.fromEntries(Object.entries(statKeys).map(([k,v])=>[v,values?.[k]??0])) as MetaSpread['statPoints'];
// A PokéBase page carries two populations, kept apart: "Tournament Stats" for one regulation (team lists)
// and, for some species, the in-game ranked doubles season block.
export function parsePokebase(html:string,species:string,url:string,retrievedAt=new Date().toISOString()):{tournament:MetaSets|null;ladder:MetaSets|null}{
  const flight=pokebaseFlight(html);const share=(rows:any[]=[])=>rows.map(r=>({name:r.name,percent:r.percent}));
  let ladder:MetaSets|null=null;
  for(let i=flight.indexOf('"statSpreads"');i>=0;i=flight.indexOf('"statSpreads"',i+1)){const o=enclosingObject(flight,i);if(o.format!=='doubles')continue;
    const season=[...flight.matchAll(/\{"id":"([0-9a-f]{24})","season":(\d+),"name":"([^"]+)","shortName":"([^"]+)","dateRangeLabel":"([^"]+)"\}/g)].find(s=>s[1]===o.seasonId);
    ladder={source:'pokebase-ladder',species,url,retrievedAt,period:season?`${season[3]} (${season[5]})`:`Season ${o.seasonId}`,population:'Pokémon Champions in-game ranked doubles',sample:o.rank?`Usage rank ${o.rank} of ${o.totalRanked} ranked Pokémon`:null,
      moves:share(o.moves),items:share(o.items),abilities:share(o.abilities),natures:share(o.natures),teammates:(o.teammates??[]).map((t:any)=>({name:t.name,percent:NaN})),
      spreads:(o.statSpreads??[]).map((x:any)=>({statPoints:toPoints(x.values),percent:x.percent})),notes:'In-game ladder season. Spreads and natures are separate distributions; a spread row carries no nature. Lists are truncated by the site.'};break;}
  let tournament:MetaSets|null=null;const start=flight.indexOf('champions-pokemon-usage-stats-heading');
  if(start>=0){const sec=flight.slice(start,start+120000).replace(/"className":"[^"]*",?/g,"");
    const regulation=sec.match(/"aria-current":"page","children":"([^"]+)"/)?.[1]??'unknown regulation';const out:any={spreads:[],natures:[],items:[],teammates:[],moves:[]};
    for(let i=sec.indexOf('"rows":[');i>=0;i=sec.indexOf('"rows":[',i+1)){const rows=arrayAt(sec,i+7);const r=rows[0]??{};
      if(r.values)out.spreads=rows.map((x:any)=>({statPoints:toPoints(x.values),percent:x.percent}));else if(r.incStat)out.natures=share(rows);else if(r.moveTypeName)out.moves=share(rows);else if('count'in r)out.teammates=rows.map((x:any)=>({name:x.name,percent:x.percent,count:x.count}));else if(r.iconUrl)out.items=share(rows);}
    // Ability rows may be inline or streamed as "$Lxx" references to later flight lines.
    const line=(ref:string)=>{const m=flight.match(new RegExp(`(?:^|\\n)${ref}:([^\\n]*)`));return m?.[1]??'';};
    const list=sec.includes('"aria-label":"Abilities"')?sec.slice(sec.indexOf('"aria-label":"Abilities"')).split('"href":"/pokemon-champions/abilities/').slice(1,8):[];
    const abilities=list.map(seg=>{const slug=seg.slice(0,seg.indexOf('"'));const body=seg.slice(0,600);const resolved=body+[...body.matchAll(/"\$L([0-9a-f]+)"/g)].map(r=>line(r[1])).join(' ');
      const name=dex.abilities.get(slug).exists?dex.abilities.get(slug).name:slug;const percent=Number(resolved.match(/\[([\d.]+),"%"\]/)?.[1]);return {name,percent:Number.isFinite(percent)?percent:NaN};});
    const pairCount=Math.max(0,...out.teammates.map((t:any)=>t.count??0));
    if(out.spreads.length)tournament={source:'pokebase',species,url,retrievedAt,period:`as published ${retrievedAt.slice(0,10)}`,population:`Tournament team lists, Regulation ${regulation}`,
      sample:pairCount?`At least ${pairCount} teams (largest teammate pairing count)`:null,...out,abilities,
      notes:'Tournament team lists. Move percentages are shares of all move slots (about 25% means on nearly every team). Spreads and natures are separate distributions.'};}
  return {tournament,ladder};
}
export function parsePikalytics(html:string,species:string,url:string,retrievedAt=new Date().toISOString()):MetaSets{
  const section=(id:string)=>{const i=html.indexOf(`id="${id}"`);if(i<0)return [];const end=html.indexOf('id="',i+10);const chunk=html.slice(i,end<0?i+60000:end);
    return [...chunk.matchAll(/<div class="pokedex-inline-text(?:-offset)?">\s*(?:<span>)?([^<]+?)(?:<\/span>)?\s*<\/div>[\s\S]*?<div class="pokedex-inline-right">([\d.]+)%<\/div>/g)].map(m=>({name:m[1].trim().replace(/&#39;/g,"'").replace(/&amp;/g,'&'),percent:Number(m[2])}));};
  const moves=section('moves_wrapper');if(!moves.length)throw new Error(`Pikalytics has no M-C data for ${species}`);
  return {source:'pikalytics',species,url,retrievedAt,period:`Current published month as of ${retrievedAt.slice(0,10)} (site states "updated daily")`,population:'Pikalytics M-C: Showdown ladder plus curated Limitless/VGCPastes teams',sample:null,
    moves,items:section('items_wrapper'),abilities:section('abilities_wrapper'),natures:[],spreads:[],teammates:section('dex_team_wrapper'),notes:'Pikalytics does not publish Champions spreads for this format.'};
}
function smogonSets(species:string):Promise<MetaSets>{
  return setDistribution(species,FORMAT,1500).then(d=>{const cat=(k:string):Share[]=>[...(d.categories?.[k]??[])].sort((a:Share,b:Share)=>b.percent-a.percent).slice(0,12).map((r:Share)=>({name:r.name,percent:r.percent}));
    const spreads=cat('Spreads').map(s=>{const [nature,sp]=s.name.split(':');const v=(sp??'').split('/').map(Number);return {nature,statPoints:{hp:v[0],atk:v[1],def:v[2],spa:v[3],spd:v[4],spe:v[5]},percent:s.percent};});
    return {source:'smogon' as const,species:d.species,url:d.source,retrievedAt:new Date().toISOString(),period:d.period,population:`Showdown ladder ${d.format} ≥${d.rating}`,sample:`${d.rawCount} recorded uses`,
      moves:cat('Moves'),items:cat('Items'),abilities:cat('Abilities'),natures:[],spreads,teammates:cat('Teammates'),notes:d.notes};});
}
const cachePath=(source:MetaSource,species:string,day:string)=>`knowledge/metagame/${source}/${day}/${pokebaseSlug(species)}.json`;
async function cached(source:MetaSource,species:string,root:string):Promise<MetaSets|null>{
  let days:string[]=[];try{days=(await readdir(resolve(root,'knowledge/metagame',source))).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();}catch{return null;}
  for(const day of days){if((Date.parse(localDay())-Date.parse(day))/86400000>MAX_AGE_DAYS)break;const hit=await optionalJSON<MetaSets|null>(cachePath(source,species,day),null);if(hit)return hit;}return null;
}
// Polite, serialized fetching: one request at a time, cached per day.
let queue:Promise<unknown>=Promise.resolve();
const serial=<T>(fn:()=>Promise<T>)=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
export async function metaSets(species:string,source:MetaSource='pokebase',{refresh=false,root=ROOT}:{refresh?:boolean;root?:string}={}):Promise<MetaSets>{
  const canonical=dex.species.get(species);if(!canonical.exists)throw new Error(`Unknown species: ${species}`);const name=canonical.name;
  if(source==='smogon')return smogonSets(name);
  if(source==='pool')return poolSets(name);
  if(source==='vgcpastes')return vgcPastesSets(name,30,refresh);
  if(source==='limitless')return limitlessSets(name);
  if(!refresh){const hit=await cached(source,name,root);if(hit)return hit;}
  return serial(async()=>{
    if(source==='pikalytics'){const url=`https://www.pikalytics.com/pokedex/${FORMAT}/${encodeURIComponent(name)}`;const result=parsePikalytics((await fetchText(url,5_000_000)).text,name,url);await save(cachePath(source,name,localDay()),result);return result;}
    const url=`https://pokebase.app/pokemon-champions/pokemon/${pokebaseSlug(name)}?regulation=m-c`;const both=parsePokebase((await fetchText(url,5_000_000)).text,name,url);
    if(both.tournament)await save(cachePath('pokebase',name,localDay()),both.tournament);if(both.ladder)await save(cachePath('pokebase-ladder',name,localDay()),both.ladder);
    const result=source==='pokebase'?both.tournament:both.ladder;if(!result)throw new Error(`PokéBase has no ${source==='pokebase'?'M-C tournament':'ladder season'} stats for ${name}`);return result;
  });
}
// Fill a calc target from the n-th most common spread. Nature comes from the nature distribution
// (PokéBase separates them), so the label says which nature was paired.
export function standardSet(meta:MetaSets,spreadIndex=0){
  const spread=meta.spreads[spreadIndex];if(!spread)throw new Error(`${meta.source} lists no spreads for ${meta.species}`);
  const nature=spread.nature??meta.natures[0]?.name??'Serious';
  return {species:meta.species,nature,statPoints:spread.statPoints,ability:meta.abilities[0]?.name,item:meta.items[0]?.name,
    label:`${meta.source==='pool'?'Frontier Brain team pool':meta.source==='pokebase'?'PokéBase M-C tournaments':meta.source==='pokebase-ladder'?'PokéBase ladder':meta.source==='vgcpastes'?'VGCPastes shared teams':meta.source==='smogon'?'Smogon':'Pikalytics'} · ${nature} ${Object.values(spread.statPoints).join('/')} · spread ${spread.percent}%${spread.nature?'':`, nature ${meta.natures[0]?.percent??'?'}%`} · ${meta.period}`};
}
