// Replay intake and removal, shared by the HTTP API and the MCP connector so both behave the same.
// Replay HTML and logs are data: they are parsed, never executed, and only replay.pokemonshowdown.com links are fetched.
import {ROOT,json,save,hash,removeFile,config as profile} from './io.ts';
import {readStore,mutateLatest,applyAction,associateReplay} from './workbench-store.ts';
import {parseReplay,addReplay,deleteReplays} from './replays.ts';
import {workflowLock} from './workbench-jobs.ts';
import {showdownReplayHTML} from './replay-links.ts';
import {readSummary,pruneDigest} from './replay-summary.ts';

export const MAX_REPLAY_HTML=6_000_000;
// Parse, store the original, and link it to a team when an association is given (see tools/replay-link.ts for 'auto').
export async function saveReplay(html:string,associationInput:any,storageRoot=ROOT){
  const config=await profile();const parsed=parseReplay(html,'upload',config.player,config.aliases);
  return workflowLock(async()=>{
    if(associationInput)associateReplay(await readStore(storageRoot),parsed,associationInput);
    const saved=await addReplay(html,`${parsed.id}-${hash(html).slice(0,12)}.html`);parsed.id=saved.id;const outcome:any=saved.duplicate?{duplicate:true,id:saved.id}:{added:saved.added,id:saved.id};
    if(associationInput){
      const changed=await mutateLatest(db=>associateReplay(db,parsed,associationInput),storageRoot);
      if(storageRoot===ROOT){const latest=await json('replays/index.json');const entry=latest.games.find((g:any)=>g.logHash===parsed.logHash);entry.teamVersion=changed.db.associations[parsed.id]?.configurationId??null;entry.reviewedAt=null;entry.reviewPath=null;const g=await json(entry.parsed);g.teamVersion=entry.teamVersion;await save(entry.parsed,g);await save('replays/index.json',latest);}
    }
    return outcome;
  });
}
export interface IntakeItem {url?:string;html?:string;name?:string}
export interface IntakeResult {label:string;ok:boolean;id?:string;duplicate?:boolean;certainty?:string;basis?:string;note?:string;error?:string}
// Batch intake: Showdown replay links and/or HTML. By default each replay is linked automatically
// (tools/replay-link.ts): the team whose six it matches, at the edit current when it was played. Explicit exact
// links fall back to a roster link (sets unconfirmed) when recorded moves contradict the saved sets.
// Returns the per-item results and the ids that are new (or still lack a summary) and so need one.
export async function intakeReplays(items:IntakeItem[],association:any,storageRoot=ROOT,fetchHTML:(url:string)=>Promise<string>=showdownReplayHTML){
  const results:IntakeResult[]=[];
  for(const item of items){const label=item.url??item.name??'replay';
    try{const html=item.url?await fetchHTML(item.url):item.html;if(typeof html!=='string'||html.length>MAX_REPLAY_HTML)throw new Error('Expected replay HTML under 6 MB');
      let assoc=association??{certainty:'auto'},note='';
      const r:any=await saveReplay(html,assoc,storageRoot).catch(async e=>{if(assoc?.certainty!=='exact'||!/absent from this configuration|Roster does not match/.test(e.message))throw e;
        note=e.message;assoc={teamId:assoc.teamId,versionId:/Roster/.test(e.message)?undefined:assoc.versionId,certainty:'family'};return saveReplay(html,assoc,storageRoot);});
      if('status'in r)throw new Error(r.reason);const link=(await readStore(storageRoot)).associations[r.id];
      results.push({label,ok:true,id:r.id,duplicate:!!r.duplicate,certainty:link?.certainty??'inbox',basis:link?.basis,...note||link?.note?{note:note||link?.note}:{}});
    }catch(e){results.push({label,ok:false,error:(e as Error).message});}}
  const fresh:string[]=[];for(const r of results)if(r.ok&&(!r.duplicate||!(await readSummary(r.id!))))fresh.push(r.id!);
  return {results,fresh};
}
// Remove one replay: its link (and any saved match it was in), the original, the parsed copy and its summary, then
// bring the team's debrief back in line with the games that remain. Other replays are untouched.
export async function removeReplay(replayId:string,storageRoot=ROOT){
  const index=await json<any>('replays/index.json').catch(()=>({games:[]}));const entry=index.games.find((g:any)=>g.id===replayId);
  if(!entry)throw new Error('Replay not found: use an id from list_replays.');
  const r=await mutateLatest(db=>applyAction(db,{type:'replay-delete',replayId} as any),storageRoot);const out:any=r.result;
  const files=await deleteReplays([replayId]);
  const digest=out.teamId?await pruneDigest(out.teamId,replayId):'none';
  return {id:replayId,teamId:out.teamId??null,wasLinked:!!out.teamId,matchesRemoved:out.matchesRemoved,filesRemoved:files,digest};
}
