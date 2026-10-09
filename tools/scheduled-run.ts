import {refreshPool} from './pool.ts';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {save,stamp} from './io.ts';
import {replayReports} from './replays.ts';
import {weeklyReport} from './research.ts';
import {workflowLock} from './workbench-jobs.ts';
import {refreshEvents,backfillUsage} from './workbench-data.ts';

// Deterministic daily/weekly preparation: refresh data and write replay/metagame reports. No AI runs here;
// scheduled coaching is done by the user's own agent (for example a Claude routine) reading these outputs.
export async function scheduledRun(kind:string){
  if(!['daily','weekly'].includes(kind))throw new Error('Expected daily or weekly');
  return workflowLock(async()=>{
    const runPath=`reports/runs/${kind}-${stamp()}-scheduled.json`;const record:any={kind,startedAt:new Date().toISOString(),status:'running'};await save(runPath,record);
    try{
      if(kind==='daily'){try{record.pool=(await refreshPool({log:()=>{}}) as any).counts;}catch(e){record.poolError=(e as Error).message;}}
      record.preparation=kind==='daily'?await replayReports():{...await weeklyReport(),events:await refreshEvents(),history:await backfillUsage()};
      record.status='complete';return record;
    }catch(e){record.status='failed';record.error=(e as Error).message;throw e;}
    finally{record.finishedAt=new Date().toISOString();await save(runPath,record);}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))scheduledRun(process.argv[2]).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
