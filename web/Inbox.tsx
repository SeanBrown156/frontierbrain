import {useState,useEffect,useCallback} from 'react';
import {Inbox as InboxIcon} from 'lucide-react';
import {api,Art,Panel,Empty,date} from './ui.tsx';
import {Px,Sparkles,Check,Copy,ArrowLeft,WarningDiamond} from './icons.tsx';
import {hostedSite} from './auth.tsx';
import {AssociationDialog} from './Coach.tsx';

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

const SECTIONS:[string,string,string][]=[
  ['unlinked-replay','Replays with no team','Saved, but no team can see them. Link each to a team, or delete it.'],
  ['suggestion','Suggestions from your assistant','Not applied until you accept them on the team page.'],
  ['summaries','Replays waiting for a summary','Linked to a team, with no summary yet.'],
  ['calc','Calcs from your assistant','Run for you over the connector. They open in the calc panel on the Pokémon page.'],
  ['notice','Notices','Changes to the rules or data that may affect your teams.']];
const KIND_LABEL:Record<string,string>={set:'Set',team:'Team',strategy:'Strategy',promote:'Promote',bench:'Bench',lead:'Lead plan',matchup:'Matchup plan',objective:'To-do'};

export default function InboxPage({inbox,data,load,reload,notify,openDock}:{inbox:any;data:any;load:()=>Promise<void>;reload:()=>Promise<void>;notify:(s:string,e?:boolean)=>void;openDock:()=>void}){
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
  return <><Back/><Panel title="Inbox" kicker="WAITING ON YOU" className="inbox-page">
    {!inbox.count?<p className="muted">Nothing needs an action from you.</p>
      :<p className="muted">{inbox.count} action{inbox.count===1?'':'s'} waiting. Newest first within each group.</p>}
    {SECTIONS.map(([kind,title,hint])=>{const items=inbox.items.filter((i:any)=>i.kind===kind);if(!items.length)return null;
      return <section key={kind} className="inbox-section" aria-label={title}><h3 className="inbox-h">{title}<span className="inbox-n">{items.length}</span></h3><p className="muted tiny">{hint}</p>
        <ul className="inbox-list">{items.map((i:any)=><li key={i.id} className={'inbox-item '+kind}>{
          kind==='unlinked-replay'?<Unlinked i={i} art={data.art} teams={data.teams} link={act.link} choose={()=>setLinking(game(i))} remove={()=>void act.remove(i)}/>
          :kind==='suggestion'?<><div className="inbox-head"><span className="tag">{KIND_LABEL[i.proposalKind]??'Suggestion'}</span><b className="inbox-title">{i.title}</b></div>
              <p className="muted">For <a href={i.href}>{i.teamName}</a>{i.at?` · ${date(i.at)}`:''}{i.detail?`: ${i.detail}`:''}</p>
              <div className="button-row"><a className="button primary" href={i.href} onClick={openDock}><Px icon={Sparkles}/>Review and accept</a></div></>
          :kind==='summaries'?<Summaries i={i}/>
          :kind==='calc'?<><div className="inbox-head"><span className="tag">{i.calcKind==='speed'?'Speed':'Damage'}</span><b className="inbox-title">{i.title}</b></div>
              {i.href?<p className="muted">Opens on {i.teamName}'s Pokémon page, in "From your assistant".</p>:<p className="muted">None of its Pokémon are on your teams, so it has no page to open on.</p>}
              <div className="button-row">{i.href&&<a className="button primary" href={i.href}>Open in calc</a>}<button className="text-button" onClick={()=>void act.dismissCalc(i)}>Dismiss</button></div></>
          :<><div className="inbox-head"><span className={'tag'+(i.level==='warning'?' warn':'')}>{i.level==='warning'?<><Px icon={WarningDiamond} size={12}/>Warning</>:'Info'}</span><b className="inbox-title">{i.title}</b></div>
              <p>{i.detail}</p><p className="muted tiny">{date(i.at)}</p>
              <div className="button-row"><button className="primary" onClick={()=>void act.dismissNotice(i)}><Px icon={Check}/>Dismiss</button>{i.url&&<a className="button" href={i.url} target="_blank" rel="noreferrer">Read more ↗</a>}</div></>}</li>)}</ul></section>;})}
    {linking&&<AssociationDialog game={linking} data={data} close={()=>setLinking(null)} load={refresh} notify={notify}/>}
  </Panel></>;
}
const Back=()=><a href="#teams" className="text-button back-link"><Px icon={ArrowLeft} size={12}/>Teams</a>;

function Summaries({i}:{i:any}){
  const [copied,setCopied]=useState(false);
  return <><div className="inbox-head"><span className="tag">{i.count}</span><b className="inbox-title">{i.teamName}</b></div>
    <p className="muted">{i.title}. Ask the assistant you connected over MCP, or summarise them from the Replays tab.</p>
    <p className="waiting-ask"><q>{i.request}</q></p>
    <div className="button-row"><a className="button primary" href={i.href}>Open Replays</a>
      <button onClick={()=>{void navigator.clipboard.writeText(i.request).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{});}}><Px icon={copied?Check:Copy}/>{copied?'Copied':'Copy request'}</button></div></>;
}

// One unlinked game: who it was against, both sixes, why it did not link (from the link logic) and what to do.
function Unlinked({i,art,teams,link,choose,remove}:{i:any;art:any;teams:any[];link:(i:any,teamId:string,name:string)=>void;choose:()=>void;remove:()=>void}){
  const one=i.reason==='matches-one'?teams.find(t=>t.id===i.candidateTeamIds[0]):null;
  const six=(label:string,list:string[])=><div><span className="eyebrow">{label}</span><div className="six">{list.map((m:string)=><span key={m} title={m}><Art name={m} art={art} small/></span>)}</div></div>;
  return <>
    <div className="inbox-head"><span className={'result '+i.result}>{i.result}</span><b className="inbox-title">vs {i.opponent}</b><span className="muted">{i.date?date(i.date):''}</span></div>
    <div className="selections">{six('Your six',i.yours)}{six('Their six',i.theirs)}</div>
    <p className="inbox-why">{i.why}</p>
    {i.reason==='no-match'&&i.closest.length>0&&<ul className="inbox-diff">{i.closest.slice(0,2).map((c:any)=><li key={c.teamId}><b>{c.name}</b>: {c.missing.length?`the game had ${c.missing.join(', ')}`:'every Pokémon in the game is on it'}{c.extra.length?`; it has ${c.extra.join(', ')} instead`:''}.</li>)}</ul>}
    <div className="button-row">{one?<><button className="primary" onClick={()=>link(i,one.id,one.name)}>Link to {one.name}</button><button onClick={choose}>Choose another team</button></>
      :<button className="primary" onClick={choose}>Link to a team</button>}
      <button className="text-button danger" onClick={remove}>Delete replay</button></div></>;
}
