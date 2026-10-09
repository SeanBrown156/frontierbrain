import {useState,useEffect,useRef} from 'react';
import {api,Art,Modal,date,pct,downloadOriginal} from '../ui.tsx';
import {Px,Upload,Sparkles,Reload} from '../icons.tsx';
import SpeciesPicker from '../ai/SpeciesPicker.tsx';
import {AssociationDialog} from '../Coach.tsx';
import {record} from './Hub.tsx';
import {versionName} from './editors.tsx';

const category:Record<string,string>={play:'Play',building:'Team',variance:'Luck'};
const other=(g:any)=>g.ownSide==='p1'?'p2':'p1';
// The team's replays on one page: what to work on (AI digest), add replays, filter by opponent Pokémon or style,
// and one card per game with its AI summary. Details, the turn-by-turn log and link changes open per game.
export default function Replays({team,data,versionId,load,notify}:{team:any;data:any;versionId:string;load:()=>Promise<void>;notify:(s:string,e?:boolean)=>void}){
  const all=versionId==='all';const games=data.games.filter((g:any)=>g.association?.teamId===team.id&&(all||g.association?.versionId===versionId)).sort((a:any,b:any)=>(b.date??'').localeCompare(a.date??''));
  const [info,setInfo]=useState<any>({summaries:{},digest:null,running:[]}),[mons,setMons]=useState<string[]>([]),[styles,setStyles]=useState<string[]>([]),[result,setResult]=useState(''),[open,setOpen]=useState<string|null>(null);
  const refresh=async()=>{try{setInfo(await api('/replay-summaries?team='+team.id));}catch{}};
  useEffect(()=>{void refresh();},[team.id,games.length]);
  useEffect(()=>{if(!info.running.length)return;const t=setInterval(()=>void refresh(),3000);return()=>clearInterval(t);},[info.running.length]);
  const summarise=async(gameIds:string[])=>{try{await api('/replay-summarise',{teamId:team.id,gameIds});await refresh();}catch(e){notify((e as Error).message,true);}};
  const shown=games.filter((g:any)=>(!result||g.result===result)&&mons.every(m=>g.preview[other(g)].includes(m))&&styles.every(s=>info.summaries[g.id]?.opponentStyle?.includes(s)));
  const styleOptions=[...new Set(Object.values<any>(info.summaries).flatMap(s=>s.opponentStyle))];
  const missing=games.filter((g:any)=>!info.summaries[g.id]).map((g:any)=>g.id);const busy=info.running.length>0;
  return <div className="replays">
    <Digest team={team} games={games} info={info} busy={busy} refresh={()=>void summarise([])} art={data.art}/>
    <AddReplays team={team} versionId={all?team.activeVersionId:versionId} load={load} notify={notify} after={()=>setTimeout(()=>void refresh(),800)}/>
    {games.length>0&&<div className="replay-filters">
      <div className="opponent-filter"><SpeciesPicker label="Opponent Pokémon" placeholder="Opponent had…" value="" onPick={sp=>setMons(m=>m.includes(sp)?m:[...m,sp])}/>{mons.map(m=><button key={m} className="chip on" onClick={()=>setMons(mons.filter(x=>x!==m))}>{m} ×</button>)}</div>
      {styleOptions.length>0&&<div className="chip-row">{styleOptions.map(s=><button key={s} className={'chip'+(styles.includes(s)?' on':'')} onClick={()=>setStyles(styles.includes(s)?styles.filter(x=>x!==s):[...styles,s])}>{s}</button>)}</div>}
      <div className="segmented" role="group" aria-label="Result">{[['','All'],['win','Wins'],['loss','Losses']].map(([v,l])=><button key={v} className={result===v?'on':''} onClick={()=>setResult(v)}>{l}</button>)}</div>
    </div>}
    {missing.length>0&&!busy&&<p className="footnote">{missing.length} game{missing.length===1?' has':'s have'} no summary yet. <button className="text-button" onClick={()=>void summarise(missing)}>Summarise {missing.length===1?'it':'them'}</button></p>}
    <div className="replay-list">{shown.map((g:any)=><GameCard key={g.id} g={g} s={info.summaries[g.id]} pending={busy&&!info.summaries[g.id]} art={data.art} open={()=>setOpen(g.id)}/>)}
      {games.length>0&&!shown.length&&<p className="muted">No games match these filters.</p>}</div>
    {games.length>=3&&<Patterns games={shown}/>}
    {open&&<GameDrawer g={games.find((x:any)=>x.id===open)} s={info.summaries[open]} team={team} data={data} load={load} notify={notify} close={()=>setOpen(null)} resummarise={()=>void summarise([open])}/>}
  </div>;
}

function Digest({team,games,info,busy,refresh,art}:{team:any;games:any[];info:any;busy:boolean;refresh:()=>void;art:any}){
  const r=record(games);const d=info.digest;const seen:Record<string,number>={};for(const g of games)for(const m of g.preview[other(g)])seen[m]=(seen[m]??0)+1;const common=Object.entries(seen).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return <section className="digest panel"><header className="digest-head"><div><h2>What to work on</h2><span className="muted">{r.n?`${r.label} in ${r.n} game${r.n===1?'':'s'}`:'No games yet'}{d?` · from ${d.games} summarised games · ${d.model} · ${date(d.createdAt)}`:''}</span></div>
      {r.n>=2&&<button onClick={refresh} disabled={busy}>{busy?<><Px icon={Sparkles}/>Updating…</>:<><Px icon={Reload}/>Refresh</>}</button>}</header>
    {!d?<p className="muted">{r.n<2?'Add a couple of replays and Frontier Brain will summarise each game and pull out the patterns here.':busy?'Summarising your games…':'Summarise your games to see patterns.'}</p>
      :<ol className="themes">{d.themes.map((t:any,i:number)=><li key={i}><b>{t.title}</b> <span className="tag">{t.count} of {t.total} {t.of}</span><p>{t.detail}</p></li>)}</ol>}
    {d?.strengths?.length>0&&<p className="strengths"><b>Working well:</b> {d.strengths.join(' · ')}</p>}
    {common.length>0&&<div className="common"><span className="muted">Faced most:</span>{common.map(([m,n])=><span key={m} className="common-mon" title={`${m}: ${n} game${n===1?'':'s'}`}><Art name={m} art={art} small/><small>{n}</small></span>)}</div>}
    {r.n>0&&r.n<5&&<p className="footnote">{r.n} game{r.n===1?'':'s'} is a small sample: treat these as things to test, not verdicts.</p>}
  </section>;
}

function GameCard({g,s,pending,art,open}:{g:any;s:any;pending:boolean;art:any;open:()=>void}){
  const o=other(g);
  return <article className={'game '+g.result} onClick={open} onKeyDown={e=>{if(e.key==='Enter')open();}} tabIndex={0} role="button" aria-label={`${g.result} vs ${g.players[o].name}`}>
    <div className="game-top"><span className={'result '+g.result}>{g.result}</span><span className="muted">{g.date?date(g.date):''} · vs {g.players[o].name}</span>{s?.stale&&<span className="tag">link changed</span>}</div>
    <div className="game-teams"><div className="six">{g.preview[o].map((m:string)=><span key={m} className={g.leads[o].includes(m)?'lead':g.revealed[o].includes(m)?'brought':'benched'} title={m}><Art name={m} art={art} small/></span>)}</div></div>
    {s?<><p className="game-summary">{s.summary}</p>{s.workOn.length>0&&<ul className="work-on">{s.workOn.slice(0,2).map((w:any,i:number)=><li key={i}><span className={'cat '+w.category}>{category[w.category]}</span>{w.title}</li>)}</ul>}
      {s.opponentStyle.length>0&&<div className="chip-row">{s.opponentStyle.map((t:string)=><span key={t} className="chip small">{t}</span>)}</div>}</>
      :<p className="muted">{pending?'Summarising…':'No summary yet.'}</p>}
  </article>;
}

function GameDrawer({g,s,team,data,load,notify,close,resummarise}:{g:any;s:any;team:any;data:any;load:()=>Promise<void>;notify:(s:string)=>void;close:()=>void;resummarise:()=>void}){
  const [log,setLog]=useState(''),[linking,setLinking]=useState(false),[turn,setTurn]=useState<number|null>(null);const box=useRef<HTMLPreElement>(null);const o=other(g);
  useEffect(()=>{api('/replay-transcript?id='+encodeURIComponent(g.id)).then(r=>setLog(r.transcript)).catch(()=>{});},[g.id]);
  useEffect(()=>{if(turn===null||!box.current)return;const el=box.current.querySelector(`[data-turn="${turn}"]`);el?.scrollIntoView({block:'start',behavior:'smooth'});},[turn,log]);
  const v=team.versions.find((x:any)=>x.id===g.association?.versionId);const config=v?.configurations.findIndex((c:any)=>c.id===g.association?.configurationId);
  const lines=log.split('\n');
  return <Modal title={`${g.result==='win'?'Win':g.result==='loss'?'Loss':g.result} vs ${g.players[o].name}`} onClose={close}><div className="game-drawer">
    <p className="muted">{g.date?date(g.date):''} · {v?versionName(v):'no version'}{g.association?.certainty==='exact'&&config>=0?` · exact sets (edit ${config+1})`:' · sets not confirmed'} · <button className="text-button" onClick={()=>setLinking(true)}>Change link</button> · <button className="text-button" onClick={()=>void downloadOriginal(g.id)}>Original replay ↓</button></p>
    <div className="selections">{[[g.ownSide,'You'],[o,'Opponent']].map(([side,label])=><div key={side}><span className="eyebrow">{label}</span><div className="six">{g.preview[side].map((m:string)=><span key={m} className={g.leads[side].includes(m)?'lead':g.revealed[side].includes(m)?'brought':'benched'} title={m}><Art name={m} art={data.art} small/></span>)}</div></div>)}<p className="footnote">Leads are outlined; faded Pokémon weren't seen in battle.</p></div>
    {s?<><p className="game-summary big">{s.summary}</p>
      {s.workOn.length>0&&<><h3>Work on</h3><ul className="work-on full">{s.workOn.map((w:any,i:number)=><li key={i}><span className={'cat '+w.category}>{category[w.category]}</span><b>{w.title}</b>{w.turn&&<button className="text-button" onClick={()=>setTurn(w.turn)}>turn {w.turn}</button>}<p>{w.detail}</p></li>)}</ul></>}
      {s.keyMoments.length>0&&<><h3>Key moments</h3><ol className="moments">{s.keyMoments.map((m:any,i:number)=><li key={i}><button className="text-button" onClick={()=>setTurn(m.turn)}>Turn {m.turn}</button> {m.text}</li>)}</ol></>}
      <p className="model-line">{s.model} · {date(s.createdAt)} · team sets: {s.setsBasis}{s.stale?' · the link changed since':''} · <button className="text-button" onClick={resummarise}>Re-summarise</button></p></>
      :<p className="muted">No summary yet. <button className="text-button" onClick={resummarise}>Summarise this game</button></p>}
    <details open={turn!==null} onToggle={e=>{if(!(e.target as HTMLDetailsElement).open)setTurn(null);}}><summary>Turn by turn</summary><pre ref={box} className="transcript">{lines.map((l,i)=>{const m=/^Turn (\d+):/.exec(l);return <span key={i} data-turn={m?.[1]} className={m&&Number(m[1])===turn?'hl':''}>{l}{'\n'}</span>;})}</pre></details>
  </div>{linking&&<AssociationDialog game={g} data={data} close={()=>setLinking(false)} load={load} notify={notify}/>}</Modal>;
}

function AddReplays({team,versionId,load,notify,after}:{team:any;versionId:string;load:()=>Promise<void>;notify:(s:string,e?:boolean)=>void;after:()=>void}){
  const [links,setLinks]=useState(''),[files,setFiles]=useState<File[]>([]),[exact,setExact]=useState(false),[busy,setBusy]=useState(false),[results,setResults]=useState<any[]>([]);
  const v=team.versions.find((x:any)=>x.id===versionId)??team.versions.at(-1);
  const submit=async()=>{setBusy(true);setResults([]);try{const items=[...links.split(/\s+/).filter(l=>l.startsWith('http')).map(url=>({url})),...await Promise.all(files.map(async f=>({name:f.name,html:await f.text()})))];
      const r=await api('/replays',{items,association:{teamId:team.id,versionId:v.id,configurationId:v.currentConfigurationId,certainty:exact?'exact':'family',confirm:exact}});await load();
      const ok=r.results.filter((x:any)=>x.ok).length;setResults(r.results.filter((x:any)=>!x.ok||x.note));notify(`${ok} of ${r.results.length} replay(s) added to ${versionName(v)}. Summaries are on the way.`);if(ok===r.results.length){setLinks('');setFiles([]);}after();}catch(e){notify((e as Error).message,true);}finally{setBusy(false);}};
  return <section className="add-replays"><div className="add-row"><textarea rows={links.includes('\n')?3:1} value={links} onChange={e=>setLinks(e.target.value)} placeholder="Paste Showdown replay links (one per line)" aria-label="Showdown replay links"/>
      <label className="button file-button"><Px icon={Upload}/>{files.length?`${files.length} file${files.length===1?'':'s'}`:'HTML files'}<input className="file-input" type="file" multiple accept=".html,.htm" onChange={e=>setFiles([...(e.target.files??[])])}/></label>
      <button className="primary" disabled={busy||(!links.trim()&&!files.length)} onClick={()=>void submit()}>{busy?'Adding…':'Add replays'}</button></div>
    <label className="radio exact"><input type="checkbox" checked={exact} onChange={e=>setExact(e.target.checked)}/>I played exactly the current {versionName(v)} sets</label>
    {results.map((r,i)=><p key={i} className={r.ok?'footnote':'error'}>{r.label.replace('https://replay.pokemonshowdown.com/','')}: {r.ok?`linked by team only (${r.note})`:r.error}</p>)}
  </section>;
}

function Patterns({games}:{games:any[]}){
  const [stats,setStats]=useState<any>(null);const ids=games.map(g=>g.id).join(',');
  useEffect(()=>{let alive=true;api('/coach-stats?ids='+encodeURIComponent(ids)).then(s=>{if(alive)setStats(s);}).catch(()=>{});return()=>{alive=false;};},[ids]);
  const leads=Object.entries<any>(stats?.leads??{}).sort((a,b)=>b[1].games-a[1].games).slice(0,8);const opps=Object.entries<any>(stats?.matchups??{}).sort((a,b)=>b[1].preview-a[1].preview).slice(0,10);
  return <details className="patterns"><summary>Patterns across {games.length} games</summary><div className="patterns-grid">
    <div><h3>Your leads</h3><table><tbody>{leads.map(([pair,r])=><tr key={pair}><td>{pair}</td><td>{r.wins}–{r.losses}</td><td className="muted">{r.games>=5?pct(r.wins,r.games):`n=${r.games}`}</td></tr>)}</tbody></table></div>
    <div><h3>Opponents</h3><table><tbody>{opps.map(([m,r])=><tr key={m}><td>{m}</td><td>{r.previewWins}–{r.preview-r.previewWins}</td><td className="muted">{r.preview>=5?pct(r.previewWins,r.preview):`n=${r.preview}`}</td></tr>)}</tbody></table></div>
  </div><p className="footnote">Below 5 games a record is an observation, not a diagnosis.</p></details>;
}
