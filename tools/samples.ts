// Starter teams: the two latest Regional winners (latestSamples; curated ones from knowledge/samples/samples.json, built
// by tools/build-samples.ts). A brand-new hosted workspace
// (revision 0) gets them automatically; anyone can add them again from the Teams page. Sample replays are read
// from the anonymised "Player" side, kept in replays/samples/ (outside ingest scans) and linked as "same six". Each team
// arrives with its curated strategy: the game plan as version notes and active lead/matchup plans (knowledge/samples/strategy.json).
import {json,hosted} from './io.ts';
import {readStore,mutateStore,makeTeam,applyAction,associateReplay,currentTeam,Conflict} from './workbench-store.ts';
import type {LeadPlan,MatchupPlan} from '../shared/workbench.ts';
import {addReplays,parseReplay} from './replays.ts';
import {poolTeams,type PoolTeam} from './pool.ts';
import {exportText} from './teams.ts';
import {commonSpread} from './typical-set.ts';

interface Sample {key:string;name:string;paste:string;notes:string;coaching?:{leads:LeadPlan[];matchups:MatchupPlan[]};replays?:{file:string;html:string}[]}
const ordinal=(n:number)=>n+(['th','st','nd','rd'][n%100>10&&n%100<14?0:n%10]??'th');
const day=(d:string)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
const FORMAT='gen9championsvgc2026regmc';
// The samples are the two most recent official Regional winners in the team pool (larger event first on a tie). A
// winner with a curated entry in samples.json keeps its hand-written strategy and replays; any other winner arrives as
// its team list, with blank stat points filled from the most common competitive spread and labelled as such.
// Without a pool (fresh checkout, tests) the two newest curated samples are used.
export async function latestSamples(count=2):Promise<Sample[]>{
  const bundle=await json<{teams:Sample[]}>('knowledge/samples/samples.json');
  let pool:PoolTeam[]=[];try{pool=await poolTeams();}catch{}
  const winners=pool.filter(t=>t.lane==='official'&&t.placing===1&&/regional/i.test(t.event)&&t.sets.length===6)
    .sort((a,b)=>(b.date??'').localeCompare(a.date??'')||(b.players??0)-(a.players??0));
  const picked=[...new Map(winners.map(t=>[t.eventId,t])).values()].slice(0,count);
  if(!picked.length)return bundle.teams.slice(0,count);
  return Promise.all(picked.map(async t=>bundle.teams.find(s=>s.key===t.id)??await fromList(t)));
}
async function fromList(t:PoolTeam):Promise<Sample>{
  const event=t.event.replace(/^Regional (.+)$/,'$1 Regional');const filled:string[]=[];
  const sets=await Promise.all(t.sets.map(async s=>{if(s.statPoints)return s;const c=await commonSpread(s.species);if(!c)return s;
    filled.push(`${s.species}: ${c.label}`);return {...s,statPoints:c.statPoints,nature:s.nature||c.nature||s.nature};}));
  const list=t.sources?.find(x=>x.name==='Limitless')?.url;
  return {key:t.id,name:`Sample · ${t.player}, ${ordinal(t.placing!)} ${event}`,paste:exportText(sets as any,FORMAT),
    notes:[`Sample team: ${t.player}'s ${ordinal(t.placing!)}-place team from ${t.event} (${t.date?day(t.date):'date unknown'}${t.players?`, ${t.players.toLocaleString('en')} players`:''}).`,
      `Team list: ${list??'Limitless'}. Species, items, abilities and moves are as published.`,
      filled.length?`Stat points were not published. Each is filled with the most common competitive spread (inferred, not this player's):\n${filled.map(f=>`- ${f}`).join('\n')}`:'',
      'This is a starter example; edit it, copy ideas from it, or delete it.'].filter(Boolean).join('\n\n')};
}
export async function addSamples(){
  const teams=await latestSamples();const db=await readStore();
  const missing=teams.filter(s=>!db.teams.some(t=>t.name===s.name));if(!missing.length)return {added:0};
  const changed=await mutateStore(db.revision,state=>missing.map(s=>{const team=makeTeam(state,s.name,s.paste,undefined,{notes:s.notes});
    if(s.coaching)applyAction(state,{type:'coaching-save',teamId:team.id,parentVersion:0,coaching:{...s.coaching,objectives:[]}});return {sample:s,team};}));
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
