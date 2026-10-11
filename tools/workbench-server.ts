import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {resolve,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {ROOT,CODE,json,optionalJSON,save,hash,id,dataPath,listDir,readText,readBytes,withData,dataContext,config as profile} from './io.ts';
import {dashboard,cacheArtwork,backfillUsage,refreshEvents,coachStats} from './workbench-data.ts';
import {readStore as readRootStore,mutateStore as mutateRootStore,applyAction,currentTeam,teamPaste,sameRoster,Conflict,legacyTeams as legacyRootTeams,makeTeam,associateReplay} from './workbench-store.ts';
import {parseReplay,addReplay,loadGames} from './replays.ts';
import {refreshResearch} from './research.ts';
import {workflowLock} from './workbench-jobs.ts';
import {exportText} from './teams.ts';
import {finalStats,damage,speed,spreadSearch,dex,contextMoves} from './mechanics.ts';
import {jobKinds} from './workbench-worker.ts';
import {metaSets,type MetaSource} from './meta-sets.ts';
import {showdownReplayHTML} from './replay-links.ts';
import {fetchText} from './research.ts';
import {refreshPool,poolStatus,poolOverview,poolTeams} from './pool.ts';
import {iconIndex,iconNumber,iconSheet} from './icons.ts';
import {startJob,listJobs,getJob,dismissJob,cancelJob} from './ai-jobs.ts';
import {modelSettings,saveModelSettings,availableModels} from './models.ts';
import {queueSummaries,readSummary,readDigest,isStale,runningFor,transcript,readGame} from './replay-summary.ts';
import {typicalSet} from './typical-set.ts';
import {hostedConfig,hostedHandler} from './hosted.ts';
import {addSamples,seedNewWorkspace} from './samples.ts';
import {searchPoolTeams,poolTeamDraft} from './pool-import.ts';
import {createBackup,restoreBackup} from './backup.ts';

function respond(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
const WEB_PORT=Number(process.env.WEB_PORT??5173),API_PORT=Number(process.env.API_PORT??5174);
export function allowedRequest(req:IncomingMessage,apiPort=API_PORT){
  const host=req.headers.host; if(!host||![`127.0.0.1:${WEB_PORT}`,`127.0.0.1:${apiPort}`].includes(host))return false;
  const origin=req.headers.origin;return !origin||[`http://127.0.0.1:${WEB_PORT}`,`http://127.0.0.1:${apiPort}`].includes(origin);
}
async function body(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('Expected application/json');let length=0;const chunks:Buffer[]=[];for await(const chunk of req){length+=chunk.length;if(length>8_000_000)throw new Error('Upload exceeds 8 MB');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function jobHistory(){const files=(await listDir('reports/runs')).filter(f=>f.endsWith('.json')&&!f.endsWith('-request.json'));const history=(await Promise.all(files.map(async f=>({...await json(`reports/runs/${f}`),recordPath:`reports/runs/${f}`})))).sort((a,b)=>(b.startedAt??b.at??b.finishedAt??'').localeCompare(a.startedAt??a.at??a.finishedAt??'')).slice(0,40);const recentUI=history.filter(h=>h.id&&h.recordPath.includes('/ui-')).slice(0,8);
  for(const job of recentUI.filter(j=>j.status==='running')){let interrupted=!job.pid&&Date.now()-Date.parse(job.startedAt)>30000;if(job.pid)try{process.kill(job.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')interrupted=true;}if(interrupted){job.status='interrupted';job.phase='Worker stopped before a completion record; rerun the workflow. Original data is preserved.';}}
  return {current:recentUI,history};}
async function runJob(kind:string){
  if(!jobKinds.includes(kind))throw new Error('Unknown workflow');if((await jobHistory()).current.some(j=>j.status==='running'))throw new Conflict('Another UI workflow is active');
  const job:any={id:randomUUID(),kind,status:'running',startedAt:new Date().toISOString(),phase:'Preparing workspace',log:[]};
  await save(`reports/runs/ui-${job.id}.json`,job);
  const child=spawn(process.execPath,[resolve(CODE,'tools/workbench-worker.ts'),kind,job.id],{cwd:CODE,env:process.env,stdio:'ignore',detached:true});child.unref();
  child.once('error',async error=>{job.status='failed';job.error=error.message;job.finishedAt=new Date().toISOString();await save(`reports/runs/ui-${job.id}.json`,job);});return job;
}
export function createWorkbenchHandler(storageRoot=ROOT,apiPort=API_PORT,{hostedMode=false}:{hostedMode?:boolean}={}){
const readStore=()=>readRootStore(storageRoot);const mutateStore=(revision:number,fn:Parameters<typeof mutateRootStore>[1])=>mutateRootStore(revision,fn,storageRoot);const legacyTeams=()=>legacyRootTeams(storageRoot);
async function saveReplay(html:string,associationInput:any,revision:number){
  const config=await profile();const parsed=parseReplay(html,'upload',config.player,config.aliases);
  return workflowLock(async()=>{
    if(associationInput){const preview=await readStore();if(preview.revision!==revision)throw new Conflict('Workspace changed; reload before uploading');associateReplay(preview,parsed,associationInput);}
    const saved=await addReplay(html,`${parsed.id}-${hash(html).slice(0,12)}.html`);parsed.id=saved.id;const outcome:any=saved.duplicate?{duplicate:true,id:saved.id}:{added:saved.added,id:saved.id};
    if(associationInput){
      const changed=await mutateStore(revision,db=>associateReplay(db,parsed,associationInput));
      if(storageRoot===ROOT){const latest=await json('replays/index.json');const entry=latest.games.find((g:any)=>g.logHash===parsed.logHash);entry.teamVersion=changed.db.associations[parsed.id]?.configurationId??null;entry.reviewedAt=null;entry.reviewPath=null;const g=await json(entry.parsed);g.teamVersion=entry.teamVersion;await save(entry.parsed,g);await save('replays/index.json',latest);}
    }
    return outcome;
  });
}
// The caller's own AI key rides along with each request (X-AI-Provider / X-AI-Key) and is never stored.
return function withCallerAI(req:IncomingMessage,res:ServerResponse){
  const key=req.headers['x-ai-key'];if(typeof key!=='string'||!key)return serve(req,res);
  return withData({...dataContext(),ai:{provider:req.headers['x-ai-provider']==='anthropic'?'anthropic':'openai',key}},()=>serve(req,res));
};
async function serve(req:IncomingMessage,res:ServerResponse){
  if(!hostedMode&&!allowedRequest(req,apiPort))return respond(res,403,{error:'Local UI requests only'});
  const url=new URL(req.url??'/',`http://${req.headers.host}`);const path=url.pathname;
  try{
    if(req.method==='GET'&&path==='/api/dashboard'){if(storageRoot===ROOT)await seedNewWorkspace().catch(e=>console.error('Sample teams not added:',(e as Error).message));return respond(res,200,await dashboard(storageRoot));}
    if(req.method==='GET'&&path==='/api/pool-teams'){const lane=url.searchParams.get('lane');return respond(res,200,await searchPoolTeams({q:url.searchParams.get('q')??'',lane:['official','online','shared'].includes(lane??'')?lane as any:undefined,limit:Number(url.searchParams.get('limit')??40)}));}
    if(req.method==='GET'&&path==='/api/pool-team')return respond(res,200,await poolTeamDraft(url.searchParams.get('id')??''));
    if(req.method==='GET'&&path==='/api/backup')return respond(res,200,await createBackup());
    if(req.method==='POST'&&path==='/api/restore')return respond(res,200,await restoreBackup(await body(req)));
    if(req.method==='POST'&&path==='/api/samples')return respond(res,200,await addSamples());
    if(req.method==='GET'&&path==='/api/jobs')return respond(res,200,await jobHistory());
    if(req.method==='GET'&&path==='/api/coach-stats'){const ids=(url.searchParams.get('ids')??'').split(',');const games=await loadGames();return respond(res,200,coachStats(games.filter(g=>ids.includes(g.id))));}
    if(req.method==='POST'&&path==='/api/jobs'){const input=await body(req);return respond(res,202,await runJob(input.kind));}
    if(req.method==='POST'&&path==='/api/action'){
      const input=await body(req);if(!Number.isInteger(input.revision))throw new Error('Workspace revision required');
      if(input.action?.type==='match-save'){const games=await loadGames();const chosen=input.action.replayIds?.map((rid:string)=>games.find(g=>g.id===rid));if(!chosen?.every(Boolean)||new Set(chosen.map((g:any)=>g.players[g.ownSide==='p1'?'p2':'p1'].name)).size!==1||new Set(chosen.map((g:any)=>g.format)).size!==1)throw new Error('Choose games in one format against the same opponent');}
      const result=await mutateStore(input.revision,db=>applyAction(db,input.action));return respond(res,200,{revision:result.db.revision,result:result.result});
    }
    if(req.method==='POST'&&path==='/api/migrate-legacy'){const input=await body(req);const records=await legacyTeams();const result=await mutateStore(input.revision,db=>{for(const old of records){if(!db.teams.some(t=>t.name===old.id))makeTeam(db,old.id,exportText(old.sets,old.format),old.format);}return {imported:records.length};});return respond(res,200,{revision:result.db.revision,result:result.result});}
    if(req.method==='GET'&&path==='/api/legacy')return respond(res,200,await legacyTeams());
    if(req.method==='POST'&&path==='/api/associate'){
      const input=await body(req);if(!['family','exact','clear'].includes(input.certainty))throw new Error('Association certainty required');
      const result=await workflowLock(async()=>{
        const games=await loadGames();const game=games.find(g=>g.id===input.replayId);if(!game)throw new Error('Replay not found');
        const changed=await mutateStore(input.revision,db=>associateReplay(db,game,input));
        // Requeue exact-set changes for coaching. Preserve every original and historical report.
        if(storageRoot===ROOT&&(input.certainty==='exact'||game.teamVersion?.startsWith('config-'))){const index=await json('replays/index.json');const entry=index.games.find((g:any)=>g.id===game.id);entry.teamVersion=changed.db.associations[game.id]?.configurationId??null;entry.reviewedAt=null;entry.reviewPath=null;game.teamVersion=entry.teamVersion;await save(entry.parsed,game);await save('replays/index.json',index);}
        return changed;});
      if('status'in result)return respond(res,409,{error:result.reason});return respond(res,200,{revision:result.db.revision,result:result.result});
    }
    if(req.method==='POST'&&path==='/api/upload'){
      const input=await body(req);if(typeof input.html!=='string'||input.html.length>6_000_000)throw new Error('Expected replay HTML under 6 MB');
      const result=await saveReplay(input.html,input.association,input.revision);if('status'in result)return respond(res,409,{error:(result as any).reason});if(!(result as any).duplicate)void queueSummaries(input.association?.teamId,[(result as any).id]);return respond(res,200,result);
    }
    // Batch intake: Showdown replay links and/or HTML files, linked to one team version. Exact links fall back to
    // a version-level roster link (sets unconfirmed) when recorded moves contradict the saved sets.
    if(req.method==='POST'&&path==='/api/replays'){
      const input=await body(req);if(!Array.isArray(input.items)||!input.items.length||input.items.length>40)throw new Error('Send 1–40 replays');const results=[];
      for(const item of input.items){const label=item.url??item.name??'replay';
        try{const html=item.url?await showdownReplayHTML(item.url):item.html;if(typeof html!=='string'||html.length>6_000_000)throw new Error('Expected replay HTML under 6 MB');
          const revision=(await readStore()).revision;let association=input.association,note='';
          let r:any=await saveReplay(html,association,revision).catch(async e=>{if(association?.certainty!=='exact'||!/absent from this configuration|Roster does not match/.test(e.message))throw e;
            note=e.message;association={teamId:association.teamId,versionId:/Roster/.test(e.message)?undefined:association.versionId,certainty:'family'};return saveReplay(html,association,(await readStore()).revision);});
          if('status'in r)throw new Error(r.reason);results.push({label,ok:true,id:r.id,duplicate:!!r.duplicate,certainty:association?.certainty??'inbox',...note?{note}:{}});
        }catch(e){results.push({label,ok:false,error:(e as Error).message});}}
      // Each new game gets an AI summary in the background, then the team's "what to work on" digest is refreshed.
      const fresh:string[]=[];for(const r of results as any[])if(r.ok&&(!r.duplicate||!(await readSummary(r.id))))fresh.push(r.id);if(fresh.length)void queueSummaries(input.association?.teamId,fresh);
      return respond(res,200,{results});
    }
    if(req.method==='GET'&&path==='/api/replay-summaries'){const teamId=url.searchParams.get('team')??'';const db=await readStore();const summaries:Record<string,any>={};
      for(const [id,a] of Object.entries(db.associations))if(a.teamId===teamId){const s=await readSummary(id);if(s)summaries[id]={...s,stale:isStale(s,a)};}
      return respond(res,200,{summaries,digest:await readDigest(teamId),running:await runningFor(teamId)});}
    if(req.method==='GET'&&path==='/api/replay-transcript'){const game=await readGame(url.searchParams.get('id')??'');return respond(res,200,{transcript:transcript(game),turns:game.turns.length});}
    if(req.method==='POST'&&path==='/api/replay-summarise'){const input=await body(req);if(typeof input.teamId!=='string')throw new Error('teamId is required');
      const ids=Array.isArray(input.gameIds)?input.gameIds.filter((x:any)=>typeof x==='string').slice(0,40):[];void queueSummaries(input.teamId,ids);return respond(res,202,{queued:ids.length});}
    if(req.method==='GET'&&path==='/api/replay'){
      const replayId=url.searchParams.get('id');const index=await json('replays/index.json');const entry=index.games.find((g:any)=>g.id===replayId);if(!entry)throw new Error('Replay not found');const game=await json(entry.parsed);let report='';if(entry.reviewPath&&/^reports\/replay-reviews\/[a-zA-Z0-9/_-]+\.md$/.test(entry.reviewPath))report=await readText(dataPath(entry.reviewPath));
      const sections=report.split(/(?=^### )/m);const specific=sections.filter((s:string)=>s.includes(game.id));return respond(res,200,{game,coaching:specific.length?specific.join('\n'):report,reportPath:entry.reviewPath,association:(await readStore()).associations[game.id]??null});
    }
    if(req.method==='GET'&&path==='/api/export'){
      const db=await readStore();const team=db.teams.find(t=>t.id===url.searchParams.get('team'));if(!team)throw new Error('Team not found');return respond(res,200,{paste:teamPaste(db,team,url.searchParams.get('version')??undefined,url.searchParams.get('configuration')??undefined)});
    }
    if(req.method==='GET'&&path==='/api/report'){
      const file=url.searchParams.get('path')??'';if(!/^(reports|knowledge|teams|context)\/[a-zA-Z0-9/_.-]+\.md$/.test(file))throw new Error('Expected a local Markdown report');return respond(res,200,{text:await readText(dataPath(file))});
    }
    if(req.method==='GET'&&path==='/api/original'){
      const index=await json('replays/index.json');const entry=index.games.find((g:any)=>g.id===url.searchParams.get('id'));if(!entry)throw new Error('Replay not found');res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${entry.id}.html"`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});res.end(await readBytes(dataPath(entry.source)));return;
    }
    if(req.method==='GET'&&path==='/api/art'){
      const key=url.searchParams.get('id')??'';if(!/^[a-z0-9]+$/.test(key))throw new Error('Invalid artwork key');const manifest=await optionalJSON<any>('knowledge/artwork/manifest.json',{});const entry=manifest[key];if(entry?.state!=='cached')return respond(res,404,{error:'Illustrated artwork unavailable'});
      // Hosted: artwork isn't copied into the database; send the browser to the public source the cache came from.
      if(hostedMode&&typeof entry.url==='string'&&/^https:\/\/raw\.githubusercontent\.com\//.test(entry.url)){res.writeHead(302,{Location:entry.url,'Cache-Control':'public, max-age=86400'});res.end();return;}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(await readBytes(dataPath(entry.file)));return;
    }
    if(req.method==='GET'&&path==='/api/dex'){
      const species=dex.species.get(url.searchParams.get('species')??'');const all=dex.moves.all().filter((m:any)=>m.exists&&!m.isNonstandard);const moves=all.map((m:any)=>m.name);return respond(res,200,{statusMoves:all.filter((m:any)=>m.category==='Status').map((m:any)=>m.name),multiHit:Object.fromEntries(all.filter((m:any)=>Array.isArray(m.multihit)).map((m:any)=>[m.name,m.multihit])),contextMoves:Object.fromEntries(Object.entries(contextMoves).map(([k,v])=>[k,{field:v.field,label:v.label,max:v.max}])),species:species.exists?{name:species.name,types:species.types,abilities:Object.values(species.abilities),baseStats:species.baseStats,megas:(species.otherFormes??[]).map((f:string)=>dex.species.get(f)).filter((f:any)=>f.isMega&&f.requiredItem).map((f:any)=>({name:f.name,item:f.requiredItem,types:f.types,ability:Object.values(f.abilities)[0],baseStats:f.baseStats}))}:null,speciesNames:dex.species.all().filter((s:any)=>s.exists&&!s.isNonstandard).map((s:any)=>s.name),moves,natures:dex.natures.all().map((n:any)=>n.name),items:dex.items.all().filter((i:any)=>!i.isNonstandard).map((i:any)=>i.name),abilities:dex.abilities.all().filter((a:any)=>!a.isNonstandard).map((a:any)=>a.name)});
    }
    if(req.method==='GET'&&path==='/api/meta-sets'){const source=(url.searchParams.get('source')??'pokebase') as MetaSource;if(!['pool','pokebase','pokebase-ladder','vgcpastes','limitless','pikalytics','smogon'].includes(source))throw new Error('Unknown usage source');return respond(res,200,await metaSets(url.searchParams.get('species')??'',source,{refresh:url.searchParams.get('refresh')==='1'}));}
    // PokePaste is a paste host: read the raw export so teams can be imported from a link.
    if(req.method==='GET'&&path==='/api/pokepaste'){
      const link=new URL(url.searchParams.get('url')??'');if(link.hostname!=='pokepast.es')throw new Error('Use a pokepast.es link');const pasteId=link.pathname.split('/').filter(Boolean)[0];if(!/^[a-f0-9]{8,32}$/.test(pasteId??''))throw new Error('That does not look like a PokePaste link');
      const raw=await fetchText(`https://pokepast.es/${pasteId}/raw`,200_000);let meta:any={};try{meta=JSON.parse((await fetchText(`https://pokepast.es/${pasteId}/json`,200_000)).text);}catch{}
      return respond(res,200,{paste:raw.text,title:meta.title??'',author:meta.author??'',notes:meta.notes??'',source:`https://pokepast.es/${pasteId}`});
    }
    if(req.method==='POST'&&path==='/api/ai-jobs'){const input=await body(req);if(!['build','assist'].includes(input.area))throw new Error('Unknown assistant area');const job=startJob(input.area,input.messages,input.context??{});return respond(res,202,{id:job.id});}
    if(req.method==='GET'&&path==='/api/profile')return respond(res,200,await profile());
    if(req.method==='POST'&&path==='/api/profile'){const input=await body(req);const current=await optionalJSON<any>('config.json',{});
      const player=typeof input.player==='string'?input.player.trim().slice(0,30):current.player;const aliases=Array.isArray(input.aliases)?input.aliases.filter((a:any)=>typeof a==='string'&&a.trim()).map((a:string)=>a.trim().slice(0,30)).slice(0,10):current.aliases;
      await save('config.json',{...current,player,aliases});return respond(res,200,await profile());}
    if(req.method==='GET'&&path==='/api/settings')return respond(res,200,{models:await modelSettings()});
    if(req.method==='POST'&&path==='/api/settings'){const input=await body(req);return respond(res,200,{models:await saveModelSettings(input.models)});}
    if(req.method==='GET'&&path==='/api/models')return respond(res,200,await availableModels());
    if(req.method==='GET'&&path==='/api/ai-jobs'){const jobsList=await listJobs();return respond(res,200,jobsList.map(j=>({...j,tools:undefined})));}
    if(req.method==='GET'&&path==='/api/ai-job'){const job=await getJob(url.searchParams.get('id')??'');if(!job)return respond(res,404,{error:'Job not found'});return respond(res,200,job);}
    if(req.method==='POST'&&path==='/api/ai-job-cancel'){const input=await body(req);return respond(res,200,await cancelJob(input.id));}
    if(req.method==='POST'&&path==='/api/ai-job-dismiss'){const input=await body(req);return respond(res,200,await dismissJob(input.id));}
    if(req.method==='GET'&&path==='/api/typical-set'){return respond(res,200,await typicalSet(url.searchParams.get('species')??'',(url.searchParams.get('avoid')??'').split('|').filter(Boolean)));}
    // Species picker: every legal Champions species, the pool's most used first.
    if(req.method==='GET'&&path==='/api/species-options'){const teams=await poolTeams();const counts=new Map<string,number>();for(const t of teams)for(const p of new Set(t.pokemon.map(x=>dex.species.get(x).baseSpecies)))counts.set(p,(counts.get(p)??0)+1);
      const names=dex.species.all().filter((s:any)=>s.exists&&!s.isNonstandard&&!s.battleOnly&&!/-Mega/.test(s.name)).map((s:any)=>s.name);
      const icons=await iconIndex().catch(e=>{console.error('Box icons unavailable:',e.message);return null;});
      return respond(res,200,names.map((n:string)=>({name:n,usage:teams.length?Math.round(1000*(counts.get(dex.species.get(n).baseSpecies)??0)/teams.length)/10:0,...icons?{icon:iconNumber(n,icons)}:{}})).sort((a:any,b:any)=>b.usage-a.usage||a.name.localeCompare(b.name)));}
    if(req.method==='GET'&&path==='/api/icon-sheet'){await iconIndex();res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=604800','X-Content-Type-Options':'nosniff'});res.end(await iconSheet());return;}
    if(req.method==='GET'&&path==='/api/pool'){const status=await poolStatus();return respond(res,200,{status,overview:status?await poolOverview({top:20}):null,refreshing:poolRefreshing});}
    if(req.method==='POST'&&path==='/api/pool-refresh'){startPoolRefresh();return respond(res,202,{refreshing:true});}
    if(req.method==='POST'&&path==='/api/calculate'){const input=await body(req);const methods:Record<string,(i:any)=>unknown>={stats:finalStats,damage,speed,spread:spreadSearch};if(!methods[input.kind])throw new Error('Unknown calculation');return respond(res,200,methods[input.kind](input.input));}
    return respond(res,404,{error:'Not found'});
  }catch(e){return respond(res,e instanceof Conflict?409:400,{error:(e as Error).message});}
};}
// The team pool refreshes in the background: on start if older than 12 h, then every 12 h, or on request.
let poolRefreshing=false;
function startPoolRefresh(){if(poolRefreshing)return;poolRefreshing=true;refreshPool({log:()=>{}}).catch(e=>console.error('Pool refresh failed:',e.message)).finally(()=>{poolRefreshing=false;});}
async function schedulePool(){const s=await poolStatus().catch(()=>null);if(!s||Date.now()-Date.parse(s.refreshedAt)>12*3600_000)startPoolRefresh();setInterval(startPoolRefresh,12*3600_000).unref();}
export const handler=createWorkbenchHandler();
// Hosted mode (SUPABASE_URL and a publishable key in the environment): every request is a signed-in or guest user.
export function startServer(){
  try{process.loadEnvFile(resolve(CODE,'.env'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const cloud=hostedConfig();if(!cloud)void schedulePool();
  const server=createServer(cloud?hostedHandler(cloud,createWorkbenchHandler(ROOT,API_PORT,{hostedMode:true})):handler);
  server.listen(API_PORT,'127.0.0.1',()=>console.log(`VGC ${cloud?'hosted-mode (Supabase)':'local'} API http://127.0.0.1:${API_PORT}`));server.requestTimeout=30000;return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
