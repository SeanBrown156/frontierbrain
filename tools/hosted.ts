// Hosted mode: every API request belongs to a Supabase user (a signed-in account or an anonymous guest).
// The user's workspace is one row in `workspaces` (revision-checked, like the local store); their other files
// (replays, summaries, settings, profile) are rows in `user_files`. Shared reference data under knowledge/
// (the tournament pool, cached usage pages, icon sheet) lives in `shared_files`, readable by everyone and written
// only with the server's secret key. Row-level security keys every user row on auth.uid(), and user requests
// use the caller's own access token, so one user can never read another's data.
import type {IncomingMessage,ServerResponse} from 'node:http';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {CODE,fileBackend,withData,type DataBackend} from './io.ts';
import {emptyStore,validateStoreReferences,Conflict,type StoreBackend} from './workbench-store.ts';
import type {Workbench} from '../shared/workbench.ts';

export interface HostedConfig {url:string;publishableKey:string;secretKey?:string}
export function hostedConfig(env=process.env):HostedConfig|null{
  const url=env.SUPABASE_URL??env.VITE_SUPABASE_URL,publishableKey=env.SUPABASE_PUBLISHABLE_KEY??env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return url&&publishableKey?{url,publishableKey,secretKey:env.SUPABASE_SECRET_KEY}:null;
}
const noSession={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
// Small files are stored as text; anything over 256 KB is gzip-compressed (the 19 MB pool becomes ~1.5 MB).
const asBuffer=(row:{body:string;encoding:string})=>row.encoding==='gzip'?gunzipSync(Buffer.from(row.body,'base64')):Buffer.from(row.body,row.encoding==='base64'?'base64':'utf8');
const encode=(data:string|Buffer)=>{const bytes=typeof data==='string'?Buffer.from(data):data;if(bytes.length>256*1024)return {body:gzipSync(bytes).toString('base64'),encoding:'gzip'};return typeof data==='string'?{body:data,encoding:'utf8'}:{body:data.toString('base64'),encoding:'base64'};};
const children=(dir:string,paths:string[])=>{const prefix=dir.replace(/\/$/,'')+'/';return [...new Set(paths.filter(p=>p.startsWith(prefix)).map(p=>p.slice(prefix.length).split('/')[0]).filter(Boolean))].sort();};
function check<T>(r:{data:T;error:any}):T{if(r.error)throw new Error(`Storage error: ${r.error.message}`);return r.data;}

export function userFiles(client:SupabaseClient,userId:string):DataBackend{
  return {
    async read(path){const row=check(await client.from('user_files').select('body,encoding').eq('user_id',userId).eq('path',path).maybeSingle());return row?asBuffer(row as any):null;},
    async write(path,data){check(await client.from('user_files').upsert({user_id:userId,path,...encode(data),updated_at:new Date().toISOString()}));},
    async list(dir){const rows=check(await client.from('user_files').select('path').eq('user_id',userId).like('path',dir.replace(/\/$/,'')+'/%'));return children(dir,(rows??[]).map((r:any)=>r.path));},
    async modified(path){const row:any=check(await client.from('user_files').select('updated_at').eq('user_id',userId).eq('path',path).maybeSingle());return row?Date.parse(row.updated_at):null;},
    async remove(path){check(await client.from('user_files').delete().eq('user_id',userId).eq('path',path));},
  };
}
// Shared rows first, then files shipped with the code (knowledge/mechanics, regulations, sources). Reads are
// cached briefly per server instance; the pool file is large and read on most pages.
const sharedCache=new Map<string,{at:number;value:Buffer|null}>();
export function sharedFiles(reader:SupabaseClient,writer:SupabaseClient|null):DataBackend{
  const shipped=fileBackend(CODE);
  return {
    async read(path){const hit=sharedCache.get(path);if(hit&&Date.now()-hit.at<10*60_000)return hit.value;
      const row=check(await reader.from('shared_files').select('body,encoding').eq('path',path).maybeSingle());const value=row?asBuffer(row as any):await shipped.read(path);sharedCache.set(path,{at:Date.now(),value});return value;},
    async write(path,data){sharedCache.delete(path);if(!writer)return; // without the secret key, caching shared pages is skipped
      check(await writer.from('shared_files').upsert({path,...encode(data),updated_at:new Date().toISOString()}));},
    async list(dir){const rows=check(await reader.from('shared_files').select('path').like('path',dir.replace(/\/$/,'')+'/%'));return [...new Set([...children(dir,(rows??[]).map((r:any)=>r.path)),...await shipped.list(dir)])].sort();},
    async modified(path){const row:any=check(await reader.from('shared_files').select('updated_at').eq('path',path).maybeSingle());return row?Date.parse(row.updated_at):shipped.modified(path);},
    async remove(path){sharedCache.delete(path);if(writer)check(await writer.from('shared_files').delete().eq('path',path));},
  };
}
// One row per user. A save names the revision it started from; zero rows updated means someone else saved first.
export function workspaceStore(client:SupabaseClient,userId:string):StoreBackend{
  const load=async()=>{const row:any=check(await client.from('workspaces').select('revision,data').eq('user_id',userId).maybeSingle());return row?{...(row.data as Workbench),revision:row.revision}:null;};
  return {
    async read(){return await load()??emptyStore();},
    async mutate(revision,fn){
      const current=await load();const db=current??emptyStore();if(db.revision!==revision)throw new Conflict('Workspace changed since you opened it. Reload before saving.');
      const result=await fn(db);validateStoreReferences(db);db.revision=revision+1;const {revision:next,...data}=db as any;
      if(current){const rows=check(await client.from('workspaces').update({revision:next,data,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('revision',revision).select('revision'));if(!rows?.length)throw new Conflict('Workspace changed since you opened it. Reload before saving.');}
      else{const r=await client.from('workspaces').insert({user_id:userId,revision:next,data});if(r.error){if(r.error.code==='23505')throw new Conflict('Workspace changed since you opened it. Reload before saving.');throw new Error(`Storage error: ${r.error.message}`);}}
      return {db,result:result as any};
    },
  };
}
// Routes that only make sense on one person's machine (background workers, local report files, legacy imports).
const LOCAL_ONLY=new Set(['/api/jobs','/api/legacy','/api/migrate-legacy','/api/pool-refresh']);
// Loaded by <img>/CSS without an Authorization header; they serve shared data only.
const PUBLIC=new Set(['/api/icon-sheet','/api/art']);
// AI features need an account (guests are anonymous users). A guest's AI key header is dropped everywhere else too.
const AI=new Set(['/api/ai-jobs','/api/replay-summarise','/api/models']);
export function hostedHandler(config:HostedConfig,inner:(req:IncomingMessage,res:ServerResponse)=>unknown){
  const auth=createClient(config.url,config.publishableKey,noSession);
  const reader=auth;const writer=config.secretKey?createClient(config.url,config.secretKey,noSession):null;const shared=sharedFiles(reader,writer);
  const deny=(res:ServerResponse,status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error}));};
  return async(req:IncomingMessage,res:ServerResponse)=>{
    const path=new URL(req.url??'/','http://x').pathname;
    // MCP discovery (RFC 9728): the connector endpoint names Supabase Auth as its OAuth server.
    const origin=`${req.headers['x-forwarded-proto']??(/^(127\.0\.0\.1|localhost)/.test(req.headers.host??'')?'http':'https')}://${req.headers['x-forwarded-host']??req.headers.host}`;
    if(path.startsWith('/.well-known/oauth-protected-resource')){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify({resource:`${origin}/api/mcp`,authorization_servers:[`${config.url}/auth/v1`],bearer_methods_supported:['header'],resource_name:'Frontier Brain'}));return;}
    if(LOCAL_ONLY.has(path)&&!(path==='/api/jobs'&&req.method==='GET'))return deny(res,404,'Not available on the hosted site');
    const token=/^Bearer (.+)$/.exec(req.headers.authorization??'')?.[1];
    if(!token&&path==='/api/mcp'){res.writeHead(401,{'Content-Type':'application/json','WWW-Authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`});res.end(JSON.stringify({error:'Connect your Frontier Brain account to use this connector.'}));return;}
    if(!token){if(!PUBLIC.has(path))return deny(res,401,'Sign in or continue as a guest');return withData({user:nobody,shared,hosted:true},()=>inner(req,res));}
    const {data,error}=await auth.auth.getClaims(token);const userId=data?.claims?.sub;
    if(error||!userId)return deny(res,401,'Your session has expired. Sign in again.');
    if(data.claims.is_anonymous&&path==='/api/mcp')return deny(res,403,'Connectors need a free Frontier Brain account. Sign in on the site first.');
    if(data.claims.is_anonymous){if(AI.has(path)&&req.method==='POST'||path==='/api/models')return deny(res,403,'Sign in to use AI features. Your guest work is kept.');delete req.headers['x-ai-key'];}
    const client=createClient(config.url,config.publishableKey,{...noSession,global:{headers:{Authorization:`Bearer ${token}`}}});
    return withData({user:userFiles(client,userId),shared,store:workspaceStore(client,userId),userId,hosted:true},()=>inner(req,res));
  };
}
const nobody:DataBackend={async read(){return null;},async write(){throw new Error('Sign in or continue as a guest');},async list(){return [];},async modified(){return null;},async remove(){}};
