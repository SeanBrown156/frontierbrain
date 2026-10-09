import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

// CODE is this repository. ROOT is the data directory: APP_DATA (from the environment or CODE/.env) when set,
// otherwise the repository itself. Reads fall back to CODE so shipped reference files (knowledge/mechanics,
// knowledge/regulations, knowledge/sources) work from any data directory; writes always go to ROOT.
export const CODE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Only APP_DATA is read here; API keys stay unloaded until a feature asks for them.
if(!process.env.APP_DATA){try{const value=parseEnv(readFileSync(resolve(CODE,'.env'),'utf8')).APP_DATA;if(value)process.env.APP_DATA=value;}catch{}}
export const ROOT = process.env.APP_DATA ? resolve(CODE,process.env.APP_DATA) : CODE;
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export const id = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export function localDay() { return new Intl.DateTimeFormat('en-CA', {timeZone:process.env.APP_TIMEZONE||undefined,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export async function readText(path: string): Promise<string> {
  try{return await readFile(resolve(ROOT,path),'utf8');}catch(e){if(ROOT===CODE||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return readFile(resolve(CODE,path),'utf8');}
}
export async function json<T = any>(path: string): Promise<T> {return JSON.parse(await readText(path));}
export async function optionalJSON<T>(path: string, fallback: T): Promise<T> {try{return await json<T>(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}}
export async function save(path: string, data: unknown) {
  const target = resolve(ROOT,path); await mkdir(dirname(target),{recursive:true});
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, typeof data==='string'?data:JSON.stringify(data,null,2)+'\n'); await rename(tmp,target);
}
export function workspacePath(path: string) {
  const absolute = resolve(ROOT,path); const rel=relative(ROOT,absolute);
  if(rel.startsWith('..') || rel==='' || rel.startsWith('/')) throw new Error('Expected a file path inside this workspace');
  return absolute;
}
export function markdown(value: string) {return value.replace(/[|\r\n]/g,' ').replace(/\[/g,'\\[').replace(/\]/g,'\\]');}

// The player's profile (config.json in the data directory). Every field is optional; a fresh workspace works without it.
export interface Profile {player:string;aliases:string[];timezone?:string;format:string;ratingBrackets:number[];replayFolder:string;coachingLevel:string}
export const DEFAULT_PROFILE:Profile={player:'',aliases:[],format:'gen9championsvgc2026regmc',ratingBrackets:[0,1500,1630,1760],replayFolder:'replays/originals',coachingLevel:'advanced'};
export async function config():Promise<Profile>{return {...DEFAULT_PROFILE,...await optionalJSON<Partial<Profile>>('config.json',{})};}
