import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT,hosted} from './io.ts';
export async function workflowLock<T>(fn:()=>Promise<T>):Promise<T|{status:'skipped';reason:string}>{
  if(hosted())return fn(); // hosted: each user's writes are revision-checked rows; no machine-wide lock
  const lock=resolve(ROOT,'.cache/scheduled.lock');await mkdir(resolve(ROOT,'.cache'),{recursive:true});
  try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    try{const pid=Number(await readFile(resolve(lock,'pid'),'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error('Invalid owner');process.kill(pid,0);return {status:'skipped',reason:'Another workflow is active'};}
    catch(err){if((err as NodeJS.ErrnoException).code!=='ESRCH')return {status:'skipped',reason:'Lock owner unknown; inspect .cache/scheduled.lock'};await rm(lock,{recursive:true});try{await mkdir(lock);}catch{return {status:'skipped',reason:'Another workflow acquired the lock'};}}
  }
  await writeFile(resolve(lock,'pid'),String(process.pid));try{return await fn();}finally{await rm(lock,{recursive:true});}
}
