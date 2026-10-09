// VGCPastes (community index of shared M-C teams, mostly from X/Twitter and events) → exact spreads.
// The sheet lists each team's PokePaste and whether it includes EVs (Champions stat points). We read the
// public CSV export, then fetch only the pastes that carry spreads for the requested species, cached forever
// by paste id. These are exact shared sets, not a random sample: label them as such.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT,optionalJSON,save} from './io.ts';
import {fetchText} from './research.ts';
import {importText} from './teams.ts';
import {dex} from './mechanics.ts';
import type {MetaSets,Share,MetaSpread} from './meta-sets.ts';

export const SHEET='1axlwmzPA49rYkqXh7zHvAtSP-TKbM0ijGYBPRflLSWw',GID='2001945654';
export const SHEET_URL=`https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=${GID}#gid=${GID}`;
export interface PasteRow {teamId:string;description:string;player:string;paste:string;hasSpreads:boolean;date:string;event:string;rank:string;source:string;pokemon:string[];}
export interface ExampleSet {species:string;nature:string;statPoints:MetaSpread['statPoints'];item:string;ability:string;moves:string[];teamId:string;player:string;event:string;rank:string;date:string;paste:string;}

export function parseCSV(text:string):string[][]{
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;continue;}
    if(c==='"')quoted=true;else if(c===',' ){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
export function parseIndex(csv:string):PasteRow[]{
  const rows=parseCSV(csv);const h=rows.findIndex(r=>r[0]?.trim()==='Team ID');if(h<0)throw new Error('VGCPastes layout changed: no "Team ID" header');const head=rows[h].map(x=>x.trim());
  const col=(name:string)=>{const i=head.findIndex(x=>x.startsWith(name));if(i<0)throw new Error(`VGCPastes layout changed: no "${name}" column`);return i;};
  const c={desc:col('Team Description'),player:col('Full Name'),paste:col('Pokepaste'),evs:col('EVs'),date:col('Date Shared'),event:col('Tournament / Event'),rank:col('Rank'),source:col('Link to Source'),mons:col('Pokemon Text for Copypasta')};
  return rows.slice(h+1).filter(r=>/^[A-Z]{1,3}\d+$/.test(r[0]?.trim()??'')).map(r=>({teamId:r[0].trim(),description:r[c.desc]?.trim()??'',player:r[c.player]?.trim()??'',paste:r[c.paste]?.trim()??'',hasSpreads:/^yes/i.test(r[c.evs]?.trim()??''),date:r[c.date]?.trim()??'',event:(r[c.event]??'').trim().replace(/^-$/,''),rank:(r[c.rank]??'').trim(),source:r[c.source]?.trim()??'',pokemon:r.slice(c.mons,c.mons+6).map(x=>x.trim()).filter(Boolean)}));
}
// Effectively live: the sheet index is re-read whenever the cached copy is over INDEX_MAX_AGE_HOURS old
// (or on refresh). Individual pastes never change, so they are cached permanently.
export const INDEX_MAX_AGE_HOURS=6;
export async function pasteIndex({refresh=false}={}){
  const path='knowledge/metagame/vgcpastes/index.json';const hit=await optionalJSON<{source:string;retrievedAt:string;rows:PasteRow[]}|null>(path,null);
  if(hit&&!refresh&&Date.now()-Date.parse(hit.retrievedAt)<INDEX_MAX_AGE_HOURS*3600_000)return hit;
  const url=`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}`;const {text}=await fetchText(url,10_000_000);
  const result={source:SHEET_URL,retrievedAt:new Date().toISOString(),rows:parseIndex(text)};await save(path,result);return result;
}
const pasteId=(link:string)=>link.match(/pokepast\.es\/([a-f0-9]{8,32})/)?.[1]??null;
// Champions stat points are 0–32; mainline-style EVs (e.g. 252) mean the paste is not in Champions format.
export function setsFromPaste(text:string){
  const clean=text.split('\n').filter(l=>!/^\s*(IVs|Tera Type|Gigantamax):/i.test(l)).join('\n');const sets=importText(clean);
  return sets.filter(s=>Object.values(s.statPoints??{}).every(v=>typeof v==='number'&&v<=32)&&Object.values(s.statPoints??{}).reduce((a:number,b)=>a+(b as number),0)<=66);
}
async function paste(id:string){const path=`knowledge/metagame/vgcpastes/pastes/${id}.txt`;try{return await readFile(resolve(ROOT,path),'utf8');}catch{const {text}=await fetchText(`https://pokepast.es/${id}/raw`,200_000);await save(path,text);return text;}}
const base=(s:string)=>dex.species.get(s).baseSpecies;
export async function vgcPastesSets(species:string,limit=30,refresh=false):Promise<MetaSets>{
  const name=dex.species.get(species).name;const index=await pasteIndex({refresh});
  const rows=index.rows.filter(r=>r.hasSpreads&&pasteId(r.paste)&&r.pokemon.some(p=>base(p)===base(name)));
  const examples:ExampleSet[]=[];
  for(const r of rows.slice(0,limit)){try{const set=setsFromPaste(await paste(pasteId(r.paste)!)).find(s=>base(s.species)===base(name));
    if(set)examples.push({species:set.species,nature:set.nature??'Serious',statPoints:{hp:0,atk:0,def:0,spa:0,spd:0,spe:0,...set.statPoints} as MetaSpread['statPoints'],item:set.item??'',ability:set.ability??'',moves:set.moves??[],teamId:r.teamId,player:r.player,event:r.event,rank:r.rank,date:r.date,paste:r.paste});}catch{}}
  const tally=(values:string[]):Share[]=>{const n=values.length;const m=new Map<string,number>();for(const v of values)if(v)m.set(v,(m.get(v)??0)+1);return [...m].sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count,percent:Math.round(1000*count/n)/10}));};
  const spreadKey=(e:ExampleSet)=>`${e.nature}|${Object.values(e.statPoints).join('/')}`;const spreads=tally(examples.map(spreadKey)).map(s=>{const [nature,sp]=s.name.split('|');const v=sp.split('/').map(Number);return {nature,statPoints:{hp:v[0],atk:v[1],def:v[2],spa:v[3],spd:v[4],spe:v[5]},percent:s.percent,count:s.count} as MetaSpread&{count:number};});
  return {source:'vgcpastes',species:name,url:SHEET_URL,retrievedAt:index.retrievedAt,period:`Shared ${examples.at(-1)?.date??'?'} – ${examples[0]?.date??'?'}`,population:'VGCPastes: publicly shared M-C team pastes with spreads (not a random sample)',
    sample:`${examples.length} pastes with ${name} spreads (of ${rows.length} indexed with spreads; newest ${limit} read)`,
    moves:tally(examples.flatMap(e=>e.moves)).map(s=>({...s,percent:Math.round(1000*s.count!/Math.max(1,examples.length))/10})),items:tally(examples.map(e=>e.item)),abilities:tally(examples.map(e=>e.ability)),natures:tally(examples.map(e=>e.nature)),spreads,teammates:[],
    notes:'Exact sets from shared pastes; spreads include their own nature. Move % = share of pastes running the move. Placements and events are as listed on the sheet.',examples};
}
