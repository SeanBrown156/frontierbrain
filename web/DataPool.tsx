import {useState,useEffect} from 'react';
import {api,Panel,Notice,Art,date} from './ui.tsx';
import {Px,Reload} from './icons.tsx';
import {hostedSite} from './auth.tsx';
const laneNames:Record<string,string>={official:'Official events (Limitless)',online:'Online tournaments (Limitless)',shared:'Shared pastes (VGCPastes, unmatched)'};
// One deduplicated pool of individual teams; every percentage here is computed from it, once.
export default function DataPool({art}:{art:any}){
  const [data,setData]=useState<any>(null),[error,setError]=useState('');
  const load=()=>api('/pool').then(setData).catch(e=>setError(e.message));
  useEffect(()=>{void load();const t=setInterval(()=>void load(),15000);return()=>clearInterval(t);},[]);
  const refresh=async()=>{try{await api('/pool-refresh',{});await load();}catch(e){setError((e as Error).message);}};
  const s=data?.status,o=data?.overview;
  return <div className="data-pool"><Panel title="Data pool" kicker="ONE DEDUPLICATED SET OF TEAMS" action={<button onClick={()=>void refresh()} disabled={data?.refreshing}><Px icon={Reload}/>{data?.refreshing?'Refreshing…':'Refresh now'}</button>}>
    {error&&<p className="error">{error}</p>}{!s?<Notice>The pool hasn't been built yet. Refresh to collect teams.</Notice>:<>
    <div className="pool-counts">{(['official','online','shared'] as const).map(l=><div key={l}><b>{s.counts[l==='shared'?'shared':l]}</b><span>{laneNames[l]}</span></div>)}<div><b>{s.counts.mergedSpreads}</b><span>pastes matched to a tournament team (spreads attached)</span></div><div><b>{s.counts.total}</b><span>teams in the pool · {s.counts.withSpreads} with exact spreads</span></div></div>
    <p className="footnote">Refreshed {date(s.refreshedAt)} {new Date(s.refreshedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}. {hostedSite?'Updates weekly':'Updates every 12 hours while the app runs'}; finished events and pastes are cached for good. Online events need ≥{s.minPlayers} players. {s.excluded}</p>
    {s.errors?.length>0&&<Notice>Last refresh had problems: {s.errors.join('; ')}</Notice>}</>}</Panel>
    {o&&<div className="team-detail-grid"><Panel title="Most used" kicker={`ACROSS ${o.teams} TEAMS`}><table className="stat-table"><tbody>{o.usage.map((u:any,i:number)=><tr key={u.name}><td>{i+1}</td><td><Art name={u.name} art={art} small/> {u.name}</td><td>{u.percent}%</td><td className="muted">{u.count}</td></tr>)}</tbody></table>
      <h3 className="subhead">Most common pairs</h3><table className="stat-table"><tbody>{o.cores.map((c:any)=><tr key={c.name}><td>{c.name}</td><td>{c.percent}%</td></tr>)}</tbody></table></Panel>
      <Panel title="Recent top-4 teams" kicker="OFFICIAL AND ONLINE">{o.bestTeams.map((t:any,i:number)=><article key={i} className="pool-team"><div className="team-six">{t.pokemon.map((p:string)=><Art key={p} name={p} art={art} small/>)}</div><p><b>{t.placing===1?'1st':t.placing===2?'2nd':t.placing===3?'3rd':`${t.placing}th`}</b> {t.player} · <a href={t.source} target="_blank" rel="noreferrer">{t.event} ↗</a> <span className="muted">{t.lane}{t.players?` · ${t.players} players`:''} · {t.date}{t.hasSpreads?' · spreads known':''}</span></p></article>)}</Panel></div>}
  </div>;
}
