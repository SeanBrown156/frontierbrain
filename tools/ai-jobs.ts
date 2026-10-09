// Every "Ask AI" request runs as a background job inside the local API, so the player can keep working (or leave the
// page) while the model researches. The UI polls job status; finished jobs persist in reports/ai-jobs/.
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {optionalJSON,save,listDir} from './io.ts';
import {assist,type Area} from './assist.ts';
import type {ChatTurn,ChatContext} from './chat.ts';

export interface AiJob {id:string;area:Area|'replay-summary'|'team-digest';context:ChatContext;messages:ChatTurn[];title:string;status:'running'|'done'|'failed'|'interrupted'|'cancelled';startedAt:string;finishedAt?:string;
  steps:{name:string;input?:any;error?:string}[];result?:{reply:string;proposals:any[]};tools?:any[];error?:string;dismissed?:boolean;model?:string;modelNote?:string;}
const jobs=new Map<string,AiJob>();const controllers=new Map<string,AbortController>();const DIR='reports/ai-jobs';
const persist=(job:AiJob)=>save(`${DIR}/${job.id}.json`,job);
// Any background AI task: progress steps, a result, cancel. Assist chats and replay summaries both use it.
type Runner=(emit:(event:any,data:any)=>void,signal:AbortSignal)=>Promise<{value:any;tools?:any[];model?:string;modelNote?:string}>;
export function startTask(area:AiJob['area'],title:string,context:ChatContext,messages:ChatTurn[],run:Runner):AiJob{
  const job:AiJob={id:randomUUID(),area,context,messages,title:title.slice(0,140),status:'running',startedAt:new Date().toISOString(),steps:[]};jobs.set(job.id,job);void persist(job);const controller=new AbortController();controllers.set(job.id,controller);
  run((event,data:any)=>{if(event==='tool')job.steps.push({name:data.name,input:summary(data),error:data.error});},controller.signal)
    .then(r=>{job.status='done';job.result=r.value;job.tools=r.tools;job.model=r.model;job.modelNote=r.modelNote;})
    .catch(e=>{if(job.status==='cancelled')return;job.status='failed';job.error=(e as Error).message;})
    .finally(()=>{controllers.delete(job.id);job.finishedAt??=new Date().toISOString();void persist(job);});
  return job;
}
export function startJob(area:Area,messages:ChatTurn[],context:ChatContext={}):AiJob{
  const last=[...messages].reverse().find(m=>m.role==='user')?.content??'';
  return startTask(area,last,context,messages,(emit,signal)=>assist(area,messages,context,emit,{signal}));
}
// Short labels for progress lists; full tool inputs stay in the finished job's tools.
function summary(d:any){const i=d.input??{};return i.species??i.move??(i.attacker?`${i.attacker.species} → ${i.defender?.species}`:undefined)??(i.a?`${i.a.species} vs ${i.b?.species}`:undefined)??(i.attempt?`attempt ${i.attempt}`:undefined);}
export async function listJobs(limit=30){
  const files=await listDir(DIR);
  for(const f of files.filter(f=>f.endsWith('.json'))){const id=f.slice(0,-5);if(jobs.has(id))continue;const j=await optionalJSON<AiJob|null>(`${DIR}/${f}`,null);if(!j)continue;if(j.status==='running'){j.status='interrupted';j.error='The local API restarted while this was running. Ask again.';}jobs.set(id,j);}
  return [...jobs.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,limit);
}
export async function getJob(id:string){await listJobs(200);return jobs.get(id)??null;}
export async function dismissJob(id:string){const j=await getJob(id);if(!j)throw new Error('Job not found');j.dismissed=true;await persist(j);return j;}
export async function cancelJob(id:string){const j=await getJob(id);if(!j)throw new Error('Job not found');if(j.status!=='running')return j;j.status='cancelled';j.error='Cancelled.';j.finishedAt=new Date().toISOString();controllers.get(id)?.abort();await persist(j);return j;}
