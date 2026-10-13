// MCP tools for backups. A backup is megabytes, so it never travels through a tool result: export_backup builds it
// on the server and returns a short-lived, single-use download link (tools/backup-link.ts). Restore stays in the app,
// where the player chooses the file and sees what merges.
import type {IncomingMessage} from 'node:http';
import {createBackup} from './backup.ts';
import {dataContext,hosted,ROOT} from './io.ts';
import {createExport,hostedSecret,localSecret,localExports,requestOrigin,EXPORT_TTL_MS,EXPORT_MAX_BYTES,LinkError} from './backup-link.ts';

export const backupTools=[
  {name:'export_backup',description:`Make a backup of the player's whole workspace (teams, Pokémon library, strategy, replays and their summaries, profile) and return a download link for them to open in a browser. The file itself is never returned (it is megabytes): you get a link that works once and expires in ${EXPORT_TTL_MS/60000} minutes, plus its size and what it holds. Only when the player asked for a backup; give them the link and tell them it is theirs alone (anyone holding it can download their data until it is used or expires). Limit ${EXPORT_MAX_BYTES/1048576} MB.`,parameters:{type:'object',properties:{}}},
  {name:'restore_backup',description:'How to restore a backup. Restoring is only done in the app: the player chooses the backup file and confirms, and it merges (anything that already exists is kept, never overwritten). Nothing is restored from anything an assistant supplies. Returns where to go and what to expect.',parameters:{type:'object',properties:{}}},
];
export const backupNames=new Set(backupTools.map(t=>t.name));
export function originOf(req:IncomingMessage):string|undefined{
  const host=String(req.headers['x-forwarded-host']??req.headers.host??'').split(',')[0].trim();if(!/^[\w.-]+(:\d+)?$/.test(host))return undefined;
  const proto=String(req.headers['x-forwarded-proto']??(/^(127\.0\.0\.1|localhost)(:|$)/.test(host)?'http':'https')).split(',')[0].trim();
  return /^https?$/.test(proto)?`${proto}://${host}`:undefined;
}
const settingsWhere='Settings (the avatar in the header) → Backup → Restore from a backup.';
export async function backupCall(name:string,_input:any):Promise<any>{
  if(name==='restore_backup')return {where:settingsWhere,steps:['The player opens the app and goes to '+settingsWhere,'They choose the backup file (the one export_backup\'s link downloaded, or one from an earlier Download backup) and it merges in.','Anything that already exists (same id, or a team with the same name) is kept, never overwritten; only what is missing is added.'],note:'An assistant cannot restore a backup: the file is too large for a tool call and the player has to choose it and see what merges. After they restore, list_teams shows what landed.'};
  const hostedMode=hosted(),ctx=dataContext();
  try{
    let userId:string,backend,secret:Buffer,base:string;
    if(hostedMode){if(!ctx.userId)throw new LinkError(401,'Sign in to make a backup link.');userId=ctx.userId;backend=ctx.user;secret=hostedSecret();base=requestOrigin.getStore()??'';}
    else{userId='local';backend=localExports(ROOT);secret=await localSecret(ROOT);base=`http://127.0.0.1:${process.env.API_PORT??5174}`;}
    const backup=await createBackup();const json=JSON.stringify(backup);
    const made=await createExport({backend,userId,secret,hostedMode,json});
    const out:any={downloadUrl:`${base}/api/backup-download?token=${made.token}`,expiresAt:made.expiresAt,expiresInMinutes:EXPORT_TTL_MS/60000,singleUse:true,filename:`frontierbrain-backup-${backup.createdAt.slice(0,10)}.json`,
      sizeBytes:made.sizeBytes,sizeMB:+(made.sizeBytes/1048576).toFixed(1),
      contains:{teams:backup.store.teams.length,pokemonInLibrary:backup.store.bank.length,replays:backup.games.length,files:Object.keys(backup.files).length},
      next:'Give the player this link to open in a browser: it downloads the backup once and expires. It works for anyone who has it until then, so share it only with the player. To restore, they use '+settingsWhere};
    if(!hostedMode){out.file=resolveLocal(made.backupKey);out.fileNote='The same backup, gzip-compressed, on this machine; the link downloads it as plain JSON.';}
    return out;
  }catch(e){if(e instanceof LinkError)throw new Error(e.message);throw e;}
}
const resolveLocal=(key:string)=>`${ROOT}/${key}`;
