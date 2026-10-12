import ShowdownName from './ShowdownName.tsx';
import {useAccount,canUseAI,requireAccount} from '../auth.tsx';
import {aiReady} from '../ai/AssistDock.tsx';
import {useState,useEffect,useLayoutEffect,useRef,useId,useMemo,type RefObject} from 'react';
import {Search,Tag} from 'lucide-react';
import {api,Art,Modal,date,downloadOriginal,sentences,useDex,TYPE_COLOURS,PokeIcon} from '../ui.tsx';
import {Px,Upload,Sparkles,ChevronDown,Close,Check} from '../icons.tsx';
import {speciesOptions} from '../ai/SpeciesPicker.tsx';
import {AssociationDialog} from '../Coach.tsx';
import {record} from './Hub.tsx';
import {versionName} from './editors.tsx';

const category:Record<string,string>={play:'Play',building:'Team',variance:'Luck'};
const other=(g:any)=>g.ownSide==='p1'?'p2':'p1';
// The team's replays on one page: what to work on (AI digest), add replays, filter by opponent Pokémon or style,
// and one card per game with its AI summary. Details, the turn-by-turn log and link changes open per game.
export default function Replays({team,data,versionId,load,notify}:{team:any;data:any;versionId:string;load:()=>Promise<void>;notify:(s:string,e?:boolean)=>void}){
  const all=versionId==='all';const games=data.games.filter((g:any)=>g.association?.teamId===team.id&&(all||g.association?.versionId===versionId)).sort((a:any,b:any)=>(b.date??'').localeCompare(a.date??''));
  const [info,setInfo]=useState<any>({summaries:{},digest:null,running:[]}),[picked,setPicked]=useState<GameTag[]>([]),[result,setResult]=useState(''),[open,setOpen]=useState<string|null>(null);
  const refresh=async()=>{try{setInfo(await api('/replay-summaries?team='+team.id));}catch{}};
  useEffect(()=>{void refresh();},[team.id,games.length]);
  useEffect(()=>{if(!info.running.length)return;const t=setInterval(()=>void refresh(),3000);return()=>clearInterval(t);},[info.running.length]);
  const ai=canUseAI(useAccount());const [needAI,setNeedAI]=useState(false);
  const summarise=async(gameIds:string[])=>{if(!ai)return requireAccount('Sign in for free to summarise replays with your preferred AI tool.');if(!(await aiReady())){setNeedAI(true);return;}try{await api('/replay-summarise',{teamId:team.id,gameIds});await refresh();}catch(e){notify((e as Error).message,true);}};
  const tags=new Map<string,Set<string>>(games.map((g:any)=>[g.id,new Set(gameTags(g,info.summaries[g.id]).map(tagKey))]));
  const shown=games.filter((g:any)=>(!result||g.result===result)&&picked.every(t=>tags.get(g.id)!.has(tagKey(t))));
  const missing=games.filter((g:any)=>!info.summaries[g.id]).map((g:any)=>g.id);const busy=info.running.length>0;
  return <div className="replays">{!data.profile?.player&&<ShowdownName reload={load}/>}
    <Digest team={team} games={games} info={info} busy={busy} refresh={()=>void summarise([])} art={data.art}/>
    <AtAGlance games={games} info={info} art={data.art}/>
    <AddReplays team={team} versionId={all?team.activeVersionId:versionId} load={load} notify={notify} after={()=>setTimeout(()=>void refresh(),800)} locked={!data.profile?.player}/>
    {games.length>0&&<div className="replay-filters rf">
      <div className="rf-find"><TagSearch games={games} summaries={info.summaries} value={picked} onChange={setPicked}/></div>
      <div className="segmented rf-result" role="group" aria-label="Result">{[['','All'],['win','Wins'],['loss','Losses']].map(([v,l])=><button key={v} className={result===v?'on':''} aria-pressed={result===v} onClick={()=>setResult(v)}>{l}</button>)}</div>
    </div>}
    {missing.length>0&&!busy&&<p className="footnote">{missing.length} game{missing.length===1?' has':'s have'} no summary yet. <button className="text-button" onClick={()=>void summarise(missing)}><Px icon={Sparkles} size={12}/>Summarise {missing.length===1?'it':'them'}</button></p>}
    <div className="replay-list">{shown.map((g:any)=><GameCard key={g.id} g={g} s={info.summaries[g.id]} pending={busy&&!info.summaries[g.id]} art={data.art} open={()=>setOpen(g.id)}/>)}
      {games.length>0&&!shown.length&&<p className="muted">No games match these filters.</p>}</div>
    {needAI&&<ConnectAI onClose={()=>setNeedAI(false)}/>}
    {open&&<GameDrawer g={games.find((x:any)=>x.id===open)} s={info.summaries[open]} team={team} data={data} load={load} notify={notify} close={()=>setOpen(null)} resummarise={()=>void summarise([open])}/>}
  </div>;
}

// What the replay search can match in one game, as {kind,label,value}: the opponent's team-style tags from the game's
// summary and the Pokémon they showed at team preview. A richer tag vocabulary (issue #16) plugs in here; the search,
// its suggestions and the filter all read from this one function.
interface GameTag {kind:string;label:string;value:string}
const kindLabel:Record<string,string>={style:'Team style',pokemon:'Pokémon'};
function gameTags(g:any,s:any):GameTag[]{
  return [...(s?.opponentStyle??[]).map((t:string)=>({kind:'style',label:t,value:t})),...(g.preview[other(g)] as string[]).map(m=>({kind:'pokemon',label:m,value:m}))];
}
const tagKey=(t:GameTag)=>t.kind+'\u0000'+t.value;
// Box icons by species name, from the species list the pickers already load.
function useIcons(){const [icons,setIcons]=useState<Record<string,number>>({});
  useEffect(()=>{let alive=true;speciesOptions().then(l=>{if(alive)setIcons(Object.fromEntries(l.filter((o:any)=>o.icon!=null).map((o:any)=>[o.name,o.icon])));}).catch(()=>{});return()=>{alive=false;};},[]);return icons;}

// The page's footer stacks above <main>, so a list keeps inside main: it shrinks to the room below, or opens upward.
function useFitList(list:RefObject<HTMLUListElement|null>,deps:unknown[]){
  useLayoutEffect(()=>{const el=list.current;if(!el)return;el.classList.remove('up');el.style.maxHeight='';
    const main=el.closest('main')?.getBoundingClientRect();if(!main)return;const r=el.getBoundingClientRect();const anchor=el.parentElement!.getBoundingClientRect();
    const below=main.bottom-r.top-8,above=anchor.top-main.top-12;
    if(below>=Math.min(r.height,160))el.style.maxHeight=Math.min(320,below)+'px';else{el.classList.add('up');el.style.maxHeight=Math.min(320,Math.max(above,below))+'px';}},deps);
}

// Search the opponent's team: type to get matching tags, pick several (each becomes a chip), and games must match all.
function TagSearch({games,summaries,value,onChange}:{games:any[];summaries:Record<string,any>;value:GameTag[];onChange:(v:GameTag[])=>void}){
  const [text,setText]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0);const id=useId();const input=useRef<HTMLInputElement>(null),list=useRef<HTMLUListElement>(null);const icons=useIcons();
  const options=useMemo(()=>{const m=new Map<string,GameTag&{n:number}>();
    for(const g of games)for(const [k,t] of new Map(gameTags(g,summaries[g.id]).map(t=>[tagKey(t),t]))){const x=m.get(k);if(x)x.n++;else m.set(k,{...t,n:1});}
    return [...m.values()];},[games,summaries]);
  const q=text.trim().toLowerCase();const chosen=new Set(value.map(tagKey));
  const starts=(o:GameTag)=>o.label.toLowerCase().startsWith(q)?0:1;
  const rows=options.filter(o=>!chosen.has(tagKey(o))&&(!q||o.label.toLowerCase().includes(q))).sort((a,b)=>(q?starts(a)-starts(b):0)||b.n-a.n||a.label.localeCompare(b.label)).slice(0,50);
  const shown=open&&rows.length>0;useFitList(list,[shown,rows.length]);
  useEffect(()=>{setActive(0);},[q,open,value.length]);
  useEffect(()=>{list.current?.querySelector('.active')?.scrollIntoView({block:'nearest'});},[active]);
  const add=(t:GameTag)=>{onChange([...value,{kind:t.kind,label:t.label,value:t.value}]);setText('');};
  const remove=(t:GameTag)=>{onChange(value.filter(x=>tagKey(x)!==tagKey(t)));input.current?.focus();};
  return <div className={'rf-search'+(value.length?' has-chips':'')} onMouseDown={e=>{if(e.target===e.currentTarget){e.preventDefault();input.current?.focus();}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
    <span className="rf-search-icon"><Px icon={Search}/></span>
    {value.map(t=><span key={tagKey(t)} className={'rf-chip '+t.kind}>{t.kind==='pokemon'&&<PokeIcon n={icons[t.label]}/>}<span>{t.label}</span>
      <button type="button" aria-label={`Remove ${t.label}`} title={kindLabel[t.kind]??t.kind} onClick={()=>remove(t)}><Px icon={Close} size={12}/></button></span>)}
    <input ref={input} role="combobox" aria-label="Search opponent's team" aria-expanded={shown} aria-controls={id} aria-autocomplete="list" aria-activedescendant={shown?`${id}-${active}`:undefined}
      placeholder={value.length?'':'Search opponent’s team…'} value={text} autoComplete="off" spellCheck={false}
      onFocus={()=>setOpen(true)} onChange={e=>{setText(e.target.value);setOpen(true);}}
      onKeyDown={e=>{
        if(e.key==='ArrowDown'){e.preventDefault();if(!open)setOpen(true);else setActive(a=>Math.min(a+1,rows.length-1));}
        else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}
        else if(e.key==='Enter'){if(shown&&rows[active]){e.preventDefault();add(rows[active]);}}
        else if(e.key==='Escape'){if(shown){e.stopPropagation();setOpen(false);}else if(text){e.stopPropagation();setText('');}}
        else if(e.key==='Backspace'&&!text&&value.length){e.preventDefault();onChange(value.slice(0,-1));}}}/>
    {shown&&<ul className="combo-list rf-list" role="listbox" id={id} ref={list} aria-label="Suggestions">{rows.map((r,i)=><li key={tagKey(r)} id={`${id}-${i}`} role="option" aria-selected={i===active} className={(i===active?'active ':'')+r.kind}
      onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>add(r)}>
      {r.kind==='pokemon'?<PokeIcon n={icons[r.label]}/>:<span className="rf-glyph"><Px icon={Tag} size={14}/></span>}<span>{r.label}</span><small>{kindLabel[r.kind]??r.kind}</small></li>)}</ul>}
  </div>;
}


// Summaries run on the player's own AI. With no key connected, say so and offer both ways in.
function ConnectAI({onClose}:{onClose:()=>void}){
  const go=(mode:'key'|'mcp')=>{try{sessionStorage.setItem('frontierbrain.ai-mode',mode);}catch{}onClose();location.hash='#account';};
  return <Modal title="Connect your AI to analyse replays" onClose={onClose}>
    <p>Replay analysis runs on your own AI, so nobody else pays for it and your replays stay yours. Connect one of these:</p>
    <div className="connect-ai-options">
      <button className="primary" onClick={()=>go('key')}><Px icon={Sparkles}/>Add an API key</button>
      <button onClick={()=>go('mcp')}>Use MCP with Claude or ChatGPT</button>
    </div>
    <p className="footnote">An API key lets Frontier Brain summarise replays here. With MCP you connect Claude, ChatGPT or your coding agent and ask it to analyse your replays; it can read them through the connector.</p>
  </Modal>;
}
function Digest({team,games,info,busy,refresh,art}:{team:any;games:any[];info:any;busy:boolean;refresh:()=>void;art:any}){
  const r=record(games);const d=info.digest;
  return <section className="digest panel"><header className="panel-heading"><div><span className="eyebrow">{r.n?`${r.label} in ${r.n} game${r.n===1?'':'s'}`:'No games yet'}{d?` · ${d.games} summarised · ${date(d.createdAt)}`:''}</span><h2>Debrief</h2></div>
      {r.n>=2&&<button onClick={refresh} disabled={busy}>{busy?<><Px icon={Sparkles}/>Updating…</>:<><Px icon={Sparkles}/>Refresh</>}</button>}</header>
    {!d?<p className="muted">{r.n<2?'Add a couple of replays to get a debrief.':busy?'Summarising your games…':'Summarise your games to get a debrief.'}</p>
      :<div className="debrief">
        {d.strengths?.length>0&&<section><h3>What's working</h3><ul className="debrief-good">{d.strengths.map((t:string,i:number)=><li key={i}>{t}</li>)}</ul></section>}
        <section><h3>What to work on</h3><ol className="themes">{d.themes.map((t:any,i:number)=><li key={i}><div className="theme-head"><b>{t.title}</b><span className="tag">{t.count} of {t.total} {t.of}</span></div><p>{t.detail}</p></li>)}</ol></section>
      </div>}
  </section>;
}
// At a glance: your record against what you've faced, counted from the linked games (and the summaries' archetype tags).
// Pokémon count when they were at team preview; types count once per game. Nothing here is a verdict below a few games.
function AtAGlance({games,info,art}:{games:any[];info:any;art:any}){
  const done=games.filter(g=>g.result==='win'||g.result==='loss');const seen=[...new Set(done.flatMap(g=>g.preview[other(g)] as string[]))];
  const dex=useDex(seen,[]);
  const tally=(keys:(g:any)=>string[])=>{const t:Record<string,{n:number;w:number}>={};for(const g of done)for(const k of new Set(keys(g))){const x=t[k]??={n:0,w:0};x.n++;if(g.result==='win')x.w++;}return Object.entries(t).map(([k,v])=>({k,...v,rate:v.w/v.n}));};
  const mons=tally(g=>g.preview[other(g)]);const types=tally(g=>(g.preview[other(g)] as string[]).flatMap(m=>dex.types[m]??[]));const styles=tally(g=>info.summaries[g.id]?.opponentStyle??[]);
  const min=done.length>=6?2:1;const hard=(l:any[])=>l.filter(x=>x.n>=min&&x.w<x.n).sort((a,b)=>a.rate-b.rate||b.n-a.n).slice(0,4);const easy=(l:any[])=>l.filter(x=>x.n>=min&&x.w>0).sort((a,b)=>b.rate-a.rate||b.n-a.n).slice(0,4);
  if(done.length<2)return null;
  const rec=(x:any)=><span className="glance-rec">{x.w}–{x.n-x.w}</span>;
  const monList=(l:any[],tone:string)=>l.length?<ul>{l.map(x=><li key={x.k} className={tone}><Art name={x.k} art={art} small/><span className="glance-name">{x.k}</span>{rec(x)}</li>)}</ul>:<p className="muted">Nothing yet.</p>;
  const pillList=(l:any[],tone:string,type=false)=>l.length?<ul>{l.map(x=><li key={x.k} className={tone}>{type?<span className="type-badge" style={{'--type':TYPE_COLOURS[x.k]??'#888'} as any}>{x.k}</span>:<span className="glance-name">{x.k}</span>}{rec(x)}</li>)}</ul>:<p className="muted">{type?'Nothing yet.':'Summarise games to tag team styles.'}</p>;
  return <section className="glance panel"><header className="panel-heading"><div><span className="eyebrow">At a glance · {done.length} games</span><h2>Who gives you trouble</h2></div></header>
    <div className="glance-grid">
      <div><h3>Toughest Pokémon</h3>{monList(hard(mons),'bad')}</div>
      <div><h3>Easiest Pokémon</h3>{monList(easy(mons),'good')}</div>
      <div><h3>Team styles you struggle with</h3>{pillList(hard(styles),'bad')}</div>
      <div><h3>Types you struggle with</h3>{pillList(hard(types),'bad',true)}</div>
    </div>
    </section>;
}

function GameCard({g,s,pending,art,open}:{g:any;s:any;pending:boolean;art:any;open:()=>void}){
  const o=other(g);
  return <article className={'game '+g.result} onClick={open} onKeyDown={e=>{if(e.key==='Enter')open();}} tabIndex={0} role="button" aria-label={`${g.result} vs ${g.players[o].name}`}>
    <div className="game-top"><span className={'result '+g.result}>{g.result}</span><span className="muted">{g.date?date(g.date):''} · vs {g.players[o].name}</span>{s?.stale&&<span className="tag">link changed</span>}</div>
    <div className="game-teams"><div className="six">{g.preview[o].map((m:string)=><span key={m} className={g.leads[o].includes(m)?'lead':g.revealed[o].includes(m)?'brought':'benched'} title={m}><Art name={m} art={art} small/></span>)}</div></div>
    {s?<><p className="game-summary">{s.summary}</p>{s.workOn.length>0&&<ul className="work-on">{s.workOn.slice(0,2).map((w:any,i:number)=><li key={i}><span className={'cat '+w.category}>{category[w.category]}</span>{w.title}</li>)}</ul>}
      {s.opponentStyle.length>0&&<div className="chip-row style-tags">{s.opponentStyle.map((t:string)=><span key={t} className="chip small">{t}</span>)}</div>}</>
      :<p className="muted">{pending?'Summarising…':'No summary yet.'}</p>}
  </article>;
}

function GameDrawer({g,s,team,data,load,notify,close,resummarise}:{g:any;s:any;team:any;data:any;load:()=>Promise<void>;notify:(s:string)=>void;close:()=>void;resummarise:()=>void}){
  const [log,setLog]=useState(''),[linking,setLinking]=useState(false),[turn,setTurn]=useState<number|null>(null);const box=useRef<HTMLPreElement>(null);const o=other(g);
  useEffect(()=>{api('/replay-transcript?id='+encodeURIComponent(g.id)).then(r=>setLog(r.transcript)).catch(()=>{});},[g.id]);
  useEffect(()=>{if(turn===null||!box.current)return;const el=box.current.querySelector(`[data-turn="${turn}"]`);el?.scrollIntoView({block:'start',behavior:'smooth'});},[turn,log]);
  const lines=log.split('\n');
  return <Modal title={`${g.result==='win'?'Win':g.result==='loss'?'Loss':g.result} vs ${g.players[o].name}`} onClose={close}><div className="game-drawer">
    <p className="muted">{g.date?date(g.date):''} · <LinkStatus g={g} team={team} data={data} load={load} notify={notify}/> · <button className="text-button" onClick={()=>setLinking(true)}>Change link</button> · <button className="text-button" onClick={()=>void downloadOriginal(g.id)}>Original replay ↓</button></p>
    <div className="selections">{[[g.ownSide,'You'],[o,'Opponent']].map(([side,label])=><div key={side}><span className="eyebrow">{label}</span><div className="six">{g.preview[side].map((m:string)=><span key={m} className={g.leads[side].includes(m)?'lead':g.revealed[side].includes(m)?'brought':'benched'} title={m}><Art name={m} art={data.art} small/></span>)}</div></div>)}<p className="footnote">Leads are outlined; faded Pokémon weren't seen in battle.</p></div>
    {s?<><p className="game-summary big">{s.summary}</p>
      {s.workOn.length>0&&<><h3>Work on</h3><ul className="work-on full">{s.workOn.map((w:any,i:number)=><li key={i}><div className="wo-head"><span className={'cat '+w.category}>{category[w.category]}</span><b>{w.title}</b>{w.turn&&<button className="text-button wo-turn" onClick={()=>setTurn(w.turn)}>Turn {w.turn} →</button>}</div><p>{w.detail}</p></li>)}</ul></>}
      {s.keyMoments.length>0&&<><h3>Key moments</h3><ol className="moments">{s.keyMoments.map((m:any,i:number)=><li key={i}><button className="text-button" onClick={()=>setTurn(m.turn)}>Turn {m.turn}</button> {m.text}</li>)}</ol></>}
      <p className="model-line">{s.model} · {date(s.createdAt)} · team sets: {s.setsBasis}{s.stale?' · the link changed since':''} · <button className="text-button" onClick={resummarise}><Px icon={Sparkles} size={12}/>Re-summarise</button></p></>
      :<p className="muted">No summary yet. <button className="text-button" onClick={resummarise}><Px icon={Sparkles} size={12}/>Summarise this game</button></p>}
    <details open={turn!==null} onToggle={e=>{if(!(e.target as HTMLDetailsElement).open)setTurn(null);}}><summary>Turn by turn</summary><pre ref={box} className="transcript">{lines.map((l,i)=>{const m=/^Turn (\d+):/.exec(l);return <span key={i} data-turn={m?.[1]} className={m&&Number(m[1])===turn?'hl':''}>{l}{'\n'}</span>;})}</pre></details>
  </div>{linking&&<AssociationDialog game={g} data={data} close={()=>setLinking(false)} load={load} notify={notify}/>}</Modal>;
}

// Locked until the player has a Showdown name: without it, replays can't be read from their side.
function AddReplays({team,versionId,load,notify,after,locked=false}:{team:any;versionId:string;load:()=>Promise<void>;notify:(s:string,e?:boolean)=>void;after:()=>void;locked?:boolean}){
  const [links,setLinks]=useState(''),[files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[results,setResults]=useState<any[]>([]);
  const submit=async()=>{setBusy(true);setResults([]);try{const items=[...links.split(/\s+/).filter(l=>l.startsWith('http')).map(url=>({url})),...await Promise.all(files.map(async f=>({name:f.name,html:await f.text()})))];
      const r=await api('/replays',{items,association:{teamId:team.id,certainty:'auto'}});await load();
      const ok=r.results.filter((x:any)=>x.ok);const matched=ok.filter((x:any)=>x.certainty==='exact').length;setResults(r.results.filter((x:any)=>!x.ok||x.certainty!=='exact'));notify(`${ok.length} of ${r.results.length} replay(s) added${matched?`; ${matched} matched to your sets at the time`:''}.`);if(ok===r.results.length){setLinks('');setFiles([]);}after();}catch(e){notify((e as Error).message,true);}finally{setBusy(false);}};
  return <section className={'add-replays'+(locked?' locked':'')} aria-disabled={locked||undefined} title={locked?'Add your Showdown name above first':undefined}><fieldset className="add-row" disabled={locked}><textarea rows={links.includes('\n')?3:1} value={links} onChange={e=>setLinks(e.target.value)} placeholder={locked?'Add your Showdown name above to add replays':'Paste Showdown replay links (one per line)'} aria-label="Showdown replay links"/>
      <label className="button file-button"><Px icon={Upload}/>{files.length?`${files.length} file${files.length===1?'':'s'}`:'HTML files'}<input className="file-input" type="file" multiple accept=".html,.htm" onChange={e=>setFiles([...(e.target.files??[])])}/></label>
      <button className="primary" disabled={busy||(!links.trim()&&!files.length)} onClick={()=>void submit()}>{busy?'Adding…':'Add replays'}</button></fieldset>
    
    {results.map((r,i)=><p key={i} className={r.ok?'footnote':'error'}>{r.label.replace('https://replay.pokemonshowdown.com/','')}: {r.ok?(r.certainty==='inbox'?'not linked: its six don\'t match this team':`linked by team only${r.note?` (${r.note})`:''}`):r.error}</p>)}
  </section>;
}

// How a game is linked to this team's sets: matched automatically (consistent with the game, not proof of spreads),
// confirmed by the player, or same six with differences the battle showed.
function LinkStatus({g,team,data,load,notify}:{g:any;team:any;data:any;load:()=>Promise<void>;notify:(s:string,e?:boolean)=>void}){
  const a=g.association;if(!a)return <span>not linked</span>;
  const v=team.versions.find((x:any)=>x.id===a.versionId);const c=v?.configurations.find((x:any)=>x.id===a.configurationId);
  const confirm=async()=>{try{await api('/associate',{revision:data.db.revision,replayId:g.id,teamId:team.id,versionId:a.versionId,configurationId:a.configurationId,certainty:'exact',confirm:true});await load();notify('Confirmed as your exact sets.');}catch(e){notify((e as Error).message,true);}};
  if(a.certainty==='exact'&&a.basis==='auto')return <span>sets matched to your team on {date(c?.createdAt)}{a.note?` (${a.note.toLowerCase()})`:''} · <button className="text-button" onClick={()=>void confirm()}>These were my exact sets</button></span>;
  if(a.certainty==='exact')return <span>exact sets confirmed ({date(c?.createdAt)})</span>;
  return <span>same six, sets not matched{a.note?`: ${a.note}`:''}</span>;
}
