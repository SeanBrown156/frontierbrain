import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT,CODE,json,optionalJSON,save,id,hash,localDay,listDir,readText,config} from './io.ts';
import {dex} from './mechanics.ts';
import {fetchText,parseUsage,pool} from './research.ts';
import {loadGames,type Game} from './replays.ts';
import {readStore,currentTeam,sameRoster,legacyTeams} from './workbench-store.ts';
import type {Workbench,NewsWeek} from '../shared/workbench.ts';

export function weekStart(date:string):string{const d=new Date(date.slice(0,10)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
// Weekly news comes from the repository (the news routine commits it to main) and from the data directory (a local
// research run). Per week, the more recently researched copy wins, so neither silently shadows the other.
export function mergeNews(...sources:NewsWeek[][]):NewsWeek[]{const byStart=new Map<string,NewsWeek>();
  for(const w of sources.flat()){const had=byStart.get(w.start);if(!had||Date.parse(w.researchedAt)>Date.parse(had.researchedAt))byStart.set(w.start,w);}
  return [...byStart.values()].sort((a,b)=>b.start.localeCompare(a.start));}
async function newsWeeks(){const shipped=await readFile(resolve(CODE,'knowledge/news/weeks.json'),'utf8').then(t=>JSON.parse(t) as NewsWeek[]).catch(()=>[]);
  return mergeNews(shipped,await optionalJSON<NewsWeek[]>('knowledge/news/weeks.json',[]));}
export function newsWindow(weeks:NewsWeek[],today=localDay()){
  const start=weekStart(today);return [0,1,2].map(n=>{const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-7*n);const s=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);const e=d.toISOString().slice(0,10);const existing=weeks.find(w=>w.start===s);return existing?{...existing,partial:n===0}:{start:s,end:e,partial:n===0,digest:['Research has not been completed for this week.'],articles:[],coverage:['No saved digest; run weekly research.'],researchedAt:null};});
}
export async function usageHistory(){
  const output:any[]=[];for(const folder of (await listDir('knowledge/metagame/snapshots')).filter(f=>/^\d{4}-\d{2}$/.test(f))){for(const file of await listDir(`knowledge/metagame/snapshots/${folder}`)){if(file.includes('-sets-')||!file.endsWith('.json'))continue;const s=await json(`knowledge/metagame/snapshots/${folder}/${file}`);if(s.rows)output.push(s);}}
  // Repeated weekly fetches of one published period are one measurement, not a flat weekly series.
  const dedup=new Map();for(const s of output.sort((a,b)=>a.fetchedAt.localeCompare(b.fetchedAt)))dedup.set(`${s.format}:${s.rating}:${s.period}`,s);return [...dedup.values()].sort((a,b)=>a.period.localeCompare(b.period));
}
export function comparableDelta(latest:any,previous:any,species:string):number|null{
  if(!previous||latest.format!==previous.format||latest.rating!==previous.rating||latest.source!==previous.source||latest.period===previous.period)return null;
  const a=latest.rows.find((r:any)=>r.species===species),b=previous.rows.find((r:any)=>r.species===species);return a&&b?a.usagePercent-b.usagePercent:null;
}
export async function backfillUsage(){
  const latest=await json('knowledge/metagame/latest.json');const history=await usageHistory();const existing=new Set(history.map(s=>`${s.format}:${s.rating}:${s.period}`));const errors=[];let added=0;
  for(const entry of latest.usage){for(let offset=1;offset<=2;offset++){const d=new Date(entry.period+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-offset);const period=d.toISOString().slice(0,7);if(existing.has(`${entry.format}:${entry.rating}:${period}`))continue;
    const url=`https://www.smogon.com/stats/${period}/${entry.format}-${entry.rating}.txt`;try{const r=await fetchText(url);const parsed=parseUsage(r.text);const sha256=hash(r.text);await save(`knowledge/metagame/snapshots/${period}/${entry.format}-${entry.rating}-${sha256.slice(0,12)}.json`,{source:'Smogon',url,format:entry.format,period,rating:entry.rating,fetchedAt:new Date().toISOString(),...parsed});added++;}catch(e){errors.push({url,error:(e as Error).message});}}
  }await save('knowledge/metagame/history-check.json',{checkedAt:new Date().toISOString(),added,errors});return {added,errors};
}
export function parseTournamentUsage(html:string){
  const clean=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  const table=html.match(/<table[\s\S]*?<\/table>/i)?.[0];if(!table)throw new Error('No tournament usage table');
  const rows=[...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(m=>{const rawCells=[...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1]);const cells=rawCells.map(clean);if(cells.length<5||!cells[4].endsWith('%'))return [];
    const icon=rawCells[1].match(/alt="([^"]+)"/)?.[1];const canonical=dex.species.get(icon??cells[2]);const species=canonical.exists?canonical.name:cells[2];const usagePercent=Number(cells[4].replace('%',''));const rawCount=Number(cells[3]);return Number.isFinite(usagePercent)?[{rank:Number(cells[0]),species,usagePercent,rawCount,...species!==cells[2]?{sourceSpeciesName:cells[2]}:{}}]:[];});if(!rows.length)throw new Error('Unrecognised tournament table');return rows;
}
export async function refreshEvents(){
  const checks=await json<any[]>('knowledge/sources/checks.json');const links=checks.find(c=>c.id==='limitless')?.links??[];
  const saved=await optionalJSON<any[]>('knowledge/metagame/events.json',[]);const candidates=[...new Set([...saved.map(s=>s.id),...links.flatMap((l:any)=>l.url.match(/\/tournaments\/(\d+)(?:$|\/)/)?.[1]??[])])].slice(0,12);const errors=[];
  for(const eventId of candidates){try{const url=`https://limitlessvgc.com/tournaments/${eventId}/statistics`;const r=await fetchText(url);if(!/Regulation Set M-C/i.test(r.text))continue;const rows=parseTournamentUsage(r.text);const title=r.text.match(/<title[^>]*>(.*?)<\/title>/i)?.[1].replace(' - Statistics','').replace(/ – Limitless VGC.*/, '')??`Event ${eventId}`;
      const results=await fetchText(`https://limitlessvgc.com/tournaments/${eventId}`);
      const meta=parseEventMetadata(results.text);const prior=saved.find(s=>s.id===eventId);const record={id:eventId,name:title,date:meta.date,format:'Champions Regulation M-C',population:'Phase 2 only',entrants:meta.entrants,sampleSize:meta.sampleSize,sampleMethod:'Count of phase-2 results rows on the event page',rows,url,fetchedAt:new Date().toISOString()};
      if(prior)Object.assign(prior,record);else saved.push(record);
    }catch(e){errors.push({id:eventId,error:(e as Error).message});}}
  await save('knowledge/metagame/events.json',saved);await save('knowledge/metagame/events-check.json',{checkedAt:new Date().toISOString(),errors});return {events:saved.length,errors};
}
export function parseEventMetadata(html:string){
  const description=html.match(/<meta name="description" content="([^"]*)"/)?.[1]??'';const raw=description.split(' - ')[0].replace(/(\d+)(st|nd|rd|th)/,'$1');const parsed=new Date(raw+' UTC');if(!Number.isFinite(parsed.getTime()))throw new Error('Unknown event date');
  const text=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');const entrants=Number(text.match(/([\d,]+) Players/)?.[1].replaceAll(',',''));if(!entrants)throw new Error('Unknown event size');
  const table=html.match(/<table[\s\S]*?<\/table>/i)?.[0];const sampleSize=[...(table??'').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].filter(m=>/<td/.test(m[1])).length;if(!sampleSize)throw new Error('No results sample');
  if(!/phase 2/i.test(html))throw new Error('Tournament population needs manual confirmation');return {date:parsed.toISOString().slice(0,10),entrants,sampleSize};
}
export async function cacheArtwork(names:string[]){
  const manifest=await optionalJSON<Record<string,any>>('knowledge/artwork/manifest.json',{});
  const slugs:Record<string,string>={'indeedeef':'indeedee-female','indeedee':'indeedee-male','basculegion':'basculegion-male','basculegionf':'basculegion-female','mausholdfour':'maushold-family-of-four','maushold':'maushold-family-of-four','mausholdthree':'maushold-family-of-three','meowstic':'meowstic-male','meowsticf':'meowstic-female','meowsticfmega':'meowstic-female-mega','meowsticmmega':'meowstic-male-mega','taurospaldeaaqua':'tauros-paldea-aqua-breed','taurospaldeablaze':'tauros-paldea-blaze-breed','taurospaldeacombat':'tauros-paldea-combat-breed','floetteeternal':'floette-eternal'};
  const results=await pool([...new Set(names)],async name=>{
    const key=id(name);if(manifest[key]?.state==='cached')return manifest[key];const species=dex.species.get(name);let slug=slugs[key]??species.name.toLowerCase().replace(/[^a-z0-9-]/g,'');
    slug=slug.replace(/-hisui$/,'-hisui').replace(/-alola$/,'-alola');
    const record:any={species:name,state:'missing',checkedAt:new Date().toISOString(),attribution:'Official Pokémon illustrations © Pokémon / Nintendo / Creatures / GAME FREAK. Personal local reference; no claim of blanket redistribution rights.',provider:'PokéAPI official-artwork'};
    try{if(!species.exists||species.num<1)throw new Error('Unknown species');if(!species.forme&&!slugs[key])slug=String(species.num);
      const endpoint=`https://pokeapi.co/api/v2/pokemon/${slug}`;const api=await fetch(endpoint,{signal:AbortSignal.timeout(12000)});if(!api.ok)throw new Error(`Artwork mapping HTTP ${api.status}`);const data:any=await api.json();const url=data.sprites?.other?.['official-artwork']?.front_default;if(!url||!/^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\//.test(url))throw new Error('No verified illustrated artwork for this form');
      const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Image HTTP ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>3_000_000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid or oversized PNG');
      await save(`knowledge/artwork/images/${key}.png`,bytes);Object.assign(record,{state:'cached',url,mappingURL:endpoint,sha256:hash(bytes),file:`knowledge/artwork/images/${key}.png`});
    }catch(e){record.error=(e as Error).message;}return record;
  },6);for(const r of results)manifest[id(r.species)]=r;await save('knowledge/artwork/manifest.json',manifest);return {cached:results.filter(r=>r.state==='cached').length,missing:results.filter(r=>r.state!=='cached').map(r=>r.species)};
}
export function coachStats(games:Game[]){
  const complete=games.filter(g=>g.result!=='incomplete');const wins=complete.filter(g=>g.result==='win').length;const losses=complete.filter(g=>g.result==='loss').length;const ties=complete.filter(g=>g.result==='tie').length;
  const bring:Record<string,any>={},leads:Record<string,any>={},matchups:Record<string,any>={},moves:Record<string,number>={},leadMatchups:Record<string,any>={},megas:Record<string,any>={};
  for(const g of complete){const other=g.ownSide==='p1'?'p2':'p1';const win=g.result==='win';const lead=[...g.leads[g.ownSide]].sort().join(' + ');const opposing=[...g.leads[other]].sort().join(' + ');
    for(const [bucket,key] of [[leads,lead],[leadMatchups,`${lead} → ${opposing}`]] as const){const r=bucket[key]??={games:0,wins:0,losses:0,ties:0};r.games++;r[g.result==='win'?'wins':g.result==='loss'?'losses':'ties']++;}
    for(const p of g.preview[g.ownSide]){const r=bring[p]??={preview:0,observed:0,wins:0,led:0,leadWins:0,unknown:0};r.preview++;if(g.revealed[g.ownSide].includes(p)){r.observed++;if(win)r.wins++;}else if(g.unknownBackSlots[g.ownSide])r.unknown++;if(g.leads[g.ownSide].includes(p)){r.led++;if(win)r.leadWins++;}}
    for(const p of g.preview[other]){const r=matchups[p]??={preview:0,previewWins:0,observed:0,wins:0,unknown:0};r.preview++;if(win)r.previewWins++;if(g.revealed[other].includes(p)){r.observed++;if(win)r.wins++;}else if(g.unknownBackSlots[other])r.unknown++;}
    for(const e of g.events.filter(e=>e.type==='-mega'&&e.args[0].startsWith(g.ownSide))){const p=e.args[1];const r=megas[p]??={games:0,wins:0};r.games++;if(win)r.wins++;}
    // Use sequential identity, rather than confusing a nickname with a species. Skip called/copy moves.
    const identity:Record<string,string>={};for(const e of g.events){if(['switch','drag','replace','detailschange'].includes(e.type)){const species=e.args[1]?.split(',')[0];if(species)identity[e.args[0]]=species;}
      if(e.type==='move'&&e.args[0].startsWith(g.ownSide)&&!e.args.some(a=>a.startsWith('[from]'))){const p=identity[e.args[0]]??'Unknown identity';const key=`${p}: ${e.args[1]}`;moves[key]=(moves[key]??0)+1;}}
  }
  return {total:games.length,games:complete.length,wins,losses,ties,incomplete:games.length-complete.length,bring,leads,matchups,moves,leadMatchups,megas};
}
export async function dashboard(storageRoot=ROOT){
  const [db,games,usage,news,sources,art,index,events,historyCheck]=await Promise.all([readStore(storageRoot),loadGames(),usageHistory(),newsWeeks(),json('knowledge/sources/catalogue.json'),optionalJSON('knowledge/artwork/manifest.json',{}),optionalJSON<any>('replays/index.json',{games:[],errors:[]}),optionalJSON('knowledge/metagame/events.json',[]),optionalJSON('knowledge/metagame/history-check.json',null)]);
  const summaries=games.map(g=>{const suggestions=db.teams.filter(t=>sameRoster(g.preview[g.ownSide],currentTeam(db,t).sets.map(s=>s.species))).map(t=>t.id);return {...g,events:undefined,turns:undefined,finalState:undefined,suggestions,association:db.associations[g.id]??null,reviewPath:index.games.find((e:any)=>e.id===g.id)?.reviewPath??null};});
  const teams=db.teams.map(t=>({...t,view:currentTeam(db,t)}));
  const reportNames=await listDir('reports/replay-reviews');const coaching=reportNames.filter(f=>f.endsWith('-coaching.md')).sort().at(-1);const overview=coaching?await readText(`reports/replay-reviews/${coaching}`):'';
  let reviews:any[]=[];try{const viaBackend=storageRoot===ROOT;const files=viaBackend?await listDir('reports/coaching'):await readdir(resolve(storageRoot,'reports/coaching'));reviews=await Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(async f=>{const r=JSON.parse(viaBackend?await readText(`reports/coaching/${f}`):await readFile(resolve(storageRoot,'reports/coaching',f),'utf8'));return {...r,stale:r.associationFingerprint!==hash(JSON.stringify(r.scope.replayIds.map((id:string)=>[id,db.associations[id]??null])))};}));reviews.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  return {profile:await config(),db,teams,reviews,legacyTeams:(await legacyTeams(storageRoot)).filter(t=>!db.teams.some(team=>team.name===t.id)),games:summaries,stats:coachStats(games),usage,events,news:newsWindow(news),sources,art,historyCheck,coaching:overview,coachingPath:coaching?`reports/replay-reviews/${coaching}`:null,ingestionErrors:index.errors};
}
