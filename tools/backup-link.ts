// Backup download links. A backup holds every replay's full log (megabytes), so an assistant never receives it:
// the server builds it, stores it briefly under a reserved path, and hands back a signed, short-lived, single-use
// link the player opens in a browser (a plain link carries no Authorization header, so the signature is the proof).
// Hosted: a `user_files` row at `.exports/<nonce>.json.gz`, read back with the server's secret key. Local: a file
// under `.cache/exports/`. The token never appears in logs; the object is deleted on first download or at expiry.
import {createHmac,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {fileBackend,type DataBackend} from './io.ts';

export const EXPORT_TTL_MS=15*60_000,EXPORT_MAX_BYTES=40*1024*1024,EXPORT_MAX_LIVE=3,EXPORT_GRACE_MS=60_000;
const DIR={hosted:'.exports',local:'.cache/exports'},KEY_FILE='.cache/exports/.key';
const NONCE=/^[a-f0-9]{32}$/;
export interface ExportBackend extends DataBackend {take?(path:string):Promise<Buffer|null>}
export interface TokenPayload {userId:string;backupKey:string;exp:number;nonce:string}
export class LinkError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export const exportKey=(nonce:string,hostedMode:boolean)=>`${DIR[hostedMode?'hosted':'local']}/${nonce}.json.gz`;
// The request's public origin, set by the MCP handler so a tool can build an absolute link.
export const requestOrigin=new AsyncLocalStorage<string>();

// Hosted: BACKUP_LINK_SECRET when set, else derived (HKDF, context string) from the server's secret key, which is
// also what the download needs to read the row without the browser session. Fails closed when either is missing.
export function hostedSecret(env=process.env):Buffer{
  if(!env.SUPABASE_SECRET_KEY)throw new LinkError(503,'Backup links are not available on this site: the server has no secret key configured to read the export back. Use Settings → Backup → Download backup in the app.');
  const ikm=env.BACKUP_LINK_SECRET||env.SUPABASE_SECRET_KEY;
  return Buffer.from(hkdfSync('sha256',ikm,'frontier-brain','backup-download-link-v1',32));
}
// Local: a random key kept in the data directory's .cache (or BACKUP_LINK_SECRET), so links survive a restart.
export async function localSecret(root:string,env=process.env):Promise<Buffer>{
  if(env.BACKUP_LINK_SECRET)return Buffer.from(hkdfSync('sha256',env.BACKUP_LINK_SECRET,'frontier-brain','backup-download-link-v1',32));
  const b=fileBackend(root);const have=await b.read(KEY_FILE);if(have&&have.length>=32)return have;
  const key=randomBytes(32);await b.write(KEY_FILE,key);return key;
}

const b64=(b:Buffer|string)=>Buffer.from(b).toString('base64url');
const mac=(secret:Buffer,body:string)=>createHmac('sha256',secret).update(body).digest();
export function signToken(p:TokenPayload,secret:Buffer):string{const body=b64(JSON.stringify(p));return `${body}.${b64(mac(secret,body))}`;}
// Throws LinkError(403 bad, 410 expired). expectKey is the one path this mode may serve; nothing else is accepted.
export function verifyToken(token:unknown,secret:Buffer,hostedMode:boolean,now=Date.now()):TokenPayload{
  const bad=()=>new LinkError(403,'This backup link is not valid.');
  if(typeof token!=='string'||token.length>1024||!/^[\w-]+\.[\w-]+$/.test(token))throw bad();
  const [body,sig]=token.split('.');const given=Buffer.from(sig,'base64url'),want=mac(secret,body);
  if(given.length!==want.length||!timingSafeEqual(given,want))throw bad();
  let p:any;try{p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{throw bad();}
  if(!p||typeof p.userId!=='string'||!p.userId||typeof p.nonce!=='string'||!NONCE.test(p.nonce)||typeof p.exp!=='number'||p.backupKey!==exportKey(p.nonce,hostedMode))throw bad();
  if(now>=p.exp)throw new LinkError(410,'This backup link has expired. Ask your assistant for a new one.');
  return p as TokenPayload;
}

// Delete exports older than their lifetime. Failures are not fatal: expiry is also enforced by the token.
export async function purgeExports(backend:DataBackend,hostedMode:boolean,now=Date.now()):Promise<number>{
  const dir=DIR[hostedMode?'hosted':'local'];let live=0;
  for(const name of await backend.list(dir).catch(()=>[] as string[])){if(!/^[a-f0-9]{32}\.json\.gz$/.test(name))continue;
    const path=`${dir}/${name}`;const at=await backend.modified(path).catch(()=>null);
    if(at===null||now-at>EXPORT_TTL_MS+EXPORT_GRACE_MS){await backend.remove(path).catch(()=>{});}else live++;}
  return live;
}
export function backupSize(json:string){return Buffer.byteLength(json);}
export async function createExport(o:{backend:DataBackend;userId:string;secret:Buffer;hostedMode:boolean;json:string;now?:number}){
  const now=o.now??Date.now(),size=backupSize(o.json);
  if(size>EXPORT_MAX_BYTES)throw new LinkError(413,`This backup is ${(size/1048576).toFixed(1)} MB, over the ${EXPORT_MAX_BYTES/1048576} MB a download link can carry. Use Settings → Backup → Download backup in the app.`);
  if(await purgeExports(o.backend,o.hostedMode,now)>=EXPORT_MAX_LIVE)throw new LinkError(429,`${EXPORT_MAX_LIVE} backup links are already waiting. Open one, or wait up to ${EXPORT_TTL_MS/60000} minutes for them to expire.`);
  const nonce=randomBytes(16).toString('hex'),backupKey=exportKey(nonce,o.hostedMode),gz=gzipSync(o.json);
  await o.backend.write(backupKey,gz);
  const exp=now+EXPORT_TTL_MS;
  return {token:signToken({userId:o.userId,backupKey,exp,nonce},o.secret),expiresAt:new Date(exp).toISOString(),sizeBytes:size,storedBytes:gz.length,backupKey};
}
// Verify, then claim the object (atomic where the backend supports it) so a second request finds nothing.
export async function redeemExport(token:unknown,o:{secret:Buffer;hostedMode:boolean;backendFor:(userId:string)=>ExportBackend;now?:number}){
  const now=o.now??Date.now(),p=verifyToken(token,o.secret,o.hostedMode,now),backend=o.backendFor(p.userId);
  await purgeExports(backend,o.hostedMode,now);
  let bytes:Buffer|null;
  if(backend.take)bytes=await backend.take(p.backupKey);
  else{bytes=await backend.read(p.backupKey);if(bytes)await backend.remove(p.backupKey);}
  if(!bytes)throw new LinkError(410,'This backup link was already used or has expired. Ask your assistant for a new one.');
  return {body:gunzipSync(bytes),userId:p.userId};
}
// File-backed exports (local mode, tests): rename-then-read makes the claim atomic.
export function localExports(root:string):ExportBackend{
  const base=fileBackend(root);
  return {...base,async take(path){const from=resolve(root,path),claimed=`${from}.${randomBytes(6).toString('hex')}.claim`;
    try{await rename(from,claimed);}catch{return null;}
    try{return await readFile(claimed);}finally{await rm(claimed,{force:true});}}};
}

// GET /api/backup-download?token=...  No session: the signed token is the credential. Never logs or echoes it.
export async function serveBackupDownload(req:IncomingMessage,res:ServerResponse,o:{secret:()=>Promise<Buffer>|Buffer;hostedMode:boolean;backendFor:(userId:string)=>ExportBackend;now?:number}){
  const head:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  const fail=(status:number,error:string)=>{res.writeHead(status,{...head,'Content-Type':'application/json; charset=utf-8',...status===405?{Allow:'GET'}:{}});res.end(JSON.stringify({error}));};
  if(req.method!=='GET')return fail(405,'Open the link in a browser (GET).'); // HEAD and prefetchers must not use up the link
  try{
    const token=new URL(req.url??'/','http://x').searchParams.get('token');
    const {body}=await redeemExport(token,{secret:await o.secret(),hostedMode:o.hostedMode,backendFor:o.backendFor,now:o.now});
    res.writeHead(200,{...head,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="frontierbrain-backup-${new Date().toISOString().slice(0,10)}.json"`,'Content-Length':String(body.length)});res.end(body);
  }catch(e){if(e instanceof LinkError)return fail(e.status,e.message);return fail(500,'The backup could not be read. Ask your assistant for a new link.');}
}
