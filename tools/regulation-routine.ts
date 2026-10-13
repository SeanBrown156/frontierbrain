// The regulation switch routine. Each run (a daily workflow calls it; it exits early unless nextCheckAt has passed):
//   1. confirm the changeover happened from the official source, then change what the app calls the current regulation;
//   2. look for an announcement of the next regulation when none is known (official domains only become "official");
//   3. reschedule itself: the next start date when known, weekly inside 60 days of the end, otherwise monthly.
// It never rewrites teams, replays or data, and a failed fetch is never read as "nothing changed": the switch waits
// and the run retries tomorrow. runRegulationRoutine is pure (injected clock and fetch), so it is tested without network.
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {optionalJSON,save} from './io.ts';
import {INDEX_PATH,NOTICES_PATH,recordPath,loadRegulations,validateRegulations,isoDate,
  type RegulationIndex,type RegulationRecord,type RegulationNotice,type HistoryEntry} from './regulation.ts';

const DAY=86_400_000;
export const DEFAULT_OFFICIAL_HOSTS=['champions-news.pokemon-home.com','pokemon-home.com','pokemon.com','pokemonchampions.jp'];
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];

// --- parsing -----------------------------------------------------------------------------------------------------
// Visible text of an HTML page, one block per line.
export function pageText(html:string){
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi,' ')
    .replace(/<\/?(?:br|p|div|h[1-6]|li|tr|td|article|section|a)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#0?39;|&rsquo;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/[ \t ]+/g,' ').replace(/ *\n[\s\n]*/g,'\n').trim();
}
const TIMESTAMP=/(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4}),?\s+at\s+(\d{1,2}):(\d{2})\s*UTC/gi;
const REGULATION=/Regulation(?:\s+Set)?\s+([A-Z]-[A-Z0-9]{1,3})\b/g;
export interface Announcement {id:string;startsAt?:string;endsAt?:string}
// Regulation ids and the timestamps the page states for each. A timestamp belongs to the nearest regulation mentioned
// before it (or the first one after, if none). Two timestamps are read as start then end; one is read from the words
// before it ("starts", "ends"/"until"). Anything unclear yields a partial announcement, never a guessed date.
export function parseAnnouncements(html:string):Announcement[]{
  const text=pageText(html);const mentions=[...text.matchAll(REGULATION)].map(m=>({id:m[1].toUpperCase(),at:m.index!}));
  if(!mentions.length)return [];
  const out=new Map<string,{stamps:{iso:string;before:string}[]}>();for(const m of mentions)if(!out.has(m.id))out.set(m.id,{stamps:[]});
  for(const m of text.matchAll(TIMESTAMP)){
    const month=MONTHS.indexOf(m[1].toLowerCase()),day=+m[2],year=+m[3],hh=+m[4],mm=+m[5];
    const d=new Date(Date.UTC(year,month,day,hh,mm));if(d.getUTCMonth()!==month||d.getUTCDate()!==day||hh>23||mm>59)continue;
    const owner=[...mentions].reverse().find(x=>x.at<m.index!)??mentions[0];
    out.get(owner.id)!.stamps.push({iso:d.toISOString().replace(/\.\d+Z$/,'Z'),before:text.slice(Math.max(0,m.index!-60),m.index!).toLowerCase()});
  }
  return [...out].map(([id,{stamps}])=>{
    if(stamps.length>=2){const [a,b]=stamps;return Date.parse(a.iso)<Date.parse(b.iso)?{id,startsAt:a.iso,endsAt:b.iso}:{id,startsAt:a.iso};}
    if(stamps.length===1){const s=stamps[0];return /\b(ends?|ending|until|through|expires?)\b/.test(s.before)&&!/\b(starts?|begins?|from|beginning)\b/.test(s.before)?{id,endsAt:s.iso}:{id,startsAt:s.iso};}
    return {id};
  });
}
// Entries of the Champions news listing (en/json/list.json: {data:[{id,title,link:'page/816.html',kindTxt,...}]}, links
// relative to en/) that announce a regulation.
export function listingRegulations(body:string,listURL:string){
  const out:{id:string;title:string;url:string;publishedAt?:number}[]=[];
  try{
    const data=JSON.parse(body)?.data;if(!Array.isArray(data))throw new Error('no data');
    for(const e of data){const title=String(e?.title??'');const m=new RegExp(REGULATION.source).exec(title);if(!m||!e.link)continue;out.push({id:m[1].toUpperCase(),title,publishedAt:Number(e.pubAt)>0?Number(e.pubAt)*1000:undefined,url:new URL(String(e.link),new URL('../',listURL)).href});}
  }catch{
    // Shape changed or HTML: fall back to anchors whose text names a regulation.
    for(const m of body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){const t=pageText(m[2]);const r=new RegExp(REGULATION.source).exec(t);if(r)out.push({id:r[1].toUpperCase(),title:t,url:new URL(m[1],listURL).href});}
  }
  return out;
}
export const hostOf=(url:string)=>{try{return new URL(url).hostname.toLowerCase();}catch{return '';}};
export const isOfficialHost=(url:string,hosts:string[])=>{const h=hostOf(url);return !!h&&hosts.some(o=>h===o||h.endsWith('.'+o));};
// Where an announcement can appear, from the active record's own official URL.
export function listingURLFor(officialURL?:string){
  if(!officialURL)return null;try{const u=new URL(officialURL);return /champions-news\.pokemon-home\.com$/.test(u.hostname)?`${u.origin}/en/json/list.json`:null;}catch{return null;}
}

// --- the routine -------------------------------------------------------------------------------------------------
export interface IssueRequest {key:string;title:string;body:string;labels:string[]}
export interface RoutineAction {kind:'skipped'|'checked'|'discovered'|'drafted'|'promoted'|'dates-updated'|'switched'|'switch-blocked'|'ended-unconfirmed'|'fetch-failed'|'rescheduled';detail:string}
export interface RoutineInput {now:number|string|Date;index:RegulationIndex;records:Record<string,RegulationRecord>;fetchText:(url:string)=>Promise<string>;notices?:RegulationNotice[];force?:boolean}
export interface RoutineResult {due:boolean;actions:RoutineAction[];writes:{path:string;data:unknown}[];notices:RegulationNotice[];issues:IssueRequest[];nextCheckAt:string;index:RegulationIndex;records:Record<string,RegulationRecord>}

const iso=(ms:number)=>new Date(ms).toISOString().replace(/\.\d+Z$/,'Z');
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const mdy=(s:string)=>new Date(s).toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});

export async function runRegulationRoutine(input:RoutineInput):Promise<RoutineResult>{
  const nowMs=typeof input.now==='number'?input.now:new Date(input.now).getTime();const now=iso(nowMs);
  const index=clone(input.index),records=clone(input.records);
  const result:RoutineResult={due:false,actions:[],writes:[],notices:[],issues:[],nextCheckAt:index.nextCheckAt,index,records};
  const due=input.force||!isoDate(index.nextCheckAt)||nowMs>=Date.parse(index.nextCheckAt);
  if(!due){result.actions.push({kind:'skipped',detail:`not due until ${index.nextCheckAt}`});return result;}
  result.due=true;
  const active0=records[index.active];
  if(!active0){result.actions.push({kind:'fetch-failed',detail:`active regulation ${index.active} has no record`});index.lastError=`active regulation ${index.active} has no record`;index.nextCheckAt=iso(nowMs+DAY);result.nextCheckAt=index.nextCheckAt;return result;}
  const hosts=[...new Set([...DEFAULT_OFFICIAL_HOSTS,...(index.sources?.official??[]).map(hostOf),hostOf(active0.officialURL??'')].filter(Boolean))];
  const errors:string[]=[];const existing=input.notices??[];const have=new Set(existing.map(n=>n.id));
  const requested=new Set(index.issuesRequested??[]);
  const notice=(n:Omit<RegulationNotice,'at'|'kind'>)=>{if(have.has(n.id))return;have.add(n.id);result.notices.push({...n,at:now,kind:'regulation'} as RegulationNotice);};
  const issue=(key:string,title:string,body:string)=>{if(requested.has(key))return;requested.add(key);result.issues.push({key,title,body,labels:['regulation']});};
  const fetched=new Map<string,string|null>();
  const get=async(url:string)=>{
    if(fetched.has(url))return fetched.get(url)!;
    try{const t=await input.fetchText(url);fetched.set(url,t);return t;}
    catch(e){errors.push(`${url}: ${(e as Error).message}`);result.actions.push({kind:'fetch-failed',detail:`${url}: ${(e as Error).message}`});fetched.set(url,null);return null;}
  };
  const touch=(r:RegulationRecord)=>{r.verifiedAt=now.slice(0,10);};
  const ids=()=>new Set([index.active,...Object.keys(records).filter(k=>records[k].status==='ended'),...index.history.flatMap(h=>[h.from,h.to])]);

  // Re-read a record's own official page: confirms the id and corrects dates that moved (M-B's end moved a week in practice).
  const reverify=async(r:RegulationRecord)=>{
    if(!r.officialURL)return null;const html=await get(r.officialURL);if(html==null)return null;
    const a=parseAnnouncements(html).find(x=>x.id===r.id);
    const official=isOfficialHost(r.officialURL,hosts);if(!a)return {found:false as const,official};
    if(official){
      for(const k of ['startsAt','endsAt'] as const)if(a[k]&&a[k]!==r[k]){
        result.actions.push({kind:'dates-updated',detail:`${r.id} ${k}: ${r[k]??'unset'} -> ${a[k]}`});
        notice({id:`reg-dates-${r.id}-${k}-${a[k]!.slice(0,10)}`,level:'warning',title:`Regulation ${r.id} dates changed`,body:`The official announcement now gives ${k==='startsAt'?'a start':'an end'} of ${mdy(a[k]!)} (was ${r[k]?mdy(r[k]!):'not stated'}).`,url:r.officialURL});
        r[k]=a[k];touch(r);
      }
    }
    return {found:true as const,official,a};
  };

  // Discovery: a regulation announced after the active one, from the official listing and the active record's own page.
  const discover=async()=>{
    const active=records[index.active];const known=ids();
    const later=(a:Announcement)=>!known.has(a.id)&&(a.startsAt&&active.startsAt?Date.parse(a.startsAt)>Date.parse(active.startsAt):a.id>index.active);
    const found=new Map<string,{a:Announcement;url:string}>();
    const consider=(a:Announcement,url:string)=>{if(!later(a))return;const prev=found.get(a.id);if(!prev||(!prev.a.startsAt||!prev.a.endsAt)&&(a.startsAt&&a.endsAt))found.set(a.id,{a,url});};
    const official=[...new Set([...(index.sources?.official??[]),active.officialURL??''].filter(Boolean))];
    const pages:{url:string;listing?:boolean}[]=[];
    for(const u of official){const l=listingURLFor(u);if(l)pages.push({url:l,listing:true});pages.push({url:u});}
    for(const u of index.sources?.secondary??[])pages.push({url:u});
    let articles=0;
    for(const p of pages){
      const body=await get(p.url);if(body==null)continue;
      if(p.listing){
        for(const e of listingRegulations(body,p.url)){
          // Only regulations that sort after the active one, or were published after it started, can be its successor.
          if(known.has(e.id)||!(e.id>index.active||(e.publishedAt&&e.publishedAt>Date.parse(active.startsAt??'')))||articles>=5)continue;articles++;
          const html=await get(e.url);if(html==null)continue;
          const a=parseAnnouncements(html).find(x=>x.id===e.id)??{id:e.id};consider(a,e.url);
        }
      }else for(const a of parseAnnouncements(body))consider(a,p.url);
    }
    if(!found.size)return false;
    // The earliest-starting announcement wins; partial ones sort last.
    const [id,{a,url}]=[...found].sort((x,y)=>(Date.parse(x[1].a.startsAt??'')||Infinity)-(Date.parse(y[1].a.startsAt??'')||Infinity))[0];
    const isOfficial=isOfficialHost(url,hosts)&&!(index.sources?.secondary??[]).includes(url);
    const complete=!!(a.startsAt&&a.endsAt);const prior=records[id];
    if(isOfficial&&complete){
      const rec:RegulationRecord={...(prior??{}),id,game:active.game,battleType:active.battleType,officialURL:url,startsAt:a.startsAt,endsAt:a.endsAt,status:'upcoming',confidence:'official',
        verifiedAt:now.slice(0,10),discoveredAt:prior?.discoveredAt??now,engine:{verified:false,note:'Legality data for this regulation has not been verified against the pinned engine.'},showdownFormats:prior?.showdownFormats??[],
        evidence:[`${url} states ${mdy(a.startsAt!)} to ${mdy(a.endsAt!)} (retrieved ${now})`]};
      const promoted=prior?.status==='draft';
      records[id]=rec;index.next=id;
      result.actions.push({kind:promoted?'promoted':'discovered',detail:`${id} ${a.startsAt} to ${a.endsAt} (${url})`});
      notice({id:`reg-next-${id}`,level:'info',title:`Regulation ${id} announced`,body:`${id} runs from ${mdy(a.startsAt!)} to ${mdy(a.endsAt!)} (UTC), per the official announcement. The app switches to it automatically once it has started and the changeover is confirmed. Your teams and data are not changed.`,url});
    }else{
      const rec:RegulationRecord={...(prior??{}),id,game:active.game,battleType:active.battleType,officialURL:url,...(a.startsAt?{startsAt:a.startsAt}:{}),...(a.endsAt?{endsAt:a.endsAt}:{}),
        status:'draft',confidence:'secondary',verifiedAt:now.slice(0,10),discoveredAt:prior?.discoveredAt??now,engine:{verified:false},showdownFormats:prior?.showdownFormats??[],
        evidence:[`${url} mentions ${id}${complete?'':' without both dates'} (retrieved ${now})`]};
      records[id]=rec;index.next=id;
      result.actions.push({kind:'drafted',detail:`${id} from ${url} (${isOfficial?'official page, dates incomplete':'not an official source'})`});
      issue(`draft-${id}`,`Confirm Regulation ${id} (unconfirmed announcement)`,`The regulation routine found a mention of Regulation ${id} at ${url} (${isOfficial?'official domain, but without both dates':'not an official domain'}). Start: ${a.startsAt??'not stated'}, end: ${a.endsAt??'not stated'}.\n\nIt is stored as a draft and will not become current until an official source states both dates, or you confirm it by hand (see docs/REGULATION_ROUTINE.md).`);
      notice({id:`reg-draft-${id}`,level:'info',title:`Regulation ${id} may be coming`,body:`A mention of Regulation ${id} was found but it is not confirmed by an official announcement yet. The app keeps ${index.active} as current.`,url});
    }
    return true;
  };

  // 1. Keep the records honest and find a successor. A confirmed next regulation is re-read (dates move mid-season);
  //    otherwise the active record's own page is re-read and the news sources are searched.
  const active=()=>records[index.active];
  const activeEnded=()=>!!active().endsAt&&nowMs>Date.parse(active().endsAt!);
  const nextRec=()=>index.next?records[index.next]:null;
  const confirmed=(r:RegulationRecord|null)=>!!r&&r.status==='upcoming'&&r.confidence==='official';
  let verified:Awaited<ReturnType<typeof reverify>>=null;
  if(confirmed(nextRec()))verified=await reverify(nextRec()!);
  else{await reverify(active());if(!nextRec()||nextRec()!.status==='draft')await discover();}
  // 2. Changeover: the active regulation has ended, or the next one's start has passed. Only a confirmed official
  //    next regulation, re-verified in this run, ever becomes current.
  let switched=false;
  const pending=()=>{const n=nextRec();return n&&(activeEnded()||(n.startsAt&&nowMs>=Date.parse(n.startsAt)))?n:null;};
  const n=pending();
  if(n){
    if(confirmed(n)){
      if(verified==null){/* fetch failed: already recorded; a failure never counts as "nothing changed" */}
      else if(!verified.found||!n.startsAt){
        result.actions.push({kind:'switch-blocked',detail:`${n.id}: the official page no longer states its dates`});
        issue(`unverified-${n.id}`,`Regulation ${n.id} changeover could not be verified`,`${active().id} has ended or ${n.id} should have started, but ${n.officialURL} no longer states ${n.id}'s dates. The app still treats ${active().id} as current. Check the official announcement and correct knowledge/regulations/${n.id.toLowerCase()}.json (see docs/REGULATION_ROUTINE.md).`);
        notice({id:`reg-ended-${active().id}`,level:'warning',title:`Regulation ${active().id} has ended`,body:`The next regulation (${n.id}) could not be confirmed yet. Legality and usage in the app are still ${active().id} data.`,url:n.officialURL});
      }else if(nowMs<Date.parse(n.startsAt)){
        result.actions.push({kind:'checked',detail:`${n.id} starts ${n.startsAt}; not switching yet`});
      }else{
        const from=active().id;
        records[from].status='ended';n.status='active';index.active=n.id;index.next=null;
        index.history.push({id:`switch-${from}-${n.id}`,switchedAt:now,from,to:n.id,confidence:'official',evidence:[...(n.evidence??[]),`re-verified ${n.officialURL} on ${now}`]});
        switched=true;
        result.actions.push({kind:'switched',detail:`${from} -> ${n.id}`});
        notice({id:`reg-switched-${n.id}`,level:'info',title:`Now on Regulation ${n.id}`,
          body:`Regulation ${from} has ended and the official announcement confirms ${n.id} has started. The app now calls ${n.id} current. Your teams, replays and saved data are unchanged${n.engine?.verified===true?'':`; legality data for ${n.id} is not verified yet, so legality checks, calcs and usage here still come from the pinned ${from} engine`}.`,url:n.officialURL});
      }
    }else{
      // Draft or secondary: never switch on it.
      result.actions.push({kind:'switch-blocked',detail:`${n.id} is ${n.status}/${n.confidence}, not an official upcoming regulation`});
      if(activeEnded())notice({id:`reg-ended-${active().id}`,level:'warning',title:`Regulation ${active().id} has ended`,body:`The next regulation (${n.id}) is not confirmed by an official announcement yet. The app keeps ${active().id} as current and will switch once it is confirmed.`,url:n.officialURL});
      issue(`unconfirmed-${n.id}`,`Regulation ${active().id} ended; ${n.id} is unconfirmed`,`${active().id} has ended but ${n.id} is only ${n.status} (${n.confidence}). The app has not switched. Confirm it against the official announcement and set status upcoming / confidence official in knowledge/regulations/${n.id.toLowerCase()}.json, or wait for the routine to find the official page (see docs/REGULATION_ROUTINE.md).`);
    }
  }
  // 3. Right after a switch, look for the regulation that follows it.
  if(switched&&!index.next)await discover();
  if(activeEnded()&&!index.next&&!errors.length){
    notice({id:`reg-ended-${active().id}`,level:'warning',title:`Regulation ${active().id} has ended`,body:`No successor has been announced on the official Champions news pages yet. The app keeps ${active().id} as current, so legality and usage here are ${active().id} data. It checks again daily.`,url:active().officialURL});
    result.actions.push({kind:'ended-unconfirmed',detail:`${active().id} ended; no announced successor`});
  }

  // 4. Reschedule. A failure retries tomorrow; otherwise the earliest of the dates that matter.
  const act=active();const n2=index.next?records[index.next]:null;
  const candidates:number[]=[];
  const future=(s?:string)=>s&&Date.parse(s)>nowMs?Date.parse(s):null;
  if(n2&&n2.status==='upcoming'&&n2.confidence==='official'){
    const s=future(n2.startsAt);
    // Confirmed date: wake at the start. Re-read the announcement at least fortnightly, since dates move mid-season.
    candidates.push(s!==null?Math.min(s,nowMs+14*DAY):nowMs+DAY);
  }else{
    const e=future(act.endsAt);
    if(e!==null){candidates.push(e<=nowMs+60*DAY?Math.min(nowMs+7*DAY,e):Math.min(nowMs+30*DAY,e));}
    else candidates.push(activeEndedAt(act,nowMs)?nowMs+DAY:nowMs+30*DAY);
    if(n2&&n2.status==='draft')candidates.push(nowMs+7*DAY);
  }
  let nextCheck=Math.min(...candidates);
  if(errors.length)nextCheck=Math.min(nextCheck,nowMs+DAY);
  if(!(nextCheck>nowMs))nextCheck=nowMs+DAY;
  index.nextCheckAt=iso(nextCheck);index.lastCheckedAt=now;
  index.lastError=errors.length?errors.join('; ').slice(0,500):null;
  index.errorStreak=errors.length?(index.errorStreak??0)+1:0;
  if(index.errorStreak>=3)issue('fetch-failing',`Regulation routine cannot reach its sources`,`The regulation routine has failed to fetch its official sources for ${index.errorStreak} runs in a row. Last error: ${index.lastError}. The app keeps the current regulation unchanged. The source may have changed shape or moved (see docs/REGULATION_ROUTINE.md).`);
  else if(!errors.length)requested.delete('fetch-failing');
  index.issuesRequested=[...requested];
  result.actions.push({kind:'rescheduled',detail:`next check ${index.nextCheckAt}${errors.length?' (retry after a fetch failure)':''}`});
  result.nextCheckAt=index.nextCheckAt;

  const problems=validateRegulations(index,records);
  if(problems.length)throw new Error(`Regulation routine produced an invalid state, nothing written: ${problems.join('; ')}`);
  // Writes: changed records, the index, and the notices file (append, newest 50).
  for(const [id,rec] of Object.entries(records))if(JSON.stringify(rec)!==JSON.stringify(input.records[id]))result.writes.push({path:recordPath(id),data:rec});
  result.writes.push({path:INDEX_PATH,data:index});
  if(result.notices.length)result.writes.push({path:NOTICES_PATH,data:{notices:[...existing,...result.notices].slice(-50)}});
  return result;
}
const activeEndedAt=(r:RegulationRecord,nowMs:number)=>!!r.endsAt&&nowMs>Date.parse(r.endsAt);

// --- IO wrapper (CLI and workflow) ---------------------------------------------------------------------------------
export async function fetchOfficial(url:string){
  const r=await fetch(url,{headers:{'user-agent':'frontier-brain regulation routine (+https://github.com/SeanBrown156/frontierbrain)',accept:'text/html,application/json'},signal:AbortSignal.timeout(20_000)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.text();
}
export async function regulationCheck(opts:{dryRun?:boolean;force?:boolean;now?:number;fetchText?:(u:string)=>Promise<string>;out?:string}={}){
  const state=await loadRegulations();if(!state)throw new Error('No regulation records found (knowledge/regulations)');
  const notices=(await optionalJSON<{notices:RegulationNotice[]}>(NOTICES_PATH,{notices:[]})).notices??[];
  const r=await runRegulationRoutine({now:opts.now??Date.now(),index:state.index,records:state.records,notices,force:opts.force,fetchText:opts.fetchText??fetchOfficial});
  if(!opts.dryRun)for(const w of r.writes)await save(w.path,w.data);
  const summary={dryRun:!!opts.dryRun,due:r.due,active:r.index.active,next:r.index.next,nextCheckAt:r.nextCheckAt,lastError:r.index.lastError??null,actions:r.actions,notices:r.notices,issues:r.issues,
    wouldWrite:opts.dryRun?r.writes.map(w=>w.path):undefined,wrote:opts.dryRun?[]:r.writes.map(w=>w.path)};
  if(opts.out){const p=resolve(opts.out);await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(summary,null,2));}
  return summary;
}
