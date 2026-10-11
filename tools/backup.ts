// Workspace backups: everything a player owns (teams, Pokémon library, strategy, replays and their summaries,
// profile) in one JSON file. Download one locally, restore it into a hosted account, or the other way round.
// Restoring merges: anything that already exists (same id, or a team with the same name) is kept, never overwritten.
import {listDir,optionalJSON,readBytes,save} from './io.ts';
import {readStore,mutateStore} from './workbench-store.ts';
import type {Workbench} from '../shared/workbench.ts';

export const BACKUP_FORMAT='frontierbrain-backup';
const DIRS=['replays/originals','replays/parsed','reports/replay-summaries','reports/replay-digests'];
const FILES=['config.json','context/player.md','context/preferences.json'];
export interface Backup {format:typeof BACKUP_FORMAT;version:1;createdAt:string;store:Omit<Workbench,'revision'>;games:any[];files:Record<string,string>}

async function filesIn(dir:string):Promise<string[]>{const out:string[]=[];for(const name of await listDir(dir).catch(()=>[])){const path=`${dir}/${name}`;if(/\.(json|html|md)$/.test(name))out.push(path);else out.push(...await filesIn(path));}return out;}
export async function createBackup():Promise<Backup>{
  const {revision:_,...store}=await readStore();const index=await optionalJSON<any>('replays/index.json',{games:[]});
  const files:Record<string,string>={};const wanted=new Set([...FILES,...(await Promise.all(DIRS.map(filesIn))).flat(),...index.games.flatMap((g:any)=>[g.source,g.parsed].filter(Boolean))]);
  for(const path of wanted){try{files[path]=(await readBytes(path)).toString('utf8');}catch{}}
  return {format:BACKUP_FORMAT,version:1,createdAt:new Date().toISOString(),store,games:index.games,files};
}

const safePath=(p:string)=>typeof p==='string'&&/^(replays|reports|context)\/[\w./-]+$|^config\.json$/.test(p)&&!p.includes('..');
export async function restoreBackup(input:any){
  if(input?.format!==BACKUP_FORMAT||input.version!==1||!input.store)throw new Error('That file is not a Frontier Brain backup.');
  const b=input as Backup;const current=await readStore();
  const result=await mutateStore(current.revision,db=>{
    // A team is skipped if this workspace already has one with the same id or name (e.g. the sample teams).
    const added=(b.store.teams??[]).filter(t=>!db.teams.some(x=>x.id===t.id||x.name===t.name));db.teams.push(...added);
    const used=new Set(added.flatMap(t=>t.versions.flatMap(v=>v.configurations.flatMap(c=>c.slots.map(s=>s.bankId)))));
    const pokemon=(b.store.bank??[]).filter(e=>used.has(e.id)&&!db.bank.some(x=>x.id===e.id));db.bank.push(...pokemon);
    const ids=new Set(added.map(t=>t.id));db.coaching??={};for(const [id,c] of Object.entries(b.store.coaching??{}))if(ids.has(id)&&!db.coaching[id])db.coaching[id]=c;
    let replays=0;for(const [id,a] of Object.entries(b.store.associations??{}))if(ids.has(a.teamId)&&!db.associations[id]){db.associations[id]=a;replays++;}
    const known=new Set(db.matches.map(m=>m.id));for(const m of b.store.matches??[])if(!known.has(m.id)&&m.replayIds.every(r=>db.associations[r]))db.matches.push(m);
    const bank=new Set(db.bank.map(e=>e.id));for(const x of b.store.benchmarks??[])if(bank.has(x.bankId)&&!db.benchmarks?.some(y=>y.id===x.id))(db.benchmarks??=[]).push(x);
    return {teams:added.length,pokemon:pokemon.length,replays};
  });
  // Files: the profile only if this workspace has none yet; replay files and summaries if missing.
  let files=0;for(const [path,body] of Object.entries(b.files??{})){if(!safePath(path)||typeof body!=='string')continue;
    if(await readBytes(path).then(()=>true,()=>false))continue;await save(path,body);files++;}
  const index=await optionalJSON<any>('replays/index.json',{schemaVersion:1,games:[],errors:[]});let games=0;
  for(const g of b.games??[])if(g?.id&&!index.games.some((x:any)=>x.id===g.id)&&safePath(g.parsed)){index.games.push(g);games++;}
  if(games)await save('replays/index.json',index);
  return {...result.result as any,games,files,revision:result.db.revision};
}
