import {useState,useEffect,useLayoutEffect,useRef} from 'react';
import {api,Panel,Notice,Art,date,Button} from './ui.tsx';
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
  // On a wide screen the two columns are the same height: Most used shows as many rows as fit beside the top-4 teams.
  const grid=useRef<HTMLDivElement>(null);const [fill,setFill]=useState(false),[rows,setRows]=useState(10);
  useLayoutEffect(()=>{const g=grid.current;if(!g||!o)return;
    const fit=()=>{const two=getComputedStyle(g).gridTemplateColumns.split(' ').length>1;setFill(two);if(!two){setRows(10);return;}
      const panel=g.querySelector('.pool-col-left>*') as HTMLElement|null,table=panel?.querySelector('table'),trs=table?.querySelectorAll('tr');if(!panel||!table||!trs?.length)return;
      const rowH=trs.length>1?trs[1].getBoundingClientRect().top-trs[0].getBoundingClientRect().top:trs[0].getBoundingClientRect().height;
      const p=panel.getBoundingClientRect(),t=table.getBoundingClientRect();const chrome=(t.top-p.top)+parseFloat(getComputedStyle(panel).paddingBottom||'0');
      setRows(Math.max(5,Math.min(o.usage.length,Math.floor((p.height-chrome)/rowH))));};
    fit();const ro=new ResizeObserver(fit);ro.observe(g);return()=>ro.disconnect();},[o,fill]);
  return <div className="data-pool"><Panel title="Data pool" kicker="ONE DEDUPLICATED SET OF TEAMS" action={hostedSite?undefined:<Button onClick={()=>void refresh()} disabled={data?.refreshing}><Px icon={Reload}/>{data?.refreshing?'Refreshing…':'Refresh now'}</Button>}>
    {error&&<p className="error">{error}</p>}{!s?<Notice>The pool hasn't been built yet. Refresh to collect teams.</Notice>:<>
    <div className="pool-counts">{(['official','online','shared'] as const).map(l=><div key={l}><b>{s.counts[l==='shared'?'shared':l]}</b><span>{laneNames[l]}</span></div>)}<div><b>{s.counts.mergedSpreads}</b><span>pastes matched to a tournament team (spreads attached)</span></div><div><b>{s.counts.total}</b><span>teams in the pool · {s.counts.withSpreads} with exact spreads</span></div></div>
    <p className="footnote">Refreshed {date(s.refreshedAt)} {new Date(s.refreshedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}. {hostedSite?'Updates weekly':'Updates every 12 hours while the app runs'}; finished events and pastes are cached for good. Online events need ≥{s.minPlayers} players. {s.excluded}</p>
    {s.errors?.length>0&&<Notice>Last refresh had problems: {s.errors.join('; ')}</Notice>}</>}</Panel>
    {o&&<div ref={grid} className={"team-detail-grid pool-top"+(fill?" pool-fill":"")}><div className="pool-col pool-col-left"><Panel title="Most used" kicker={`ACROSS ${o.teams} TEAMS`}><table className="stat-table"><tbody>{o.usage.slice(0,fill?Math.max(rows,1):10).map((u:any,i:number)=><tr key={u.name}><td>{i+1}</td><td><Art name={u.name} art={art} small/> {u.name}</td><td>{u.percent}%</td><td className="muted">{u.count}</td></tr>)}</tbody></table>
</Panel></div>
      <div className="pool-col"><Panel title="Recent top-4 teams" kicker="OFFICIAL AND ONLINE">{o.bestTeams.map((t:any,i:number)=><article key={i} className="pool-team"><div className="team-six">{t.pokemon.map((p:string)=><Art key={p} name={p} art={art}/>)}</div>
        <p className="pool-team-who"><span className={'pool-place place-'+Math.min(t.placing,4)}>{t.placing===1?'1st':t.placing===2?'2nd':t.placing===3?'3rd':`${t.placing}th`}</span><b>{t.player}</b></p>
        <p className="pool-team-event"><a href={t.source} target="_blank" rel="noreferrer">{t.event} ↗</a></p>
        <p className="pool-team-meta muted">{t.lane}{t.players?` · ${t.players} players`:''} · {t.date}{t.hasSpreads?' · spreads known':''}</p></article>)}</Panel></div></div>}
    {o?.cores?.length>0&&<Panel title="Most common pairs" kicker={`ACROSS ${o.teams} TEAMS`}><div className="pair-grid">{o.cores.map((c:any)=>{const [a,b]=String(c.name).split(' + ');return <article key={c.name} className="pair-card"><div className="pair-art"><Art name={a} art={art}/><Art name={b} art={art}/></div><h3>{a} <span className="muted">+</span> {b}</h3><p><b>{c.percent}%</b> <span className="muted">of teams · {c.count}</span></p></article>;})}</div></Panel>}
  </div>;
}
