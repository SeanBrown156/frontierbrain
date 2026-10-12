import {useEffect,useRef,useState,type ReactNode} from 'react';
import './landing.css';
import {Art,TypeBadges,ModeSwitch} from './ui.tsx';
import {PlanCard} from './team/Coaching.tsx';
import {RolePill} from './team/Coaching.tsx';
import {MonCard} from './team/Hub.tsx';
import {SpeedRace,DamageViz} from './BenchmarkLab.tsx';
import {decode,reduced} from './fx.ts';
import {ClaudeMark,AnthropicMark,OpenAIMark,TerminalMark,MCPMark,CursorMark,VSCodeMark,GitHubMark,SheetsMark} from './landing-marks.tsx';

// The front door. Every card on it is the app's own card (Pokémon card, plan card, damage and speed results, debrief),
// drawn once with example data and then tilted as one piece. Numbers are Frontier Brain calc-tool outputs for the
// example Timid Mega Alakazam (32 SpA, 32 Spe, 2 HP) against labelled PokéBase M-C tournament sets.
// The loading boot belongs to the app: "Open the app" starts it, the landing itself goes straight in.
export const WELCOMED='frontierbrain.welcomed';
export const REPO='https://github.com/SeanBrown156/frontierbrain';

// ----- example data -----
const STATS:[string,number,number,number][]=[['HP',55,2,132],['Atk',50,0,63],['Def',65,0,85],['SpA',175,32,227],['SpD',105,0,125],['Spe',150,32,222]];
const ZAM={set:{species:'Alakazam',item:'Alakazite',ability:'Trace',nature:'Timid',statPoints:{hp:2,spa:32,spe:32},moves:['Psychic','Shadow Ball','Focus Blast','Dazzling Gleam']},provenance:'manual'};
const INC={set:{species:'Incineroar',item:'Sitrus Berry',ability:'Intimidate',nature:'Careful',statPoints:{hp:32,def:2,spd:32},moves:['Fake Out','Parting Shot','Flare Blitz','Throat Chop']},provenance:'manual'};
const INC_STATS={hp:202};
const calcResult=(rolls:number[],pct:[number,number],phrase:string,move:string)=>({
  kind:'Damage',rolls,range:[rolls[0],rolls[rolls.length-1]],percentOfMaxHP:pct,koChanceOnHit:0,defenderStats:INC_STATS,defaults:{defenderHP:202},
  description:rolls[rolls.length-1]===0?`Alakazam-Mega using ${move} deals 0 damage to Incineroar under the supplied conditions.`:`32 SpA Alakazam-Mega ${move} vs. 32 HP / 32+ SpD Incineroar: ${rolls[0]}-${rolls[rolls.length-1]} (${pct[0].toFixed(1)} - ${pct[1].toFixed(1)}%) -- ${phrase}`});
const MOVES=[
  {n:'Focus Blast',r:calcResult([132,134,134,136,138,140,140,142,144,146,148,148,150,152,154,156],[65.3,77.2],'guaranteed 2HKO','Focus Blast')},
  {n:'Psychic',r:calcResult([0],[0,0],'','Psychic')},
  {n:'Shadow Ball',r:calcResult([22,22,23,23,23,23,24,24,24,24,25,25,25,25,26,26],[10.8,12.8],'possible 8HKO','Shadow Ball')}];
const PLAN='Alakazam-Mega moves first, **222** to **189**.\n\nDazzling Gleam does **53.4–63.9%**, a guaranteed 2HKO.\n\nIf Trick Room goes up, Mega Salamence moves first.';
const SOURCES:[string,string,string|null][]=[['Limitless','https://limitlesstcg.com','limitless'],['PokéBase','https://pokebase.app','pokebase'],['Pikalytics','https://www.pikalytics.com','pikalytics'],['VGCPastes','https://pokepast.es',null],['Smogon','https://www.smogon.com','smogon'],['Showdown','https://replay.pokemonshowdown.com','showdown']];
const CLIENTS:{n:string;icon:ReactNode;snip:string;hint:string}[]=(()=>{const url=`${location.origin}/api/mcp`;return[
  {n:'Claude',icon:<ClaudeMark style={{color:'#D97757'}}/>,snip:url,hint:'In Claude, open Customize → Connectors, click + and choose Add custom connector. Name it Frontier Brain and paste the connector address.'},
  {n:'ChatGPT',icon:<OpenAIMark/>,snip:url,hint:'In ChatGPT, open Settings → Apps & Connectors → Advanced settings and turn on Developer mode. Then Create, name it Frontier Brain, paste the address and choose OAuth.'},
  {n:'Claude Code',icon:<TerminalMark style={{color:'#D97757'}}/>,snip:`claude mcp add --transport http frontier-brain ${url}`,hint:'Run it, then /mcp, pick frontier-brain and authenticate. Frontier Brain opens in your browser: click Allow.'},
  {n:'Codex CLI',icon:<TerminalMark/>,snip:`codex mcp add frontier-brain --url ${url}`,hint:'Then sign in with: codex mcp login frontier-brain.'},
  {n:'Cursor',icon:<CursorMark/>,snip:JSON.stringify({mcpServers:{'frontier-brain':{url}}}),hint:'Add to ~/.cursor/mcp.json.'},
  {n:'VS Code',icon:<VSCodeMark style={{color:'#2489CA'}}/>,snip:JSON.stringify({servers:{'frontier-brain':{type:'http',url}}}),hint:'Add to .vscode/mcp.json.'}];})();

// A card that is finished flat, then tilts as one piece toward the pointer. `base` is its resting 3D pose.
function Tilt({children,className='',base}:{children:ReactNode;className?:string;base?:{x?:number;y?:number;z?:number}}){
  const el=useRef<HTMLDivElement>(null);
  const move=(e:React.PointerEvent)=>{if(reduced()||e.pointerType==='touch'||!el.current)return;const r=el.current.getBoundingClientRect();
    el.current.style.setProperty('--ry',String(((e.clientX-r.left)/r.width-.5)*16));el.current.style.setProperty('--rx',String(-((e.clientY-r.top)/r.height-.5)*12));};
  const leave=()=>{el.current?.style.setProperty('--ry','0');el.current?.style.setProperty('--rx','0');};
  return <div ref={el} className={'lp-tilt '+className} onPointerMove={move} onPointerLeave={leave}
    style={{'--bx':(base?.x??0)+'deg','--by':(base?.y??0)+'deg','--rz':(base?.z??0)+'deg'} as any}>{children}</div>;
}
// Fades each block in as its section arrives (top to bottom) and resolves the section title from noise once.
function useArrive(root:React.RefObject<HTMLElement|null>){
  useEffect(()=>{const el=root.current;if(!el)return;
    const items=[...el.querySelectorAll<HTMLElement>('.lp-rv')];
    if(!('IntersectionObserver' in window)||reduced()){items.forEach(i=>i.classList.add('in'));return;}
    // a block is revealed with its siblings; blocks sitting directly in the page (AI box, closing) arrive on their own
    const groups=new Map<HTMLElement,HTMLElement[]>();
    items.forEach(i=>{const host=i.parentElement===el?i:i.parentElement!;groups.set(host,[...(groups.get(host)??[]),i]);});
    const io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;io.unobserve(en.target);
      (groups.get(en.target as HTMLElement)??[]).forEach((n,k)=>setTimeout(()=>{n.classList.add('in');const h=n.querySelector('h2');if(h)decode(h,{duration:640,lock:true});},k*160));}),
      {rootMargin:'0px 0px -14% 0px',threshold:.1});
    groups.forEach((_,h)=>io.observe(h));return()=>io.disconnect();},[root]);
}

export default function Welcome({data,onOpen}:{data:any;onOpen:()=>void}){
  const page=useRef<HTMLDivElement>(null);useArrive(page);
  const [move,setMove]=useState(0),[tr,setTr]=useState(false),[tab,setTab]=useState<'key'|'mcp'>('key'),[prov,setProv]=useState<'openai'|'anthropic'>('openai'),[client,setClient]=useState(0);
  const [planText,setPlanText]=useState(PLAN),[copied,setCopied]=useState(false),[hot,setHot]=useState(1);
  const calcs=useRef<HTMLDivElement>(null),[calcSeen,setCalcSeen]=useState(false);
  // the damage and speed cards are rebuilt as they reach the screen, so both play their results together
  useEffect(()=>{const el=calcs.current;if(!el||calcSeen)return;if(!('IntersectionObserver' in window)){setCalcSeen(true);return;}
    const io=new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)){setCalcSeen(true);io.disconnect();}},{threshold:.35});io.observe(el);return()=>io.disconnect();},[calcSeen]);
  const art=data.art;const stage=useRef<HTMLDivElement>(null);const mega=useRef<HTMLDivElement>(null);
  // The hero card leans toward the pointer anywhere on the page; Mega Alakazam floats on his own above it.
  useEffect(()=>{if(reduced())return;const f=(e:PointerEvent)=>{const s=stage.current,m=mega.current;if(!s||!m||e.pointerType==='touch')return;
      const r=s.getBoundingClientRect();const x=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width-.5)),y=Math.max(-1,Math.min(1,(e.clientY-r.top)/r.height-.5));
      m.style.setProperty('--ry',String(x*9));m.style.setProperty('--rx',String(-y*7));s.style.setProperty('--px',String(x));s.style.setProperty('--py',String(y));};
    addEventListener('pointermove',f,{passive:true});return()=>removeEventListener('pointermove',f);},[]);
  useEffect(()=>{if(reduced())return;const t=setInterval(()=>setHot(h=>(h+1)%3),2600);return()=>clearInterval(t);},[]);
  // "Tweak": the plan is re-drafted one sentence at a time, then waits to be accepted again.
  const typing=useRef(0);
  const redraft=()=>{clearInterval(typing.current);if(reduced()){setPlanText(PLAN);return;}let i=0;setPlanText('');
    typing.current=window.setInterval(()=>{i=Math.min(PLAN.length,i+4);setPlanText(PLAN.slice(0,i));if(i>=PLAN.length)clearInterval(typing.current);},24);};
  useEffect(()=>()=>clearInterval(typing.current),[]);
  const copy=(text:string)=>{const done=()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);};try{void navigator.clipboard.writeText(text).then(done,done);}catch{done();}};
  const cur=CLIENTS[client];
  const homeSrc=(n:string)=>`/api/home?species=${encodeURIComponent(n)}`;

  return <div className="welcome-page lp" ref={page}>
    {/* hero: copy left, Mega Alakazam right */}
    <section className="lp-hero lp-zz">
      <div className="lp-copy">
        <h1 className="lp-title">The open&#8209;source <em>brain</em> for Pokémon VGC.</h1>
        <p className="lp-sub">Build teams, run calcs and learn from your replays, with the AI you already use.</p>
        <div className="lp-ctas"><button className="primary lp-go" onClick={onOpen}>Open the app<span aria-hidden="true">→</span></button>
          <a className="button lp-gh" href={REPO} target="_blank" rel="noreferrer"><GitHubMark/>View source</a></div>
      </div>
      <div className="lp-vis"><div className="lp-stage" ref={stage}>
        <span className="lp-floor" aria-hidden="true"/>
        <div className="lp-pop" aria-hidden="true"><img src="/landing/mega-alakazam.png" alt="" width={512} height={512}/></div>
        <div className="lp-tilt lp-mega" ref={mega} style={{'--bx':'3deg','--by':'-13deg','--rz':'-2.5deg'} as any}>
          <div className="lp-mega-head"><h2>Mega Alakazam</h2><TypeBadges species="Alakazam-Mega"/><span className="lp-dex" aria-label="Dex number 65">65</span></div>
          <p className="lp-mega-meta">Base total <b>600</b><span>Ability <b>Trace</b></span></p>
          <ul className="lp-stats" aria-label="Base stats with example stat points">{STATS.map(([k,b,p,v])=><li key={k}><span className="k">{k}</span>
            <span className="bar"><span className="fill" style={{width:`${(b+p)/255*100}%`}}><i style={{flex:b}}/><u style={{flex:p}}/></span></span><span className="v">{v}</span></li>)}</ul>
          <p className="lp-mega-foot"><span>Example spread <b>Timid · 32 SpA · 32 Spe · 2 HP</b></span><span>Lv 50</span></p>
        </div>
      </div></div>
    </section>

    {/* team builder: cards left, copy right */}
    <section className="lp-zz lp-flip" id="build">
      <div className="lp-vis lp-rv"><div className="lp-fan">
        <Tilt className="lp-fan-a" base={{y:12,x:2,z:-3}}><MonCard i={0} revision={ZAM} href="#teams" active art={art}/></Tilt>
        <Tilt className="lp-fan-b" base={{y:-12,x:2,z:3}}><MonCard i={1} revision={INC} href="#teams" active art={art}/></Tilt>
        <Tilt className="lp-fan-plan" base={{x:-3,z:-1}}>
          <PlanCard status="active"
            head={<><RolePill role="core"/><h3>Alakazam + Incineroar</h3></>}
            meta={<div className="front-back"><span className="fb-label">Front</span><span className="fb-mons"><span className="fb-mon"><Art name="Alakazam-Mega" fallback="Alakazam" art={art} small/>Alakazam-Mega</span><span className="fb-mon"><Art name="Incineroar" art={art} small/>Incineroar</span></span>
              <span className="fb-divider"/><span className="fb-label">Back</span><span className="fb-mons"><span className="fb-mon"><Art name="Sneasler" art={art} small/>Sneasler</span><span className="fb-mon"><Art name="Gholdengo" art={art} small/>Gholdengo</span></span></div>}
            summary="Into Mega Salamence leads, with Trick Room less likely." body={planText}
            foot={<span className="tag">V2</span>}
            edit={redraft} remove={()=>setPlanText(PLAN)}/>
        </Tilt>
      </div></div>
      <div className="lp-copy lp-rv"><span className="eyebrow">Team builder</span><h2 className="lp-title">Start from what wins.</h2>
        <p className="lp-sub">Start building from proven tournament teams or with the AI you prefer. Then iterate on your matchup strategy and lead pairings.</p></div>
    </section>

    {/* calcs: copy left, cards right */}
    <section className="lp-zz" id="calcs">
      <div className="lp-copy lp-rv"><span className="eyebrow">Calculators</span><h2 className="lp-title">Integrated calculators.</h2>
        <p className="lp-sub">Skip the sea of dropdowns. Calc straight from your Pokémon against the format-defining sets. Save all your benchmarks for later reference.</p></div>
      <div className="lp-vis lp-rv"><div className="lp-calcs" ref={calcs}>
        <Tilt className="lp-dmg" base={{y:-8,x:2,z:-1}}><section className="panel lab-inline lp-panel">
          <header className="panel-heading"><div><span className="eyebrow">Incineroar · Careful 32/2/32 · PokéBase M-C tournaments, 22.4% of spreads</span><h2>Damage</h2></div></header>
          <div className="segmented lp-moves" role="group" aria-label="Move">{MOVES.map((m,i)=><button key={m.n} className={i===move?'on':''} aria-pressed={i===move} onClick={()=>setMove(i)}>{m.n}</button>)}</div>
          <DamageViz key={move+':'+calcSeen} result={MOVES[move].r} name="Incineroar" attackerName="Mega Alakazam" defender="Incineroar" fallback="Incineroar" move={MOVES[move].n} art={art}/>
        </section></Tilt>
        <Tilt className="lp-race" base={{y:7,x:2,z:1}}><section className="panel lab-inline lp-panel">
          <header className="panel-heading"><div><span className="eyebrow">Mega Salamence · Timid 2/32/32 · PokéBase M-C tournaments, 63.6% of spreads</span><h2>Speed</h2></div>
            <label className="lp-tog"><input type="checkbox" checked={tr} onChange={e=>setTr(e.target.checked)}/><span>Trick Room</span></label></header>
          <SpeedRace key={'race'+calcSeen} a={{name:'Alakazam-Mega',fallback:'Alakazam',speed:222}} b={{name:'Salamence-Mega',fallback:'Salamence',speed:189}} first={tr?'b':'a'} trickRoom={tr} art={art} decidedBy="speed"/>
        </section></Tilt>
      </div></div>
    </section>

    {/* replays: stacked cards left, copy right */}
    <section className="lp-zz lp-flip" id="replays">
      <div className="lp-vis lp-rv"><div className="lp-rstack">
        <Tilt className="lp-r-shot" base={{y:10,x:3,z:-1.5}}><section className="panel lp-panel">
          <header className="lp-shot-head"><span className="lp-sd"><img src="/landing/logos/showdown.png" alt="" width={24} height={24}/>Pokémon Showdown replay</span><span className="tag">Turn 2</span></header>
          <div className="lp-shot"><img src="/landing/replay.jpg" alt="A Pokémon Showdown replay at turn 2: Swampert uses Wave Crash on Sableye in rain" width={875} height={720}/>
            <span className={'lp-hot'+(hot===0?' on':'')} style={{left:'2.5%',top:'11.5%',width:'60%',height:'18%'}}/><span className={'lp-hot'+(hot===1?' on':'')} style={{left:'55.5%',top:'23%',width:'14%',height:'7.5%'}}/><span className={'lp-hot'+(hot===2?' on':'')} style={{left:'37%',top:'1%',width:'44%',height:'9%'}}/></div>
        </section></Tilt>
        <Tilt className="lp-r-debrief lp-more" base={{y:-9,x:2,z:2}}><section className="digest panel lp-panel"><header className="panel-heading"><div><span className="eyebrow">Example · 6 games</span><h2>Debrief</h2></div></header>
          <div className="debrief">
            <section><h3>What's working</h3><ul className="debrief-good"><li>Rain up on turn 2, and Wave Crash takes Sableye to 26%.</li><li>Leads that outspeed the opposing pair.</li></ul></section>
            <section><h3>What to work on</h3><ol className="themes"><li><div className="theme-head"><b>Switching into Fake Out</b><span className="tag">3 of 6 games</span></div><p>Back-to-back Protect turns leave the second slot exposed.</p></li></ol></section>
          </div></section></Tilt>
        <Tilt className="lp-r-glance lp-more" base={{y:6,x:-2,z:-2}}><section className="glance panel lp-panel"><header className="panel-heading"><div><span className="eyebrow">Example · 6 games</span><h2>Who gives you trouble</h2></div></header>
          <div className="lp-glance">
            <div><h3>Easiest Pokémon</h3><ul><li className="good"><Art name="Sableye" art={art} small/><span className="glance-name">Sableye</span><span className="glance-rec">2–0</span></li></ul></div>
            <div><h3>Toughest Pokémon</h3><ul><li className="bad"><Art name="Basculegion" art={art} small/><span className="glance-name">Basculegion</span><span className="glance-rec">0–2</span></li></ul></div>
          </div></section></Tilt>
      </div></div>
      <div className="lp-copy lp-rv"><span className="eyebrow">Replay analysis</span><h2 className="lp-title">Analyse replays.</h2>
        <p className="lp-sub">See who you're beating, who you're losing to and how to build and play better.</p>
        <div className="lp-soon lp-more"><span className="lp-soon-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z"/></svg></span>
          <div><b>Video replay analysis</b><span>Review the recording, not just the log.</span></div><span className="tag lp-tag-gold">Coming soon</span></div></div>
    </section>

    {/* data: copy left, floating source logos right */}
    <section className="lp-zz" id="sources">
      <div className="lp-copy lp-rv"><span className="eyebrow">Data</span><h2 className="lp-title">One consolidated data source.</h2>
        <p className="lp-sub">Frontier Brain sources results, usage and sets, pooled and deduplicated in one place.</p></div>
      <div className="lp-vis lp-rv"><div className="lp-cloud">{SOURCES.map(([n,u,l],i)=><a key={n} className={'lp-src s'+i} href={u} target="_blank" rel="noreferrer">
        <span className="lg">{l?<img src={`/landing/logos/${l}.png`} alt="" width={30} height={30}/>:<SheetsMark/>}</span>{n}</a>)}</div></div>
    </section>

    {/* AI: full width */}
    <section className="lp-os lp-rv" id="ai">
      <div className="lp-os-card">
        <h2 className="lp-title">Use the AI tools you already use</h2>
        <ModeSwitch label="Connect your AI" value={tab} onChange={setTab} options={[{value:'key',label:'Connect with your API key',short:'API key'},{value:'mcp',label:'Connect via MCP',short:'MCP',icon:<MCPMark/>}]}/>
        {tab==='key'?<div className="lp-pane" role="tabpanel">
          <div><p className="lp-lead"><b>AI runs on your own OpenAI or Anthropic key, so you pay the provider directly for what you use.</b> Frontier Brain never charges you and never pays for anyone else's usage. Your key unlocks the in-app AI chat, with full context of your teams, replays and calcs, right where you work.</p>
            <ul className="lp-points lp-more"><li><b>Stays in this browser.</b> Your key is kept on this device only, not in your account or our database.</li><li><b>Used only for your requests.</b> It passes to the provider for that one request and is discarded. Never logged or stored.</li><li><b>You're in control.</b> Remove it any time, or set a spending limit with your provider.</li></ul></div>
          <div className="lp-side">
            <div className="lp-grid c2" role="group" aria-label="Provider">
              <button className={prov==='openai'?'on':''} aria-pressed={prov==='openai'} onClick={()=>setProv('openai')}><OpenAIMark/><span>OpenAI</span></button>
              <button className={prov==='anthropic'?'on':''} aria-pressed={prov==='anthropic'} onClick={()=>setProv('anthropic')}><AnthropicMark style={{color:'#D97757'}}/><span>Anthropic</span></button></div>
            <div className="lp-cmd"><code><b>{prov==='openai'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY'}</b>={prov==='openai'?'sk-…':'sk-ant-…'}</code></div>
            <p className="lp-fine">Check for yourself. Frontier Brain is open source, so you can read exactly how keys are handled.</p></div>
        </div>:<div className="lp-pane" role="tabpanel">
          <div><p className="lp-lead"><b>Use Frontier Brain from Claude, ChatGPT or your coding agent.</b> Add it as a connector and your assistant can read your teams, run exact calcs, look up the data pool, create teams and propose plans. It runs on your own subscription, with no API key needed.</p>
            <ul className="lp-points lp-more"><li><b>You approve access.</b> Connecting opens Frontier Brain so you can sign in and click Allow.</li><li><b>Only your workspace.</b> The connector sees your teams and replays, nobody else's.</li><li><b>Changes wait for you.</b> New plans arrive as proposals; nothing about an existing team changes until you accept it.</li></ul></div>
          <div className="lp-side">
            <div className="lp-grid c3" role="group" aria-label="Client">{CLIENTS.map((c,i)=><button key={c.n} className={i===client?'on':''} aria-pressed={i===client} onClick={()=>setClient(i)}>{c.icon}<span>{c.n}</span></button>)}</div>
            <div className="lp-cmd"><code>{cur.snip}</code><button className="compact" onClick={()=>copy(cur.snip)}>{copied?'Copied':'Copy'}</button></div>
            <p className="lp-fine">{cur.hint}</p></div>
        </div>}
      </div>
    </section>

    {/* closing */}
    <section className="lp-close lp-rv">
      <h2 className="lp-title">The brain every VGC player can build on.</h2>
      <a className="button primary lp-xl" href={REPO} target="_blank" rel="noreferrer"><GitHubMark/>View source</a>
      <p>Open source and free for anyone to tinker with. Fork it, extend it, bring your own AI, and help make the best community tools.</p>
    </section>
  </div>;
}
