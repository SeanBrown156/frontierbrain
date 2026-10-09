// Starter teams (knowledge/samples/samples.json, built by tools/build-samples.ts). A brand-new hosted workspace
// (revision 0) gets them automatically; anyone can add them again from the Teams page. Sample replays are read
// from the anonymised "Player" side, kept in replays/samples/ (outside ingest scans) and linked as "same six".
import {json,hosted} from './io.ts';
import {readStore,mutateStore,makeTeam,associateReplay,currentTeam,Conflict} from './workbench-store.ts';
import {addReplays,parseReplay} from './replays.ts';

interface Sample {key:string;name:string;paste:string;notes:string;replays?:{file:string;html:string}[]}
export async function addSamples(){
  const bundle=await json<{teams:Sample[]}>('knowledge/samples/samples.json');const db=await readStore();
  const missing=bundle.teams.filter(s=>!db.teams.some(t=>t.name===s.name));if(!missing.length)return {added:0};
  const changed=await mutateStore(db.revision,state=>missing.map(s=>({sample:s,team:makeTeam(state,s.name,s.paste,undefined,{notes:s.notes})})));
  const links:{game:ReturnType<typeof parseReplay>;teamId:string}[]=[];
  for(const {sample,team} of changed.result as {sample:Sample;team:{id:string}}[]){if(!sample.replays?.length)continue;
    const saved=await addReplays(sample.replays.map(r=>({html:r.html,filename:r.file})),{folder:'replays/samples',as:'Player'});
    sample.replays.forEach((r,i)=>{const game=parseReplay(r.html,r.file,'Player');game.id=saved.results[i].id;links.push({game,teamId:team.id});});}
  if(links.length)await mutateStore(changed.db.revision,state=>{for(const l of links){const t=state.teams.find(x=>x.id===l.teamId)!;associateReplay(state,l.game,{teamId:t.id,versionId:currentTeam(state,t).version.id,certainty:'family'});}});
  return {added:missing.length};
}
// Called on dashboard loads: only a workspace that has never been saved (revision 0) is seeded, so deleting the
// samples later never brings them back. Two tabs racing just conflict; the loser does nothing.
export async function seedNewWorkspace(){
  if(!hosted())return false;const db=await readStore();if(db.revision!==0||db.teams.length)return false;
  try{await addSamples();return true;}catch(e){if(e instanceof Conflict)return false;throw e;}
}
