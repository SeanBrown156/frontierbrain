import type {PokemonSet} from '../../shared/workbench.ts';
import {Art,Markdown,SetArt,Button,Tag} from '../ui.tsx';
import SetTile from './SetTile.tsx';
import {getView} from '../team/editors.tsx';
import {teamHref,addPlans} from '../team/Hub.tsx';
import {benchHref} from '../team/Bench.tsx';
import {BENCH_LABEL} from '../../shared/workbench.ts';
import {coachingUpdate} from '../team/Coaching.tsx';

export interface Proposal {kind:'set'|'team'|'lead'|'matchup'|'strategy'|'bench'|'promote';status?:'accepted'|'rejected'|'saving'|'queued'|'replaced'|'handled';pendingId?:string;error?:string;[k:string]:any;}
export const describeProposal=(p:Proposal)=>p.kind==='set'?`${p.set.species} for slot ${p.slot+1}`:p.kind==='bench'?`${p.set.species} for the ${BENCH_LABEL}`:p.kind==='promote'?`promote ${p.species} for ${p.replacing}`:p.kind==='team'?p.name:p.kind==='strategy'?'a strategy rewrite':p.lead?.join(' + ')??p.opponent??p.text?.slice(0,60);

// Accepting a proposal, wherever it is shown (the chat, or the Inbox): every kind goes through the normal store actions,
// reading the latest data. `page` is only passed by the chat dock, so a set for the Pokémon page that is open can load
// into its draft instead of saving straight away. Returns a note to show, or nothing.
export interface AcceptEnv {team:any;dataRef:{current:any};mutate:(a:any)=>Promise<any>;versionId:string;page?:{page:string;slot?:number;versionId:string;offer:(key:string,v:any)=>boolean;leave:(key:string,v:any)=>void};navigate?:boolean;}
export async function acceptProposal(p:Proposal,env:AcceptEnv):Promise<string|void>{
  const {team,dataRef,mutate,versionId,page}=env;const latest=dataRef.current;const t=latest.teams.find((x:any)=>x.id===team.id);const v=getView(t,latest.db,versionId);
  if(p.kind==='set'){
    if(page&&page.page==='slot'&&page.slot===p.slot&&page.offer(`set:${team.id}:${p.slot}`,p))return 'Loaded into the set card. Review it, then Save.';
    const now=v.sets[p.slot];if(p.forSpecies&&now?.species!==p.forSpecies&&!confirm(`Slot ${p.slot+1} is now ${now?.species}, not ${p.forSpecies}. Replace it with ${p.set.species} anyway?`))throw new Error('Not applied.');
    await mutate({type:'team-replace-sets',teamId:team.id,versionId,sets:[{slot:p.slot,set:p.set,baseRevisionId:v.slots[p.slot].revisionId,...p.strategy?{notes:{role:p.strategy,benchmarks:''}}:{note:`AI: ${p.why}`}}],summary:`AI: ${p.set.species} in slot ${p.slot+1}`});return;}
  if(p.kind==='team'){const r=await mutate({type:'team-replace-sets',teamId:team.id,versionId,parentConfigurationId:v.version.currentConfigurationId,sets:p.sets.map((set:any,slot:number)=>({slot,set})),summary:`AI rebuild: ${p.name}`,newVersion:true,notes:p.strategy||v.version.notes});
    await addPlans(t,dataRef.current,mutate,p,r.result.versionId);if(env.navigate!==false)location.hash=teamHref(team.id,'overview',r.result.versionId);return 'Saved as a new version (not active). Make it active from its page when you are happy.';}
  if(p.kind==='bench'){const r=await mutate({type:'bench-add',teamId:team.id,set:p.set,replaces:p.replaces,notes:{role:p.strategy,benchmarks:''},source:'assistant'});if(env.navigate!==false)location.hash=benchHref(team.id,r.result.id);return `Added to the ${BENCH_LABEL}. Your six is unchanged.`;}
  if(p.kind==='promote'){
    const item=(t.bench??[]).find((b:any)=>b.id===p.benchId);if(!item)throw new Error(`${p.species} is no longer on the ${BENCH_LABEL}, so it can't be promoted. Dismiss this.`);
    const now=v.sets[p.slot];
    // A slot that holds a different Pokémon than when this was proposed needs a second look; the same one is replaced as it is now.
    if(p.replacing&&now?.species!==p.replacing&&!confirm(`Slot ${p.slot+1} is now ${now?.species}, not ${p.replacing}. Promote ${p.species} into it anyway?`))throw new Error('Not applied.');
    await mutate({type:'bench-promote',teamId:team.id,benchId:p.benchId,slot:p.slot,baseRevisionId:v.slots[p.slot].revisionId});if(env.navigate!==false)location.hash=benchHref(team.id);return `${p.species} is in. ${p.replacing} is on the ${BENCH_LABEL}.`;}
  if(p.kind==='strategy'){
    if(page){if(page.offer(`strategy:${team.id}`,p.text))return 'Loaded into the strategy editor. Review it, then Save.';page.leave(`strategy:${team.id}`,p.text);location.hash=teamHref(team.id,'strategy',page.versionId);return 'Opened in the strategy editor.';}
    await mutate({type:'version-notes',teamId:team.id,versionId:t.activeVersionId,notes:String(p.text).slice(0,12000)});return 'Saved as the team’s strategy write-up.';}
  await saveCoaching([p],env);
}
export async function saveCoaching(ps:Proposal[],env:AcceptEnv){
  const {team,dataRef,mutate,page}=env;const latest=dataRef.current;const c=latest.db.coaching?.[team.id]??{teamId:team.id,version:0,leads:[],matchups:[],objectives:[]};const id=()=>Math.random().toString(36).slice(2,12);const scope=!page||page.versionId==='all'?[]:[page.versionId];
  const leads=[...c.leads],matchups=[...c.matchups],objectives=[...c.objectives];
  for(const p of ps){if(p.kind==='lead')leads.push({id:id(),lead:p.lead,back:p.back,when:p.when,plan:p.plan,calcIds:[],versionIds:scope,status:'active'});else if(p.kind==='matchup')matchups.push({id:id(),opponent:p.opponent,threat:p.threat,bring:p.bring,plan:p.plan,calcIds:[],versionIds:scope,status:'active'});}
  await mutate(coachingUpdate(team.id,c,{leads,matchups,objectives}));
}

export function ProposalCard({p,art,current,decide,readOnly,rejectLabel='Reject',compact}:{p:Proposal;art:any;current:(slot:number)=>PokemonSet|undefined;decide:(accept:boolean)=>void;readOnly?:boolean;rejectLabel?:string;compact?:boolean}){
  const actions=p.status==='accepted'?<Tag tone="ok">Accepted</Tag>:p.status==='rejected'?<Tag>Dismissed</Tag>:p.status==='queued'?<Tag>In your Inbox</Tag>:p.status==='replaced'?<Tag>Replaced by a newer suggestion</Tag>:p.status==='handled'?<Tag>Handled in your Inbox</Tag>:readOnly?<Tag>No decision</Tag>:<><Button variant="primary" disabled={p.status==='saving'} onClick={()=>decide(true)}>{p.status==='saving'?'Saving…':'Accept'}</Button><Button disabled={p.status==='saving'} onClick={()=>decide(false)}>{rejectLabel}</Button></>;
  const note=p.error&&<p className={p.status==='accepted'?'muted':'error'}>{p.error}</p>;
  const foot=<>{note}<div className="button-row">{actions}</div></>;
  if(p.kind==='set')return <SetTile set={p.set} current={current(p.slot)} art={art} note={p.why} strategy={p.strategy} strategyOpen={!compact} actions={<>{note}{actions}</>}/>;
  if(p.kind==='bench')return <SetTile set={p.set} art={art} note={`${p.why}${p.replaces?` Could replace ${p.replaces}.`:''} Accepting adds it to the ${BENCH_LABEL}; your six is unchanged.`} strategy={p.strategy} strategyOpen={!compact} actions={<>{note}{actions}</>}/>;
  if(p.kind==='promote')return <SetTile set={p.set} current={current(p.slot)} art={art} note={`${p.why} Promotes it from the ${BENCH_LABEL}; ${p.replacing} goes onto the ${BENCH_LABEL}.`} strategy={p.strategy} strategyOpen={!compact} actions={<>{note}{actions}</>}/>;
  if(p.kind==='team')return <article className="proposal-card"><h3>{p.name}</h3><div className="team-six">{p.sets.map((s:PokemonSet)=><SetArt key={s.species} set={s} art={art} small/>)}</div><details><summary>Sets, strategy and plans</summary><pre className="paste">{p.paste}</pre><Markdown text={p.strategy}/><p className="muted">{p.leads.length} lead plan(s) and {p.matchups.length} matchup plan(s) come with it as drafts.</p></details><p className="muted">Accepting saves it as a new version; your current version stays active.</p>{foot}</article>;
  if(p.kind==='lead')return <article className="proposal-card"><div className="pair">{p.lead.map((m:string)=><Art key={m} name={m} art={art} small/>)}<h3>{p.lead.join(' + ')}</h3></div>{p.back?.length>0&&<p className="muted">Back: {p.back.join(', ')}</p>}{p.when&&<p><b>When:</b> {p.when}</p>}<Markdown text={p.plan}/>{foot}</article>;
  if(p.kind==='matchup')return <article className="proposal-card"><h3><span className={'threat '+p.threat}>{p.threat}</span> {p.opponent}</h3><div className="pair">{p.bring.map((m:string)=><Art key={m} name={m} art={art} small/>)}</div><Markdown text={p.plan}/>{foot}</article>;
  return <article className="proposal-card"><span className="eyebrow">Strategy rewrite</span><Markdown text={p.text}/>{foot}</article>;
}

