import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readStore} from './workbench-store.ts';
import {refreshResearch} from './research.ts';
import {ingest} from './replays.ts';
import {cacheArtwork,backfillUsage,refreshEvents,usageHistory} from './workbench-data.ts';
import {scheduledRun} from './scheduled-run.ts';
import {workflowLock} from './workbench-jobs.ts';
import {save} from './io.ts';

export const jobKinds=['usage','ingest','artwork','daily','weekly'];
export async function executeWorkflow(kind:string,jobId:string){
  if(!jobKinds.includes(kind)||!/^[a-f0-9-]{36}$/.test(jobId))throw new Error('Invalid workflow');
  const path=`reports/runs/ui-${jobId}.json`;const job:any={id:jobId,kind,status:'running',startedAt:new Date().toISOString(),pid:process.pid,phase:'Preparing workspace'};await save(path,job);
  const phase=async(text:string)=>{job.phase=text;await save(path,job);};
  try{let result:any;
    if(kind==='daily'||kind==='weekly'){await phase(kind==='daily'?'Refreshing the pool and replay reports':'Refreshing sources, events and usage history');result=await scheduledRun(kind);}
    else result=await workflowLock(async()=>{if(kind==='ingest'){await phase('Parsing local HTML');return ingest();}if(kind==='usage'){await phase('Fetching source checks and published usage');const latest=await refreshResearch();await phase('Checking comparable history and events');return {latest,history:await backfillUsage(),events:await refreshEvents()};}
      await phase('Caching official illustrated artwork');const db=await readStore();const usage=await usageHistory();return cacheArtwork([...db.bank.flatMap(b=>b.revisions.map(r=>r.set.species)),...usage.flatMap(s=>s.rows.map((r:any)=>r.species))]);});
    job.result=result;job.status=result.status==='failed'?'failed':result.status==='partial'?'partial':result.status==='skipped'?'skipped':kind==='usage'&&(result.latest.errors.length||result.events.errors.length)||kind==='ingest'&&result.errors.length||kind==='artwork'&&result.missing.length?'partial':'complete';job.phase=result.status==='no-new-games'?'No pending games':job.status==='skipped'?result.reason:'Finished';
  }catch(e){job.status='failed';job.error=(e as Error).message;job.phase='Failed';}finally{job.finishedAt=new Date().toISOString();await save(path,job);}return job;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))executeWorkflow(process.argv[2],process.argv[3]).then(job=>{process.exitCode=job.status==='failed'?1:0;}).catch(e=>{console.error(e.message);process.exitCode=1;});
