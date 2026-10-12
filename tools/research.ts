import {json,optionalJSON,save,stamp,localDay,markdown,hash,config as profile} from './io.ts';

export interface Source {id:string;name:string;url:string;categories:string[];notes:string;aiNotes?:string;aiName?:string;}
const agent='PokemonVGCWorkspace/1.0 (personal research; bounded requests)';
// Network drops and 429/5xx are retried twice with backoff; other HTTP errors fail immediately.
export async function fetchText(url:string,maxBytes=15_000_000,timeout=20000,tries=3):Promise<{text:string;finalURL:string;status:number;contentType:string|null}> {
  let r:Response;
  try{r=await fetch(url,{headers:{'User-Agent':agent},signal:AbortSignal.timeout(timeout)});}catch(e){if(tries>1){await new Promise(ok=>setTimeout(ok,2000*(4-tries)));return fetchText(url,maxBytes,timeout,tries-1);}throw new Error(`${(e as Error).message} (${url})`);}
  if((r.status===429||r.status>=500)&&tries>1){await new Promise(ok=>setTimeout(ok,3000*(4-tries)));return fetchText(url,maxBytes,timeout,tries-1);}
  if(!r.ok)throw new Error(`HTTP ${r.status} from ${url}`);
  const reader=r.body?.getReader();if(!reader)throw new Error('No response body');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error(`Response exceeds ${maxBytes} bytes`);chunks.push(value);}}finally{reader.releaseLock();}
  return {text:Buffer.concat(chunks).toString('utf8'),finalURL:r.url,status:r.status,contentType:r.headers.get('content-type')};
}
export async function pool<T,U>(items:T[],fn:(item:T)=>Promise<U>,limit=4){
  const results:U[]=new Array(items.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const i=cursor++;if(i>=items.length)return;results[i]=await fn(items[i]);}}));return results;
}
function unhtml(text:string){return text.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
export function parseUsage(text:string){
  const battles=Number(text.match(/Total battles:\s*(\d+)/)?.[1]);if(!Number.isInteger(battles))throw new Error('Not a Smogon usage table');
  const rows=text.split('\n').flatMap(line=>{const m=line.match(/^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([\d.]+)%\s*\|\s*(\d+)\s*\|/);return m?[{rank:Number(m[1]),species:m[2].trim(),usagePercent:Number(m[3]),rawCount:Number(m[4])}]:[];});
  if(!rows.length)throw new Error('Usage table contains no rows');return {battles,rows};
}
export function parseMovesets(text:string) {
  const rows=text.split('\n').flatMap(l=>{const m=l.match(/^\|\s*(.*?)\s*\|$/);return m?[m[1].trim()]:[];});
  const data:Record<string,any>={};let current:any=null;let category:string|null=null;
  const names=['Abilities','Items','Spreads','Moves','Teammates'];
  for(let i=0;i<rows.length;i++){
    if(rows[i+1]?.startsWith('Raw count:')){current={rawCount:Number(rows[i+1].split(':')[1].trim()),categories:{}};data[rows[i]]=current;category=null;continue;}
    if(!current)continue;
    if(names.includes(rows[i])){category=rows[i];current.categories[category]=[];continue;}
    if(rows[i]==='Checks and Counters'){category=null;continue;}
    const m=rows[i].match(/^(.*?)\s+([\d.]+)%$/);
    if(category&&m)current.categories[category].push({name:m[1],percent:Number(m[2])});
  }
  if(!Object.keys(data).length)throw new Error('Not a Smogon moveset table');return data;
}
export async function sourceIndex(checks:any[]=[]) {
  const catalogue=await json<Source[]>('knowledge/sources/catalogue.json');let text='# VGC source quick reference\n\n';
  text+='Use this index to find evidence quickly. [Verified research routes](research-routes.md) link current tournament results, team sheets and authored reports. Fetch dates are availability checks, not confirmation that a default page is the right format. Always record event/period/population. Treat mirrors of Smogon data as the same underlying evidence.\n\n';
  const categories=[...new Set(catalogue.flatMap(s=>s.categories))];
  for(const category of categories){text+=`## ${category}\n\n`;for(const s of catalogue.filter(s=>s.categories.includes(category))){const c=checks.find(c=>c.id===s.id);text+=`- [${s.aiName??s.name}](${s.url}) — ${s.aiNotes??s.notes}${c?` Latest check: ${c.state} (${c.checkedAt.slice(0,10)}).`:''}\n`;}text+='\n';}
  await save('knowledge/sources/INDEX.md',text);return catalogue;
}
export async function refreshResearch() {
  const catalogue=await json<Source[]>('knowledge/sources/catalogue.json');const fetchedAt=new Date().toISOString();
  const previous=await optionalJSON<any>('knowledge/metagame/latest.json',null);
  const checks=await pool(catalogue,async s=>{
    if(s.id==='pasrs-sheet'||s.id==='vgcpastes')return {id:s.id,url:s.url,checkedAt:fetchedAt,state:'connector-required',notes:'Verified supplied/discovered Google Sheet; use Drive or published sheet for contents, not generic homepage fetch.'};
    try{const r=await fetchText(s.url,3_000_000);const title=unhtml(r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'');
      const blocked=/just a moment|access denied|checking your browser|captcha/i.test(title);
      const links=[...r.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(m=>{try{const u=new URL(m[1],r.finalURL);if(!['https:','http:'].includes(u.protocol))return [];const label=unhtml(m[2]).slice(0,160);return label&&/tournament|regional|champion|regulation|report|2026|results|team/i.test(label+' '+u.pathname)?[{label,url:u.href}]:[];}catch{return [];}}).slice(0,50);
      return {id:s.id,url:s.url,finalURL:r.finalURL,checkedAt:fetchedAt,state:blocked?'browser-required':'reachable',title,contentHash:hash(r.text),links};
    }catch(e){return {id:s.id,url:s.url,checkedAt:fetchedAt,state:'fetch-failed',error:(e as Error).message};}
  });
  await save('knowledge/sources/checks.json',checks);await sourceIndex(checks);
  const usage:any[]=[];const errors:any[]=[];
  let periods:string[]=[];
  try{const r=await fetchText('https://www.smogon.com/stats/');periods=[...r.text.matchAll(/href="(\d{4}-\d{2})\//g)].map(m=>m[1]).filter(p=>p<new Date().toISOString().slice(0,7)).sort().reverse().slice(0,3);}catch(e){errors.push({source:'smogon-index',error:(e as Error).message});}
  const config=await profile();
  for(const format of [config.format,config.format+'bo3']){
    let period:string|undefined;
    for(const p of periods){try{const r=await fetchText(`https://www.smogon.com/stats/${p}/`);if(r.text.includes(`${format}-0.txt`)){period=p;break;}}catch(e){errors.push({source:`smogon-${p}`,error:(e as Error).message});}}
    if(!period){errors.push({source:format,error:'No exact-format dataset found in the newest three published months; do not substitute another regulation'});continue;}
    const results=await pool<number,any>(config.ratingBrackets,async rating=>{
      const url=`https://www.smogon.com/stats/${period}/${format}-${rating}.txt`;
      try{const raw=await fetchText(url);const parsed=parseUsage(raw.text);const snapshot={source:'Smogon',url,format,period,rating,fetchedAt,...parsed,sha256:hash(raw.text)};const path=`knowledge/metagame/snapshots/${period}/${format}-${rating}-${snapshot.sha256.slice(0,12)}.json`;
        if(!await optionalJSON(path,null))await save(path,snapshot);
        const setsURL=`https://www.smogon.com/stats/${period}/moveset/${format}-${rating}.txt`;let setsPath:string|null=null;let setsError:string|null=null;
        try{const rawSets=await fetchText(setsURL);const data=parseMovesets(rawSets.text);setsPath=`knowledge/metagame/snapshots/${period}/${format}-${rating}-sets-${hash(rawSets.text).slice(0,12)}.json`;if(!await optionalJSON(setsPath,null))await save(setsPath,{schemaVersion:2,source:'Smogon',url:setsURL,format,period,rating,fetchedAt,data,notes:'Published truncated distributions: Other groups the tail. Move percentages are reported set prevalence, not normalized move-slot shares.'});}catch(e){setsError=(e as Error).message;}
        return {path,format,period,rating,battles:parsed.battles,url,sha256:snapshot.sha256,setsPath,setsError};
      }catch(e){return {format,period,rating,url,error:(e as Error).message};}
    });for(const r of results)if(r.error)errors.push(r);else {usage.push(r);if(r.setsError)errors.push({source:`${format}-${r.rating}-sets`,error:r.setsError});}
  }
  const manifest={fetchedAt,sourceChecks:'knowledge/sources/checks.json',usage,errors,previousFetchedAt:previous?.fetchedAt??null,newPublishedData:usage.some(u=>!previous?.usage?.some((p:any)=>p.format===u.format&&p.rating===u.rating&&p.sha256===u.sha256))};
  await save('knowledge/metagame/latest.json',manifest);await save(`knowledge/metagame/refreshes/${stamp()}.json`,manifest);
  return manifest;
}
export async function weeklyReport() {
  const previous=await optionalJSON<any>('knowledge/metagame/latest.json',null);const manifest=await refreshResearch();
  let report=`# Metagame evidence — ${localDay()}\n\nRetrieved ${manifest.fetchedAt}. Exact-format monthly Showdown datasets; these are not Champions in-game ladder or tournament statistics. New published monthly data: ${manifest.newPublishedData?'yes':'no'}.\n\n`;
  for(const entry of manifest.usage.filter(u=>u.rating===1500)){
    const snapshot=await json(entry.path);const oldEntry=previous?.usage?.find((p:any)=>p.format===entry.format&&p.rating===entry.rating&&p.period!==entry.period);const old=oldEntry?await json(oldEntry.path):null;
    report+=`## ${entry.format} — ${entry.period}, rating weight ${entry.rating}\n\n${entry.battles.toLocaleString()} total battles in source dataset; rating is a weighting cutoff, not necessarily a hard player inclusion filter. [Original source](${entry.url}).\n\n| Pokémon | Weighted usage | Change vs prior comparable period |\n| --- | ---: | --- |\n`;
    for(const p of snapshot.rows.slice(0,20)){const oldMon=old?.rows.find((r:any)=>r.species===p.species);report+=`| ${markdown(p.species)} | ${p.usagePercent.toFixed(2)}% | ${oldMon?(p.usagePercent-oldMon.usagePercent).toFixed(2)+' pp':'no comparable prior snapshot'} |\n`;}
    report+='\n';
  }
  report+='## Tournament and report research queue\n\nThe links below are discovery evidence, not parsed standings or validated format-specific usage. Read relevant event pages and authored reports before drawing tournament conclusions.\n\n';
  const checks=await json<any[]>('knowledge/sources/checks.json');
  for(const c of checks.filter(c=>['limitless','victory-road','top-cut','liberty-note','labmaus','vgcpastes'].includes(c.id))){report+=`- ${c.id}: ${c.state}${c.error?' — '+c.error:''}.\n`;for(const link of (c.links??[]).slice(0,8))report+=`  - [${markdown(link.label)}](${link.url})\n`;}
  report+='\n## Interpretation to complete with vgc-analysis\n\nCompare event results, identify current archetypes, check sets/spreads and speed benchmarks, and connect evidence to active teams. Avoid claiming that a snapshot refresh itself establishes a strategic trend.\n';
  if(manifest.errors.length)report+='\n## Data gaps\n\n'+manifest.errors.map(e=>`- ${e.source??e.format}: ${e.error}`).join('\n')+'\n';
  const path=`reports/metagame/${localDay()}-evidence.md`;await save(path,report);await save(`reports/runs/weekly-${stamp()}.json`,{at:manifest.fetchedAt,report:path,errors:manifest.errors});return {report:path,manifest};
}
export async function setDistribution(name:string,format:string,rating=1500) {
  const latest=await json('knowledge/metagame/latest.json');const entry=latest.usage.find((u:any)=>u.format===format&&u.rating===rating);if(!entry?.setsPath)throw new Error('No fetched moveset dataset for that format/bracket; refresh first');
  const snapshot=await json(entry.setsPath);const key=Object.keys(snapshot.data).find(k=>k.toLowerCase()===name.toLowerCase());if(!key)throw new Error('Species absent from dataset');const data=snapshot.data[key];
  return {source:snapshot.url,period:snapshot.period,format,rating,species:key,rawCount:data.rawCount,categories:data.categories,notes:snapshot.notes+' Spreads are Champions SP in hp/atk/def/spa/spd/spe order, not mainline EVs.'};
}
