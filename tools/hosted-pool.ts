// Restore the last published pool independently of runner caches, and verify both hosted representations.
// APP_DATA must point at the refresh workspace, never a player's data directory.
// node --env-file=.env.hosted tools/hosted-pool.ts restore|verify
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {gunzipSync,gzipSync} from 'node:zlib';
import {readText,save} from './io.ts';
import type {PoolTeam} from './pool.ts';

const TEAMS='knowledge/pool/teams.json',STATUS='knowledge/pool/status.json';
export function validatePublishedPool(pool:any,status:any):asserts pool is {refreshedAt:string;teams:PoolTeam[]}{
  if(!pool||!Number.isFinite(Date.parse(pool.refreshedAt))||!Array.isArray(pool.teams)||!pool.teams.length)
    throw new Error('Hosted pool is missing or invalid; refusing to use an incomplete baseline');
  if(status?.refreshedAt!==pool.refreshedAt||status?.counts?.total!==pool.teams.length)
    throw new Error('Hosted pool files disagree on timestamp or team count');
  if(new Set(pool.teams.map((t:any)=>t.id)).size!==pool.teams.length)
    throw new Error('Hosted pool contains duplicate team IDs');
}
async function published(db:SupabaseClient){
  const {data,error}=await db.from('shared_files').select('path,body,encoding').in('path',[TEAMS,STATUS]);
  if(error)throw new Error(`Read hosted pool: ${error.message}`);
  const files=new Map((data??[]).map(row=>[row.path,row.encoding==='gzip'?gunzipSync(Buffer.from(row.body,'base64')).toString('utf8'):Buffer.from(row.body,row.encoding==='base64'?'base64':'utf8').toString('utf8')]));
  const pool=JSON.parse(files.get(TEAMS)??'null'),status=JSON.parse(files.get(STATUS)??'null');
  validatePublishedPool(pool,status);return {pool,status,files};
}
export async function restoreHostedPool(db:SupabaseClient){
  const {pool,status}=await published(db);
  await save(TEAMS,pool);await save(STATUS,status);
  console.log(`Restored published pool: ${pool.teams.length} teams, refreshed ${pool.refreshedAt}`);
}
export async function seedHostedPool(db:SupabaseClient){
  const teams=await readText(TEAMS),status=await readText(STATUS);
  const parsed=JSON.parse(status);validatePublishedPool(JSON.parse(teams),parsed);
  if(parsed.errors?.length)throw new Error('Refusing to seed a pool with source errors');
  // One upsert publishes both rows atomically. Interrupted seeding must not leave a baseline whose
  // teams and status disagree and prevent the next run from restoring it.
  const rows=[[TEAMS,teams],[STATUS,status]].map(([path,body])=>({path,updated_at:new Date().toISOString(),
    ...(Buffer.byteLength(body)>256*1024?{body:gzipSync(Buffer.from(body)).toString('base64'),encoding:'gzip'}:{body,encoding:'utf8'})}));
  const {error}=await db.from('shared_files').upsert(rows);
  if(error)throw new Error(`Seed pool files: ${error.message}`);
}
export async function verifyHostedPool(db:SupabaseClient){
  const {pool,files}=await published(db);
  for(const path of [TEAMS,STATUS])if(files.get(path)!==await readText(path))throw new Error(`Hosted ${path} differs from the refreshed file`);
  const {data,error}=await db.from('pool_snapshots').select('refreshed_at,loaded_at,counts').not('loaded_at','is',null).order('loaded_at',{ascending:false}).limit(1);
  if(error)throw new Error(`Read pool snapshot: ${error.message}`);
  const snapshot=data?.[0];
  if(!snapshot||Date.parse(snapshot.refreshed_at)!==Date.parse(pool.refreshedAt)||snapshot.counts?.teams!==pool.teams.length)
    throw new Error('Hosted pool tables and files disagree');
  for(const [table,key] of [['pool_teams','teams'],['pool_team_members','members'],['pool_sets','sets'],['pool_events','events'],['pool_players','players']]){
    const {count,error}=await db.from(table).select('*',{count:'exact',head:true});
    if(error)throw new Error(`${table}: ${error.message}`);
    if(count!==snapshot.counts[key])throw new Error(`${table}: expected ${snapshot.counts[key]} rows, found ${count}`);
  }
  console.log(`Verified hosted pool: ${pool.teams.length} teams, refreshed ${pool.refreshedAt}, loaded ${snapshot.loaded_at}; files and all table counts match`);
}
if(import.meta.main){
  const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY are required');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  if(process.argv[2]==='restore')await restoreHostedPool(db);
  else if(process.argv[2]==='verify')await verifyHostedPool(db);
  else throw new Error('Expected restore or verify');
}
