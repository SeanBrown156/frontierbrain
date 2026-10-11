import {useEffect,useRef,useState} from 'react';
import {Art,TypeBadges} from './ui.tsx';

// The front door: what Frontier Brain does, drawn with the player's own six (or a well-known balance core before
// they have a team). Shown once on a first visit and from the footer; "Open your teams" goes to the workbench.
export const WELCOMED='frontierbrain.welcomed';
const STARTER=['Incineroar','Rillaboom','Gholdengo','Sneasler','Kingambit','Farigiraf'];
const BENEFITS=[
  ['Build','Every team, every version','Import a paste or a tournament list, edit sets, and save milestones like V1 and V2. Roll back to the exact six you played.'],
  ['Test','Exact Champions calcs','Damage and speed on pinned Champions mechanics. Save a result as a benchmark and it re-checks itself whenever the set changes.'],
  ['Review','Replays that coach you','Showdown replays link to the version you played. Summaries judge each turn on what you knew at the time, not hindsight.'],
  ['Scout','The meta, with sources','Tournament lists from Limitless and PokéBase, shared spreads from VGCPastes. Every number says where it came from.'],
] as const;

export default function Welcome({data}:{data:any}){
  const team=data.teams[0];const six:string[]=team?team.view.sets.map((s:any)=>s.species):STARTER;
  const [focus,setFocus]=useState(2);const stage=useRef<HTMLDivElement>(null);
  const enter=()=>{try{localStorage.setItem(WELCOMED,'1');}catch{}location.hash='#teams';};
  // The stage leans toward the pointer; the focused Pokémon steps forward. Paused for reduced motion.
  useEffect(()=>{const el=stage.current;if(!el||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const move=(e:PointerEvent)=>{const r=el.getBoundingClientRect();el.style.setProperty('--px',String((e.clientX-r.left)/r.width-.5));el.style.setProperty('--py',String((e.clientY-r.top)/r.height-.5));};
    addEventListener('pointermove',move);return()=>removeEventListener('pointermove',move);},[]);
  useEffect(()=>{const t=setInterval(()=>setFocus(f=>(f+1)%six.length),3800);return()=>clearInterval(t);},[six.length]);
  const games=data.games?.length??0;
  return <div className="welcome-page">
    <section className="wl-hero">
      <div className="wl-copy">
        <span className="eyebrow">Pokémon Champions · VGC prep · open source</span>
        <h1>Your six,<br/><em>sharpened.</em></h1>
        <p className="wl-sub">A workbench for competitive doubles. Keep your teams, run exact calcs, learn from your replays and follow the meta, in one place.</p>
        <div className="wl-ctas"><button className="primary wl-go" onClick={enter}>{team?'Open your teams':'Start building'}<span aria-hidden="true">→</span></button><a className="button" href="https://github.com/SeanBrown156/frontierbrain" target="_blank" rel="noreferrer">View source ↗</a></div>
        <dl className="wl-facts">
          <div><dt>Teams</dt><dd>{data.teams.length}</dd></div>
          <div><dt>Replays</dt><dd>{games}</dd></div>
          <div><dt>Mechanics</dt><dd className="small">Champions M-C</dd></div>
        </dl>
      </div>
      <div className="wl-stage" ref={stage} aria-label={team?`${team.name}: ${six.join(', ')}`:`Example core: ${six.join(', ')}`}>
        <div className="wl-glass"><span className="wl-led" aria-hidden="true"/><span className="wl-floor" aria-hidden="true"/><span className="wl-label">{team?team.name:'Example core'}</span></div>
        <div className="wl-six">{six.map((s,i)=><button key={s+i} className={'wl-mon'+(i===focus?' on':'')} style={{'--i':i,'--n':six.length} as any} onMouseEnter={()=>setFocus(i)} onFocus={()=>setFocus(i)} onClick={enter} aria-label={s}><Art name={s} art={data.art}/></button>)}</div>
        <div className="wl-caption" key={six[focus]}><b>{six[focus]}</b><TypeBadges species={six[focus]}/></div>
      </div>
    </section>
    <section className="wl-benefits">{BENEFITS.map(([k,h,p],i)=><article key={k} style={{'--i':i} as any}><span className="wl-k"><span className="wl-n">{String(i+1).padStart(2,'0')}</span>{k}</span><h3>{h}</h3><p>{p}</p></article>)}</section>
    <section className="wl-close"><p>Your data stays yours: local files on your machine, or your own account on the hosted site. Bring your own AI key, or connect Claude or ChatGPT.</p><button className="primary" onClick={enter}>{team?'Open your teams':'Start building'}</button></section>
  </div>;
}
