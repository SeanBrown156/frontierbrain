import {readFile, writeFile, mkdir, rename, readdir, stat, rm} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {AsyncLocalStorage} from 'node:async_hooks';

// CODE is this repository. ROOT is the data directory: APP_DATA (from the environment or CODE/.env) when set,
// otherwise the repository itself. Reads fall back to CODE so shipped reference files (knowledge/mechanics,
// knowledge/regulations, knowledge/sources) work from any data directory; writes always go to ROOT.
// The repository root: the nearest folder with package.json above this module (tools/ when run from source,
// build/api/ when bundled for Vercel).
export const CODE = (()=>{let dir=dirname(fileURLToPath(import.meta.url));while(!existsSync(resolve(dir,'package.json'))){const up=dirname(dir);if(up===dir)return resolve(dirname(fileURLToPath(import.meta.url)),'..');dir=up;}return dir;})();
// Only APP_DATA is read here; API keys stay unloaded until a feature asks for them.
if(!process.env.APP_DATA){try{const value=parseEnv(readFileSync(resolve(CODE,'.env'),'utf8')).APP_DATA;if(value)process.env.APP_DATA=value;}catch{}}
export const ROOT = process.env.APP_DATA ? resolve(CODE,process.env.APP_DATA) : CODE;
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export const id = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export function localDay() { return new Intl.DateTimeFormat('en-CA', {timeZone:process.env.APP_TIMEZONE||undefined,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }

// Where data paths live. Locally everything is files under ROOT. On the hosted site each request runs inside
// withData(): the signed-in (or guest) user's paths go to their own rows, and knowledge/ (shared reference data
// such as the tournament pool) goes to a shared, read-mostly store. Paths are always relative ("teams/x.json").
export interface DataBackend {
  read(path:string):Promise<Buffer|null>;
  write(path:string,data:string|Buffer):Promise<void>;
  list(dir:string):Promise<string[]>;            // immediate children (file and folder names); [] when missing
  modified(path:string):Promise<number|null>;    // ms since epoch, null when missing
  remove(path:string):Promise<void>;
}
export function fileBackend(root:string,fallback?:string):DataBackend{
  const missing=(e:unknown)=>['ENOENT','ENOTDIR'].includes((e as NodeJS.ErrnoException).code??'');
  return {
    async read(path){try{return await readFile(resolve(root,path));}catch(e){if(!missing(e))throw e;if(!fallback||fallback===root)return null;try{return await readFile(resolve(fallback,path));}catch(err){if(missing(err))return null;throw err;}}},
    async write(path,data){const target=resolve(root,path);await mkdir(dirname(target),{recursive:true});const tmp=`${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;await writeFile(tmp,data);await rename(tmp,target);},
    async list(dir){try{return await readdir(resolve(root,dir));}catch(e){if(missing(e))return [];throw e;}},
    async modified(path){try{return (await stat(resolve(root,path))).mtimeMs;}catch(e){if(missing(e))return null;throw e;}},
    async remove(path){await rm(resolve(root,path),{force:true});},
  };
}
// The caller's own AI key (sent per request from their browser; never stored on the server).
export type AIProvider='openai'|'anthropic';
export interface AICredentials {provider:AIProvider;key:string}
export interface DataContext {user:DataBackend;shared:DataBackend;userId?:string;store?:import('./workbench-store.ts').StoreBackend;hosted?:boolean;ai?:AICredentials}
const local:DataContext={user:fileBackend(ROOT,CODE),shared:fileBackend(ROOT,CODE)};
const scope=new AsyncLocalStorage<DataContext>();
export const withData=<T>(context:DataContext,fn:()=>T)=>scope.run(context,fn);
export const dataContext=()=>scope.getStore()??local;
export const hosted=()=>!!scope.getStore()?.hosted;
export const requestAI=()=>scope.getStore()?.ai??null;
// Local mode only: keys from the environment (.env). The hosted site never uses server keys for users' AI.
export function environmentAI(root=CODE):AICredentials|null{
  if(hosted())return null;if(!process.env.OPENAI_API_KEY&&!process.env.ANTHROPIC_API_KEY){try{process.loadEnvFile(resolve(root,'.env'));}catch{}}
  if(process.env.OPENAI_API_KEY)return {provider:'openai',key:process.env.OPENAI_API_KEY};if(process.env.ANTHROPIC_API_KEY)return {provider:'anthropic',key:process.env.ANTHROPIC_API_KEY};return null;
}
export const activeAI=(root=CODE)=>requestAI()??environmentAI(root);
const backendFor=(path:string)=>{const c=dataContext();return path.startsWith('knowledge/')?c.shared:c.user;};
const notFound=(path:string)=>Object.assign(new Error(`ENOENT: no such file, open '${path}'`),{code:'ENOENT'});

export async function readBytes(path:string):Promise<Buffer>{const b=await backendFor(path).read(path);if(!b)throw notFound(path);return b;}
export async function readText(path: string): Promise<string> {return (await readBytes(path)).toString('utf8');}
export async function json<T = any>(path: string): Promise<T> {return JSON.parse(await readText(path));}
export async function optionalJSON<T>(path: string, fallback: T): Promise<T> {try{return await json<T>(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}}
export async function save(path: string, data: unknown) {await backendFor(path).write(path,typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data,null,2)+'\n');}
export const listDir=(dir:string)=>backendFor(dir+'/').list(dir);
export const modifiedAt=(path:string)=>backendFor(path).modified(path);
export const removeFile=(path:string)=>backendFor(path).remove(path);
export function workspacePath(path: string) {
  const absolute = resolve(ROOT,path); const rel=relative(ROOT,absolute);
  if(rel.startsWith('..') || rel==='' || rel.startsWith('/')) throw new Error('Expected a file path inside this workspace');
  return absolute;
}
// The same check for backend paths: relative, inside the data directory, no traversal.
export function dataPath(path: string) {const rel=relative(ROOT,resolve(ROOT,path));if(rel.startsWith('..')||rel===''||rel.startsWith('/'))throw new Error('Expected a file path inside this workspace');return rel;}
export function markdown(value: string) {return value.replace(/[|\r\n]/g,' ').replace(/\[/g,'\\[').replace(/\]/g,'\\]');}

// The player's profile (config.json in the data directory). Every field is optional; a fresh workspace works without it.
export interface Profile {player:string;aliases:string[];timezone?:string;format:string;ratingBrackets:number[];replayFolder:string;coachingLevel:string}
export const DEFAULT_PROFILE:Profile={player:'',aliases:[],format:'gen9championsvgc2026regmc',ratingBrackets:[0,1500,1630,1760],replayFolder:'replays/originals',coachingLevel:'advanced'};
export async function config():Promise<Profile>{return {...DEFAULT_PROFILE,...await optionalJSON<Partial<Profile>>('config.json',{})};}
