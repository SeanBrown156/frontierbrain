import {useState,useEffect,useCallback} from 'react';
import {Inbox as InboxIcon} from 'lucide-react';
import {api,Art,Panel,Empty,date} from './ui.tsx';
import {Px,Sparkles,Check,Copy,ArrowLeft,WarningDiamond} from './icons.tsx';
import {hostedSite} from './auth.tsx';
import {AssociationDialog} from './Coach.tsx';
import {ProposalCard,acceptProposal,type Proposal} from './ai/proposals.tsx';
import {aiReady} from './ai/AssistDock.tsx';
import {DamageViz,SpeedRace} from './BenchmarkLab.tsx';
import {getView} from './team/editors.tsx';
import {leaveOffer} from './save-state.ts';
import {BENCH_LABEL} from '../shared/workbench.ts';

// The Inbox: what is waiting on the player (tools/inbox.ts computes it from the same records the team views read).
// The count is polled like the other queues, only while the tab is visible, and refetched when the workspace changes.
export function useInbox(rev:unknown){
  const [inbox,setInbox]=useState<any>(null);
  const reload=useCallback(async()=>{try{setInbox(await api('/inbox'));}catch{}},[]);
  useEffect(()=>{void reload();},[rev,reload]);
  useEffect(()=>{const tick=()=>{if(document.visibilityState==='visible')void reload();};const t=setInterval(tick,hostedSite?60000:20000);document.addEventListener('visibilitychange',tick);
    return()=>{clearInterval(t);document.removeEventListener('visibilitychange',tick);};},[reload]);
  return {inbox,reload};
}
// The header entry beside the account button: just the tray icon, with a red number when something needs an action (9+ past nine).
export function InboxLink({count}:{count:number}){
  return <a className="inbox-button" href="#inbox" aria-label={count>0?`${count} waiting on you`:'Nothing waiting on you'} title={count>0?`${count} waiting on you`:'Nothing waiting'}><Px icon={InboxIcon}/>{count>0&&<span className="inbox-count" aria-hidden="true">{count>9?'9+':count}</span>}</a>;
}

// Pending decisions grouped by what they are about.
const PROPOSAL_GROUP:Record<string,string>={set:'team',team:'team',bench:'bench',promote:'bench',strategy:'strategy',lead:'strategy',matchup:'strategy'};
const groupOf=(i:any)=>i.kind==='suggestion'?PROPOSAL_GROUP[i.proposalKind]??'team':i.kind==='calc'?'calc':i.kind==='unlinked-replay'||i.kind==='summaries'?'replays':'notice';
const GROUPS:[string,string][]=[['team','Team'],['bench','Bench'],['strategy','Strategy'],['calc','Calcs'],['replays','Replays'],['notice','Notices']];
const KIND_LABEL:Record<string,string>={set:'Set',team:'Team',strategy:'Strategy',promote:'Promote',bench:'Bench',lead:'Lead plan',matchup:'Matchup plan'};

export default function InboxPage({inbox,data,load,reload,notify,mutate,dataRef}:{inbox:any;data:any;load:()=>Promise<void>;reload:()=>Promise<void>;notify:(s:string,e?:boolean)=>void;mutate:(a:any,o?:any)=>Promise<any>;dataRef:{current:any}}){
  const [linking,setLinking]=useState<any>(null);
  if(!inbox)return <><Back/><Empty>Checking what is waiting…</Empty></>;
  const refresh=async()=>{await load();await reload();};
  const guard=async(fn:()=>Promise<void>)=>{try{await fn();}catch(e){notify((e as Error).message,true);}};
  const game=(i:any)=>data.games.find((g:any)=>g.id===i.replayId)??{id:i.replayId,association:null,suggestions:i.candidateTeamIds??[]};
  const act={
    link:(i:any,teamId:string,name:string)=>guard(async()=>{await api('/associate',{revision:data.db.revision,replayId:i.replayId,teamId,certainty:'auto'});await refresh();
      notify(`Linked to ${name} by its six. That is consistent with the game, not confirmation of your spreads; confirm exact sets from the team's Replays tab.`);}),
    remove:(i:any)=>guard(async()=>{if(!confirm('Delete this replay, its summary and its link to the team? This cannot be undone.'))return;await api('/replay-delete',{replayId:i.replayId});await refresh();notify('Replay deleted.');}),
    dismissNotice:(i:any)=>guard(async()=>{await api('/inbox/dismiss',{id:i.noticeId});await reload();}),
    dismissCalc:(i:any)=>guard(async()=>{await api('/assistant-calcs/remove',{id:i.calcId});await reload();}),
  };
  return <><Back/><Panel title="Inbox" kicker={inbox.count?`${inbox.count} waiting on you`:"Waiting on you"} className="inbox-page">
    {!inbox.count&&!inbox.items.length?<p className="muted">Nothing needs an action from you.</p>:null}
    {GROUPS.map(([group,title])=>{const items=inbox.items.filter((i:any)=>groupOf(i)===group);if(!items.length)return null;
      return <section key={group} className="inbox-section" aria-label={title}><h3 className="inbox-h">{title}<span className="inbox-n">{items.length}</span></h3>
        <ul className="inbox-list">{items.map((i:any)=><li key={i.id} className={'inbox-item '+i.kind}>{
          i.kind==='unlinked-replay'?<Unlinked i={i} art={data.art} teams={data.teams} link={act.link} choose={()=>setLinking(game(i))} remove={()=>void act.remove(i)}/>
          :i.kind==='suggestion'?<Suggestion i={i} data={data} mutate={mutate} dataRef={dataRef} notify={notify}/>
          :i.kind==='summaries'?<Summaries i={i} art={data.art} notify={notify} refresh={refresh}/>
          :i.kind==='calc'?<CalcItem i={i} art={data.art} data={data} mutate={mutate} notify={notify} dismiss={()=>void act.dismissCalc(i)}/>
          :<><div className="inbox-head"><span className={'tag'+(i.level==='warning'?' warn':'')}>{i.level==='warning'?<><Px icon={WarningDiamond} size={12}/>Warning</>:'Info'}</span><b className="inbox-title">{i.title}</b></div>
              <p>{i.detail}</p><p className="muted tiny">{date(i.at)}</p>
              <div className="button-row"><button className="primary" onClick={()=>void act.dismissNotice(i)}><Px icon={Check}/>Dismiss</button>{i.url&&<a className="button" href={i.url} target="_blank" rel="noreferrer">Read more ↗</a>}</div></>}</li>)}</ul></section>;})}
    {linking&&<AssociationDialog game={linking} data={data} close={()=>setLinking(null)} load={refresh} notify={notify}/>}
  </Panel></>;
}
// A side's six the way the Replays tab draws it: the two it led with outlined, the others it brought plain, the ones left behind faded.
function SixRow({list,leads,brought,art}:{list:string[];leads?:string[];brought?:string[];art:any}){
  return <div className="six">{list.map((m:string)=><span key={m} className={leads?.includes(m)?'lead':brought?.includes(m)?'brought':'benched'} title={m}><Art name={m} art={art} small/></span>)}</div>;
}
const Back=()=><a href="#teams" className="text-button back-link"><Px icon={ArrowLeft} size={12}/>Teams</a>;

// One suggestion, as the same tile the chat shows (what changes, highlighted), accepted or dismissed right here.
function Suggestion({i,data,mutate,dataRef,notify}:{i:any;data:any;mutate:(a:any,o?:any)=>Promise<any>;dataRef:{current:any};notify:(s:string,e?:boolean)=>void}){
  const item=(data.db.pending??[]).find((x:any)=>x.id===i.pendingId);const team=data.teams.find((t:any)=>t.id===i.teamId);
  const [state,setState]=useState<{status?:'saving'|'accepted';error?:string}>({});
  if(!item||!team)return null;
  const view=getView(team,data.db,team.activeVersionId);const p:Proposal={...item.proposal,status:state.status,error:state.error};
  const decide=async(yes:boolean)=>{
    if(!yes){await mutate({type:'pending-resolve',id:item.id,outcome:'dismissed'}).catch((e:Error)=>notify(e.message,true));return;}
    setState({status:'saving'});
    try{const note=await acceptProposal(item.proposal,{team,dataRef,mutate,versionId:team.activeVersionId,navigate:false});await mutate({type:'pending-resolve',id:item.id,outcome:'accepted'});if(note)notify(note);}
    catch(e){setState({error:(e as Error).message});}};
  // Where this lands, said plainly: the Bench is a scratchboard and never changes the six.
  const kind=item.proposal.kind;
  const where=kind==='bench'?`Goes on the ${BENCH_LABEL}. Your six does not change.`:kind==='promote'?`Moves ${item.proposal.species} from the ${BENCH_LABEL} into slot ${item.proposal.slot+1}.`:kind==='set'?`Changes slot ${item.proposal.slot+1} of the six.`:kind==='team'?'Saved as a new version; the active one stays.':'';
  return <>
    <div className="inbox-head"><span className="tag">{KIND_LABEL[kind]??'Suggestion'}</span><b className="inbox-title">{i.title}</b></div>
    <p className="muted">For <a href={i.href}>{i.teamName}</a>{i.at?` · ${date(i.at)}`:''} · {i.source==='chat'?'From Ask Frontier Brain':'From your assistant'}{i.detail?` · ${i.detail}`:''}</p>
    {where&&<p className="inbox-where">{where}</p>}
    <div className="inbox-tile"><ProposalCard p={p} art={data.art} current={slot=>view.sets[slot]} decide={yes=>void decide(yes)} rejectLabel="Dismiss" compact/></div></>;
}

// A calc the assistant ran, drawn the way the calc panel draws it: the HP bar for damage, the race for speed.
function CalcItem({i,art,data,mutate,notify,dismiss}:{i:any;art:any;data:any;mutate:(a:any,o?:any)=>Promise<any>;notify:(s:string,e?:boolean)=>void;dismiss:()=>void}){
  const [saving,setSaving]=useState(false);
  const r=i.result,inp=i.input??{};const fb=(s?:string)=>String(s??'').replace(/-Mega(-[A-Z])?$/,'');
  const visual=i.calcKind==='damage'&&Array.isArray(r?.range)&&Array.isArray(r?.percentOfMaxHP)
      ?<DamageViz result={r} name={inp.defender?.species??'Target'} attackerName={inp.attacker?.species??'Attacker'} defender={inp.defender?.species??''} fallback={fb(inp.defender?.species)} move={inp.move??r.move??''} art={art}/>
    :i.calcKind==='speed'&&r?.a!==undefined&&r?.b!==undefined&&inp.a&&inp.b
      ?<SpeedRace a={{name:inp.a.species,fallback:fb(inp.a.species),speed:Number(r.a?.speed??r.a)}} b={{name:inp.b.species,fallback:fb(inp.b.species),speed:Number(r.b?.speed??r.b)}} first={r.first} trickRoom={!!r.trickRoom} art={art} decidedBy={r.decidedBy}/>
    :null;
  // Saving as a benchmark attaches it to the team's Pokémon in the calc: the attacker (or first speed side) if it is on the team, else the defender.
  const team=data.teams.find((t:any)=>t.id===i.teamId);const view=team?getView(team,data.db,team.activeVersionId):null;
  // The six first, then the team's Bench candidates (they have their own sets too).
  const benchSets:{id:string;bankId:string;revisionId:string;species:string}[]=team?(team.bench??[]).flatMap((b:any)=>{const r=data.db.bank.find((e:any)=>e.id===b.bankId)?.revisions.find((x:any)=>x.id===b.revisionId);return r?[{id:b.id,bankId:b.bankId,revisionId:b.revisionId,species:r.set.species}]:[];}):[];
  const find=(x:any)=>{if(!view||!x?.species)return null;const k=fb(x.species);const n=view.sets.findIndex((s:any)=>fb(s.species)===k);
    if(n>=0)return {name:view.sets[n].species,bankId:view.slots[n].bankId,revisionId:view.slots[n].revisionId};
    const b=benchSets.find(s=>fb(s.species)===k);return b?{name:b.species,bankId:b.bankId,revisionId:b.revisionId}:null;};
  const mk=(side:string,x:any,input:any)=>{const f=find(x);return f?{side,target:f,input}:null;};
  const pick=i.calcKind==='damage'?(mk('attacker',inp.attacker,inp)??mk('defender',inp.defender,inp))
    :i.calcKind==='speed'&&!Array.isArray(inp.pokemon)?(mk('a',inp.a,inp)??mk('a',inp.b,{...inp,a:inp.b,b:inp.a})):null;
  const saveBenchmark=async()=>{if(!pick||!view)return;setSaving(true);
    try{await mutate({type:'benchmark-save',bankId:pick.target.bankId,revisionId:pick.target.revisionId,kind:i.calcKind,input:pick.input,side:pick.side,context:'Calc from your assistant',origin:'Your assistant'});
      await api('/assistant-calcs/remove',{id:i.calcId});notify(`Saved as a benchmark for ${pick.target.name}.`);}
    catch(e){notify((e as Error).message,true);}finally{setSaving(false);}};
  return <><div className="inbox-head"><span className="tag">{i.calcKind==='speed'?'Speed':'Damage'}</span><b className="inbox-title">{i.title}</b></div>
    <p className="muted">{i.teamName?`${i.teamName} · `:''}{i.source==='chat'?'From Ask Frontier Brain':'From your assistant'}{i.at?` · ${date(i.at)}`:''}</p>
    {visual&&<div className="inbox-tile">{visual}</div>}
    {!pick&&<p className="muted">Neither Pokémon is on one of your teams or Benches, so there is nothing to attach a benchmark to.</p>}
    <div className="button-row">{pick&&<button className="primary" disabled={saving} onClick={()=>void saveBenchmark()}>{saving?'Saving…':`Add as benchmark for ${pick.target.name}`}</button>}{i.href&&<a className="button" href={i.href} onClick={()=>leaveOffer(`calc:${i.teamId}:${i.benchId?`bench-${i.benchId}`:i.slot}`,{kind:i.calcKind,input:i.input,from:'Your assistant'})}>Open in calc</a>}<button className="text-button" onClick={dismiss}>Dismiss</button></div></>;
}

// Games linked to a team with no summary yet: who each was against and both sixes, with the way to get them summarised.
function Summaries({i,art,notify,refresh}:{i:any;art:any;notify:(s:string,e?:boolean)=>void;refresh:()=>Promise<void>}){
  const [copied,setCopied]=useState(false),[busy,setBusy]=useState(false);
  const six=(list:string[])=><div className="six">{list.map((m:string)=><span key={m} title={m}><Art name={m} art={art} small/></span>)}</div>;
  const go=async()=>{setBusy(true);try{if(!(await aiReady())){notify('No AI key is connected here. Add one in Settings, or ask your assistant over MCP (copy the request below).',true);return;}
    await api('/replay-summarise',{teamId:i.teamId,gameIds:i.replayIds});await refresh();notify('Summarised.');}catch(e){notify((e as Error).message,true);}finally{setBusy(false);}};
  return <><div className="inbox-head"><span className="tag">{i.count}</span><b className="inbox-title">{i.teamName}</b></div>
    <p className="muted">{i.title}.</p>
    {(i.games??[]).length>0&&<ul className="inbox-games">{i.games.map((g:any)=><li key={g.id} className={'game '+g.result}>
      <div className="game-top"><span className={'result '+g.result}>{g.result}</span><span className="muted">{g.date?date(g.date):''} · vs {g.opponent}</span></div>
      <div className="selections"><div><span className="eyebrow">You</span><SixRow list={g.yours} leads={g.yoursLeads} brought={g.yoursBrought} art={art}/></div><div><span className="eyebrow">Opponent</span><SixRow list={g.theirs} leads={g.theirsLeads} brought={g.theirsBrought} art={art}/></div></div></li>)}
      {i.count>i.games.length&&<li className="muted">and {i.count-i.games.length} more</li>}</ul>}
    <p className="footnote">Outlined: led with. Faded: not brought.</p>
    <div className="button-row"><button className="primary" disabled={busy} onClick={()=>void go()}><Px icon={Sparkles}/>{busy?'Summarising…':`Summarise ${i.count}`}</button><a className="button" href={i.href}>Open Replays</a>
      <button onClick={()=>{void navigator.clipboard.writeText(i.request).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{});}}><Px icon={copied?Check:Copy}/>{copied?'Copied':'Copy request for your assistant'}</button></div></>;
}

// One unlinked game: who it was against, both sixes, why it did not link (from the link logic) and what to do.
function Unlinked({i,art,teams,link,choose,remove}:{i:any;art:any;teams:any[];link:(i:any,teamId:string,name:string)=>void;choose:()=>void;remove:()=>void}){
  const one=i.reason==='matches-one'?teams.find(t=>t.id===i.candidateTeamIds[0]):null;
  const six=(label:string,list:string[],leads:string[],brought:string[])=><div><span className="eyebrow">{label}</span><SixRow list={list} leads={leads} brought={brought} art={art}/></div>;
  return <>
    <div className="inbox-head"><span className={'result '+i.result}>{i.result}</span><b className="inbox-title">vs {i.opponent}</b><span className="muted">{i.date?date(i.date):''}</span></div>
    <div className="selections">{six('You',i.yours,i.yoursLeads??[],i.yoursBrought??[])}{six('Opponent',i.theirs,i.theirsLeads??[],i.theirsBrought??[])}</div>
    <p className="inbox-why">{i.why}</p>
    {i.reason==='no-match'&&i.closest.length>0&&<ul className="inbox-diff">{i.closest.slice(0,2).map((c:any)=><li key={c.teamId}><b>{c.name}</b>: {c.missing.length?`the game had ${c.missing.join(', ')}`:'every Pokémon in the game is on it'}{c.extra.length?`; it has ${c.extra.join(', ')} instead`:''}.</li>)}</ul>}
    <div className="button-row">{one?<><button className="primary" onClick={()=>link(i,one.id,one.name)}>Link to {one.name}</button><button onClick={choose}>Choose another team</button></>
      :<button className="primary" onClick={choose}>Link to a team</button>}
      <button className="text-button danger" onClick={remove}>Delete replay</button></div></>;
}
