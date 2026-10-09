import ps from 'pokemon-showdown';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {ROOT,json,save,hash,workspacePath} from './io.ts';
import {validateTeam,finalStats,FORMAT,VERSIONS,dex,type SetInput} from './mechanics.ts';
import type {ReplayIndex,Game} from './replays.ts';

export function importText(text:string):SetInput[] {
  if(/^IVs:/mi.test(text))throw new Error('Champions has no editable IVs; remove IVs lines rather than silently converting');
  if(/^Tera Type:|^Gigantamax:/mi.test(text))throw new Error('Tera/Dynamax fields are not Champions mechanics');
  const team=ps.Teams.import(text);if(!team?.length)throw new Error('No Showdown team sets found');
  return team.map((s: {name:string;species:string;nature:string;evs:any;item:string;ability:string;moves:string[];gender:string})=>({species:s.species,nickname:s.name===s.species?undefined:s.name,nature:s.nature,statPoints:s.evs,item:s.item,ability:s.ability,moves:s.moves,gender:s.gender||undefined}));
}
export function exportText(sets:SetInput[],format=FORMAT) {return ps.Teams.export(validateTeam(sets,format) as any);}
export async function teamImport(path:string,version:string,format=FORMAT,storageRoot=ROOT) {
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(version))throw new Error('Version ID must be lowercase letters/digits/hyphens, <=64 chars');
  const text=await readFile(resolve(path),'utf8');const sets=importText(text);const exported=exportText(sets,format);const createdAt=new Date().toISOString();
  const directory=resolve(storageRoot,`teams/${version}`);await mkdir(directory,{recursive:false});
  const record={schemaVersion:1,id:version,createdAt,format,status:'candidate',source:path,sha256:hash(exported),versions:VERSIONS,sets};
  // Exclusive version folder creation prevents overwrite of a prior saved team.
  await writeFile(resolve(directory,'team.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  await writeFile(resolve(directory,'showdown.txt'),exported+'\n',{flag:'wx'});
  await writeFile(resolve(directory,'stats.md'),'# Champions final stats\n\nShowdown `EVs:` values are SP.\n\n'+sets.map(s=>`- ${s.species}: ${JSON.stringify(finalStats(s))}; SP ${JSON.stringify(s.statPoints)}; ${s.nature}.`).join('\n')+'\n',{flag:'wx'});
  return record;
}
export async function attachTeam(version:string,replayID:string) {
  if(!/^[a-z0-9-]+$/.test(version))throw new Error('Invalid team version');
  const {readStore,mutateStore,makeTeam,currentTeam,associateReplay}=await import('./workbench-store.ts');
  const index=await json<ReplayIndex>('replays/index.json');const entry=index.games.find(e=>e.id===replayID);if(!entry)throw new Error('Replay not found');const game=await json<Game>(entry.parsed);const db=await readStore();
  let team=db.teams.find(t=>t.id===version||t.name===version);let milestone:string|undefined;let config:string|undefined;
  if(!team)for(const t of db.teams)for(const v of t.versions){const c=v.configurations.find(c=>c.id===version);if(c){team=t;milestone=v.id;config=c.id;}}
  let legacy:any=null;if(!team){legacy=await json(`teams/${version}/team.json`);if(!legacy.sets)throw new Error('Choose a team ID, configuration ID or legacy candidate');}
  const changed=await mutateStore(db.revision,draft=>{let target=team?draft.teams.find(t=>t.id===team!.id)!:makeTeam(draft,version,exportText(legacy.sets,legacy.format),legacy.format);const view=currentTeam(draft,target,milestone,config);return associateReplay(draft,game,{teamId:target.id,versionId:view.version.id,configurationId:view.configuration.id,certainty:'exact',confirm:true});});
  const association=changed.db.associations[game.id];game.teamVersion=association.configurationId!;entry.teamVersion=game.teamVersion;entry.reviewedAt=null;entry.reviewPath=null;await save(entry.parsed,game);await save('replays/index.json',index);return {version:game.teamVersion,replayID,association,notes:'Explicit CLI confirmation; roster and recorded moves checked against frozen revisions.'};
}
