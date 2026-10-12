import {useState,useEffect,useCallback,useRef} from 'react';
import {api,ApiError,Panel,Modal,Markdown,Empty,date,Notice,JobStatus,SiteIcon} from './ui.tsx';
import {Px,ArrowLeft,Close,Close as CloseIcon,Menu as MenuIcon,Chart,Trophy,BookOpen,Users,Play,Bookmark,ChevronDown,Zap,Notes,Check,WarningDiamond} from './icons.tsx';
import AssistDock,{type DockContext} from './ai/AssistDock.tsx';
import {useSaveState,saving,saved,failed,hasDirty,confirmDiscard} from './save-state.ts';
import TeamHub,{TeamsLanding} from './team/Hub.tsx';
import PokemonWorkspace from './team/PokemonWorkspace.tsx';
import NewTeam from './team/NewTeam.tsx';
import DataPool from './DataPool.tsx';
import {hostedSite} from './auth.tsx';
import AccountMenu from './AccountMenu.tsx';
import Settings from './Settings.tsx';
import Welcome,{WELCOMED,REPO} from './Welcome.tsx';
import {GitHubMark} from './landing-marks.tsx';
import BrainBackdrop from './brain/BrainBackdrop.tsx';
import Boot,{shouldBoot} from './Boot.tsx';
import {decode,hoverDecode,glitch,reduced} from './fx.ts';
// Names and labels that resolve from noise when you point at them: team and Pokémon names, the header menus, the Ask
// button and section headings. Titles do the same when you arrive on a new page.
const DECODE_ON_HOVER=['.team-card-title h3','.team-card-title','.mon-card-head h3','.combatant-head h3','.guide-mon-head h3',
  '.masthead .quickbar-group>button','.masthead .quickbar-all','.masthead .drawer-news','.ticker-label','.dock-toggle',
  '.panel-heading h2','.panel>h2','.panel>h3','.reference-groups h3'].join(',');
// The page a route shows, for the title decode: one team's tabs (and its Pokémon) count as one page each, so switching
// tabs or Pokémon within a team never scrambles its name again.
const pageOf=(route:string)=>{const p=route.split('/');return p[0]==='team'?`team/${p[1]}${p[2]==='mon'?'/mon':''}`:p[0]||'teams';};
// A first visit with no address opens the welcome page once; after that the app opens on your teams.
const firstVisit=()=>{try{return !location.hash&&!localStorage.getItem(WELCOMED);}catch{return false;}};

// Old Pokémon links carried a configuration id (#team/<id>/mon/<version>/<config>/<slot>); they now open the current set.
const normalise=(hash:string)=>{const p=hash.split('/');return p[0]==='team'&&p[2]==='mon'&&p[4]?.startsWith('config-')?[...p.slice(0,4),p[5]].join('/'):hash;};
export default function App(){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[message,setMessage]=useState<{text:string;error?:boolean}|null>(null),[route,setRoute]=useState(normalise(location.hash.slice(1))||(firstVisit()?'welcome':'teams')),[importing,setImporting]=useState<false|{review?:{jobId:string;proposal:any}}>(false),[jobs,setJobs]=useState<any>(null),[report,setReport]=useState<string|null>(null),[newsOpen,setNewsOpen]=useState(false),[dockOpen,setDockOpenState]=useState(()=>{try{return localStorage.getItem('pokecoach.dock')==='open';}catch{return false;}});
  const [menuOpen,setMenuOpen]=useState(false);
  // Jade × Phosphor: the once-per-session boot, the screen switching on after it, and text that resolves from noise.
  // The landing page goes straight in; the boot belongs to the app and starts when you open it (see openApp).
  const [booting,setBooting]=useState(()=>shouldBoot()&&(normalise(location.hash.slice(1))||(firstVisit()?'welcome':'teams'))!=='welcome'),[powerOn,setPowerOn]=useState(false);
  const bootDone=()=>{setBooting(false);setPowerOn(true);setTimeout(()=>setPowerOn(false),1400);};
  const page=pageOf(route);const decodedPage=useRef('');
  useEffect(()=>{if(!data||booting||decodedPage.current===page)return;
    // A page can paint its title a few frames late; look for it briefly before giving up.
    let id=0,tries=0;const run=()=>{const titles=document.querySelectorAll('main h1');if(!titles.length&&++tries<30){id=requestAnimationFrame(run);return;}
      decodedPage.current=page;
      // Short titles (the Teams page) resolve too fast to read at 560ms, so they get a flicker and a slower resolve.
      titles.forEach(el=>{const short=(el.textContent??'').length<14;if(short)glitch(el);decode(el,{duration:short?900:560,lock:true});});};
    id=requestAnimationFrame(run);return()=>cancelAnimationFrame(id);},[page,!!data,booting]);
  useEffect(()=>{const over=(e:PointerEvent)=>{if(e.pointerType==='touch')return;const el=(e.target as HTMLElement).closest?.(DECODE_ON_HOVER);if(el&&!el.contains(e.relatedTarget as Node)){
      // Team names on the Teams page get the full title treatment: a flicker, then the same slow resolve as a page title.
      if(el.closest('.team-card')){glitch(el);hoverDecode(el,800);}else hoverDecode(el);}};
    addEventListener('pointerover',over,{passive:true});return()=>removeEventListener('pointerover',over);},[]);
  useEffect(()=>setMenuOpen(false),[route]);
  const setDockOpen=(b:boolean)=>{setDockOpenState(b);try{localStorage.setItem('pokecoach.dock',b?'open':'closed');}catch{}};
  // The latest saved revision, so consecutive saves in one handler don't trip the stale-edit check.
  const revision=useRef<number|null>(null);const dataRef=useRef<any>(null);const lastHash=useRef(location.hash);
  // Only the newest response is applied, so a slow reload never rolls the page back. Once the workspace is open, a failed
  // background refresh stays quiet (the next one catches up); only a first load that fails shows an error.
  const loadSeq=useRef(0),loadedAt=useRef(0);
  const load=useCallback(async()=>{const seq=++loadSeq.current;try{const d=await api('/dashboard');if(seq!==loadSeq.current)return;revision.current=d.db.revision;dataRef.current=d;loadedAt.current=Date.now();setData(d);setError('');}catch(e){if(seq===loadSeq.current&&!dataRef.current)setError((e as Error).message);}},[]);
  // Leaving a page with an unsaved draft asks first; declining puts the address back without reloading anything.
  useEffect(()=>{void load();const handler=()=>{if(location.hash===lastHash.current)return;if(hasDirty()&&!confirmDiscard()){history.replaceState(null,'',lastHash.current||'#teams');return;}
      const fixed=normalise(location.hash.slice(1));if(fixed!==location.hash.slice(1))history.replaceState(null,'','#'+fixed);lastHash.current=location.hash;setRoute(fixed||'teams');scrollTo({top:0});if(Date.now()-loadedAt.current>3000)void load();};
    addEventListener('hashchange',handler);return()=>removeEventListener('hashchange',handler);},[load]);
  useEffect(()=>{let alive=true;const tick=async()=>{try{const result=await api('/jobs');if(alive)setJobs(result);}catch{}};void tick();
    // No constant polling: local background jobs are checked every 10 s (local only); the workspace reloads when you come back to the tab.
    const timer=hostedSite?undefined:setInterval(()=>void tick(),10000);let last=Date.now();
    // Coming back to the tab picks up changes made elsewhere (another device, Claude or ChatGPT over the connector).
    const back=()=>{if(document.visibilityState==='visible'&&Date.now()-last>5000){last=Date.now();void load();}};document.addEventListener('visibilitychange',back);addEventListener('focus',back);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',back);removeEventListener('focus',back);};},[load]);
  useEffect(()=>{if(!message||message.error)return;const t=setTimeout(()=>setMessage(null),4000);return()=>clearTimeout(t);},[message]);
  const notify=(text:string,isError=false)=>setMessage({text,error:isError});
  // A save returns the saved teams: they replace the page's copy at once (replay links follow the new associations),
  // then a quiet full refresh catches anything else (replays, summaries) once saving settles.
  const apply=(w:any)=>{const d=dataRef.current;if(!w||!d)return;loadSeq.current++; // a reload already in flight would be older than this
    const next={...d,db:w.db,teams:w.teams,games:d.games.map((g:any)=>({...g,association:w.db.associations[g.id]??null}))};dataRef.current=next;setData(next);};
  const refreshTimer=useRef<any>(null);const refreshSoon=()=>{clearTimeout(refreshTimer.current);refreshTimer.current=setTimeout(()=>void load(),2500);};
  // Saves run one at a time in order, apply to the latest workspace on the server, and retry dropped connections.
  // They're silent: a save that truly fails (e.g. an illegal set, or a real clash) reports to the editor that made it.
  const queue=useRef<Promise<unknown>>(Promise.resolve());
  // A save that works clears a leftover error toast (e.g. a failed import retried successfully); other messages stay.
  const mutate=(action:any,{quiet=false,before,optimistic}:{quiet?:boolean;before?:(result:any)=>void;optimistic?:(data:any)=>any}={})=>{
    // An optimistic edit shows straight away; the saved workspace replaces it when the save lands (or a reload, if it fails).
    if(optimistic&&dataRef.current){const next=optimistic(structuredClone(dataRef.current));loadSeq.current++;dataRef.current=next;setData(next);}
    const run=async()=>{saving();
      for(let attempt=0;;attempt++){try{const result=await api('/action',{revision:revision.current,action});revision.current=result.revision;before?.(result);apply(result.workspace);saved();setMessage(m=>m?.error?null:m);refreshSoon();return result;}
        catch(e){const status=(e as ApiError).status;if((status===0||status>=500)&&attempt<3){await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
          failed((e as Error).message);if(status===409||optimistic)void load();if(!quiet)notify((e as Error).message,true);throw e;}}};
    const next=queue.current.then(run,run);queue.current=next.catch(()=>{});return next;};
  const run=async(kind:string)=>{try{await api('/jobs',{kind});setJobs(await api('/jobs'));notify('Started. Progress is shown beside this workflow.');}catch(e){notify((e as Error).message,true);}};
  const openReport=async(path:string)=>{try{setReport((await api('/report?path='+encodeURIComponent(path))).text);}catch(e){notify((e as Error).message,true);}};
  // Routes: teams · team/<id>/<tab>/<version|all> · team/<id>/mon/<version>/<slot>[/swap] · news · data · references
  const parts=route.split('/');const team=parts[0]==='team'?data?.teams.find((t:any)=>t.id===parts[1]):null;const pageData=data?{...data,jobs}:null;
  // Ask Frontier Brain is on every page: team pages give it the team (and Pokémon) in view; elsewhere it answers general questions.
  const dock:DockContext=team?parts[2]==='mon'?{page:'slot',versionId:parts[3],slot:Number(parts[4])}:{page:(({strategy:'strategy',coaching:'strategy',replays:'replays',history:'versions'} as any)[parts[2]]??'overview'),versionId:parts[3]??'all'}:{page:'general',versionId:'all',label:({data:'Data pool',news:'News',references:'References',account:'Settings'} as any)[parts[0]]??'Your teams'};
  const withDock=dockOpen;
  // "Open the app" on the landing page: mark it seen, run the boot (once per session), then open your teams.
  const openApp=()=>{try{localStorage.setItem(WELCOMED,'1');}catch{}if(shouldBoot())setBooting(true);location.hash='#teams';};
  // Ask Frontier Brain floats over the page as an overlay, so opening it never reflows the layout.
  return <div className={'shell'+(withDock?' dock-open':'')+(booting?' booting':'')+(powerOn?' power-on':'')}><BrainBackdrop route={route} booting={booting}/>{booting?<Boot data={data} error={error} onDone={bootDone}/>:<i className="screen-sweep" key={'sweep-'+page} aria-hidden="true"/>}{data&&route!=='welcome'&&<Ticker weeks={data.news} openNews={()=>setNewsOpen(true)}/>}{route==='welcome'?<header className="masthead landing-nav"><Brand/><ThemeToggle/>
      <a className="button lp-nav-src" href={REPO} target="_blank" rel="noreferrer"><GitHubMark/>View source</a><button className="primary lp-nav-go" onClick={openApp}>Open the app<span aria-hidden="true">→</span></button></header>
    :<header className={'masthead'+(menuOpen?' menu-open':'')}><Brand/><SavePill/>
      <ThemeToggle/><AccountMenu profile={data?.profile} reload={load} notify={notify}/>
      <button className="menu-toggle" aria-expanded={menuOpen} aria-controls="site-nav" aria-label={menuOpen?'Close menu':'Open menu'} onClick={()=>setMenuOpen(!menuOpen)}><Px icon={menuOpen?Close:MenuIcon}/></button>
      <div className="masthead-nav" id="site-nav" onClick={e=>{if((e.target as HTMLElement).closest('a'))setMenuOpen(false);}}>{data&&<QuickLinks sources={data.sources}/>}{data?.news?.length>0&&<button className="drawer-news" onClick={()=>{setMenuOpen(false);setNewsOpen(true);}}><Px icon={Zap}/>This week's news</button>}</div></header>}
    <main>{message&&<div className={'toast'+(message.error?' error':'')} role={message.error?'alert':'status'}>{message.text}<button className="icon" aria-label="Dismiss notification" onClick={()=>setMessage(null)}><Px icon={CloseIcon} size={16}/></button></div>}{error&&<div className="notice error">{error} <button onClick={()=>void load()}>Retry</button></div>}
    {!data?<Empty>Opening Frontier Brain…</Empty>:<>
      {data.legacyTeams?.length>0&&<Notice>{data.legacyTeams.length} CLI team records are ready to import. <button onClick={async()=>{try{await api('/migrate-legacy',{revision:data.db.revision});await load();notify('CLI teams imported; originals preserved.');}catch(e){notify((e as Error).message,true);}}}>Import CLI teams</button></Notice>}
      {route==='welcome'&&<Welcome data={data} onOpen={openApp}/>}
      {(route==='teams'||route==='dashboard')&&<TeamsLanding data={data} reload={load} onImport={()=>setImporting({})} onReview={review=>setImporting({review})}/>}
      {team&&parts[2]==='mon'&&<PokemonWorkspace team={team} data={pageData} mutate={mutate} versionId={parts[3]} slot={Number(parts[4])} swap={parts[5]==='swap'}/>}
      {team&&parts[2]!=='mon'&&<TeamHub key={team.id} team={team} data={pageData} mutate={mutate} notify={notify} load={load} tab={parts[2]??'overview'} versionId={parts[3]??'all'}/>}
      {route==='account'&&<><a href="#teams" className="text-button back-link"><Px icon={ArrowLeft} size={12}/>Teams</a><Settings profile={data.profile} reload={load} notify={notify}/></>}
      {route==='news'&&<><a href="#teams" className="text-button back-link"><Px icon={ArrowLeft} size={12}/>Teams</a><News weeks={data.news} jobs={jobs} run={run}/></>}
      {route==='data'&&<><a href="#teams" className="text-button back-link"><Px icon={ArrowLeft} size={12}/>Teams</a><DataPool art={data.art}/></>}
      {route==='references'&&<><a href="#teams" className="text-button back-link"><Px icon={ArrowLeft} size={12}/>Teams</a><Panel title="References"><p>Where Frontier Brain's teams, sets and results come from, plus the best sites to follow. <a href="#data">See the combined data</a>.</p><ReferenceGroups sources={data.sources}/><details><summary>Background research</summary><p>Monthly Smogon snapshots are Showdown ladder data, not the Champions in-game ladder. Tournament samples retain their event and stage. Neither is presented as a combined meta percentage.</p><button onClick={()=>void run('usage')}>Refresh research sources</button><button onClick={()=>void openReport('reports/metagame/2026-10-08-analysis.md')}>Saved research briefing</button><JobStatus jobs={jobs} kinds={['usage']}/></details></Panel></>}
      {parts[0]==='team'&&!team&&<Empty>Team not found. <a href="#teams">Back to teams.</a></Empty>}
    </>}</main><footer className="footer site-footer"><div className="footer-grid">
      <div className="footer-brand"><span className="footer-word">FRONTIER BRAIN</span><p>The open-source brain for Pokémon VGC. Teams, calcs and replay analysis, with the AI you already use.</p></div>
      <nav aria-label="Frontier Brain"><h4>App</h4><a href="#teams">Teams</a><a href="#data">Data pool</a><a href="#welcome">About</a></nav>
      <nav aria-label="Open source"><h4>Open source</h4><a href="https://github.com/SeanBrown156/frontierbrain" target="_blank" rel="noreferrer">View source</a><a href="https://github.com/SeanBrown156/frontierbrain/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT license</a><a href="mailto:seanwritesanddesigns@gmail.com">Contact</a></nav>
    </div>
    <div className="footer-legal">
      <p>Frontier Brain is an unofficial fan project, not affiliated with or endorsed by Nintendo, The Pokémon Company, Game Freak or Creatures. Pokémon and Pokémon character names are trademarks of Nintendo. Pokémon images © Pokémon / Nintendo / Creatures / GAME FREAK: HOME renders and item icons via PokéAPI and Pokémon Showdown. Pokémon Showdown is a separate fan project; its name, logo and a replay screenshot are shown for illustration.</p>
      <p>Frontier Brain is a product of Sean Writes &amp; Designs. © 2026 Sean Writes &amp; Designs. The source code is released under the MIT license. Contact: <span className="footer-mail">seanwritesanddesigns@gmail.com</span></p></div></footer>
    {pageData&&route!=='welcome'&&<AssistDock key={team?.id??'general'} team={team??null} data={pageData} context={dock} mutate={mutate} notify={notify} open={dockOpen} setOpen={setDockOpen} dataRef={dataRef}/>}
    {importing&&<NewTeam mutate={mutate} load={load} notify={notify} review={importing.review} onClose={()=>setImporting(false)}/>} {newsOpen&&data&&<Modal title="This week in Champions VGC" onClose={()=>setNewsOpen(false)}><News weeks={data.news} jobs={jobs} run={run}/></Modal>} {report!==null&&<Modal title="Research notebook" onClose={()=>setReport(null)}><Markdown text={report}/></Modal>}
  </div>;
}
// The wordmark. Every 20–40 s it either decodes or gives a short phosphor flicker, and it decodes once when you point
// at it. It stays still while the tab is hidden, a dialog is open or the boot is running.
function Brand(){
  const word=useRef<HTMLSpanElement>(null);
  useEffect(()=>{if(reduced())return;let timer:ReturnType<typeof setTimeout>;
    const next=()=>{timer=setTimeout(()=>{const el=word.current;
      if(el&&document.visibilityState==='visible'&&!document.querySelector('dialog[open],.shell.booting'))Math.random()<.5?decode(el,{duration:420,lock:true}):glitch(el);
      next();},20000+Math.random()*20000);};
    next();return()=>clearTimeout(timer);},[]);
  return <a href="#teams" className="brand" aria-label="Frontier Brain" onPointerEnter={e=>{if(e.pointerType!=='touch'&&word.current)hoverDecode(word.current,380);}}>
    <img className="brand-logo" src="/brand/icon-64.png" alt="" width={32} height={32}/><span ref={word} className="wordmark">Frontier Brain</span></a>;
}
// Light or dark glass. Follows the system until you choose; the choice is remembered in this browser.
function ThemeToggle(){
  const system=()=>'dark'; // dark is the default; the stored choice (set in index.html) wins
  const [theme,setTheme]=useState<string>(()=>document.documentElement.dataset.theme??system());
  const flip=()=>{const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('frontierbrain.theme',next);}catch{}setTheme(next);};
  return <button className="theme-toggle" onClick={flip} aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} title={theme==='dark'?'Light mode':'Dark mode'}>
    {theme==='dark'?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>
      :<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>}</button>;
}
// Saving is automatic and silent. The header only speaks up when a save failed; the next good save clears it.
function SavePill(){const {status}=useSaveState();
  return status.state==='error'?<span className="save-pill error" role="status" title={status.error}><Px icon={WarningDiamond} size={12}/>Couldn't save</span>:null;
}
// Headlines from the saved weekly briefings. A headline opens its source; anywhere else opens the week's briefing.
function Ticker({weeks,openNews}:{weeks:any[];openNews:()=>void}){
  const items=weeks.flatMap((w:any)=>[...(w.signals??[]).map((s:any)=>({text:s.title,tag:s.kind==='measured'?'DATA':s.kind==='community'?'CHATTER':'REPORT',url:w.articles.find((a:any)=>s.articleIds?.includes(a.id))?.url})),...w.articles.map((a:any)=>({text:a.title,tag:a.source,url:a.url}))]).slice(0,16);
  if(!items.length)return null;const row=(copy:string)=>items.map((x:any,i:number)=>x.url?<a key={copy+i} href={x.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}><b>{x.tag}</b> {x.text} ↗</a>:<span key={copy+i}><b>{x.tag}</b> {x.text}</span>);
  return <div className="ticker"><button className="ticker-label" onClick={openNews} aria-label="Open this week's news"><Px icon={Zap} size={12}/>THIS WEEK'S NEWS</button><span className="ticker-track"><span className="ticker-run">{row('a')}<span aria-hidden="true" className="ticker-copy">{row('b')}</span></span></span></div>;
}
// Reference links in a few dropdown groups. Calculators and team builders are deliberately absent.
const barGroups=[['data','Data',Chart],['results','Results',Trophy],['learn','Learn',BookOpen],['community','Community',Users],['play','Play',Play]] as const;
function QuickLinks({sources}:{sources:any[]}){
  const host=(u:string)=>{try{return new URL(u).hostname;}catch{return '';}};const [open,setOpen]=useState('');
  useEffect(()=>{const close=()=>setOpen('');addEventListener('click',close);return()=>removeEventListener('click',close);},[]);
  const link=(s:any)=><a key={s.id} href={s.url} target="_blank" rel="noreferrer" title={s.notes}><SiteIcon url={s.url} icon={s.icon} size={18}/><span>{s.name}<small>{s.notes}</small></span></a>;
  return <nav className="quickbar" aria-label="Quick links" onClick={e=>e.stopPropagation()}>{barGroups.map(([key,label,icon])=>{const rows=sources.filter(s=>s.bar===key).sort((a,b)=>a.barOrder-b.barOrder);return <div key={key} className={'quickbar-group'+(open===key?' open':'')}><button aria-expanded={open===key} onClick={()=>setOpen(open===key?'':key)}><Px icon={icon}/>{label}<Px icon={ChevronDown} size={12}/></button>{open===key&&<div className="quickbar-menu">{key==='data'&&<a href="#data" className="pool-link" onClick={()=>setOpen('')}><img src="/brand/icon-64.png" alt="" width={18} height={18}/><span>Frontier Brain<small>Teams, sets and results from every source here, combined in one place.</small></span></a>}{rows.map(link)}</div>}</div>;})}
<a className="quickbar-all" href="#references"><Px icon={Bookmark}/>All references</a></nav>;
}
function News({weeks,jobs,run}:{weeks:any[];jobs:any;run:(s:string)=>void}){const [selected,setSelected]=useState(0);const week=weeks[selected];if(!week)return <Empty>No weekly briefing saved.</Empty>;return <Panel title="News & team reports" kicker="WEEKLY BRIEFING" ><div className="week-tabs">{weeks.map((w:any,i:number)=><button key={w.start} className={selected===i?'selected':''} onClick={()=>setSelected(i)}>{i===0?'This week':date(w.start).replace(/,?\s*\d{4}$/,'')}<small>{w.partial?'In progress':'Weekly digest'}</small></button>)}</div><div className="weekly-digest"><span className="eyebrow">{date(week.start)} — {date(week.end)}</span>{week.digest.map((s:string,i:number)=><p key={i}>{s}</p>)}</div>{week.signals?.map((s:any,i:number)=><article className="news-signal" key={i}><span className="tag">{s.kind==='measured'?'Measured evidence':s.kind==='community'?'Community chatter':'Report takeaway'}</span><h3>{s.title}</h3><p>{s.summary}</p>{s.whyItMatters&&<p><strong>Why it matters:</strong> {s.whyItMatters}</p>}<div className="tags">{s.articleIds.map((id:string)=>{const a=week.articles.find((a:any)=>a.id===id);return a?<a className="text-button" key={id} href={a.url} target="_blank" rel="noreferrer">{a.source} ↗</a>:null;})}</div></article>)}<div className="articles">{week.articles.map((a:any)=><article key={a.id}><span className={'article-mark '+a.category}>{a.category==='report'?'▤':a.category==='community'?'◉':'★'}</span><div><div className="article-meta">{a.source} · {date(a.publishedAt)} · {a.category==='community'?'Anecdotal discussion':a.category}</div><a href={a.url} target="_blank" rel="noreferrer"><h3>{a.title} ↗</h3></a><p>{a.summary}</p><span className="muted">{a.format}</span></div></article>)}</div><details className="coverage"><summary>Sources, freshness & gaps</summary>{week.coverage.map((c:string,i:number)=><p key={i}>{c}</p>)}{week.researchedAt&&<span>Checked {date(week.researchedAt)}</span>}<p>Report summaries are attributed paraphrases, not endorsements.</p></details></Panel>;}
// Mirrors the top bar: the same groups and order, each link's role in the data pool, then the sources behind the
// app itself (rules, raw datasets, engine) in one short list. Calculators are omitted on purpose.
const catalogueGroups=[['data','Data'],['results','Results'],['learn','Learn'],['community','Community'],['play','Play']] as const;
function ReferenceGroups({sources}:{sources:any[];compact?:boolean}){
  const host=(u:string)=>{try{return new URL(u).hostname.replace(/^www\./,'');}catch{return '';}};
  const behind=sources.filter(s=>s.behind);
  const card=(s:any)=><article key={s.id} className="source-card"><a href={s.url} target="_blank" rel="noreferrer"><SiteIcon url={s.url} icon={s.icon} size={18}/>{s.name} ↗</a><p>{s.notes}</p><span className="muted tiny">{host(s.url)}</span></article>;
  return <div className="reference-groups">{catalogueGroups.map(([key,title])=>{const rows=sources.filter(s=>s.bar===key).sort((a,b)=>a.barOrder-b.barOrder);return rows.length?<section key={key}><h3>{title}</h3><div className="source-grid">{rows.map(card)}</div></section>:null;})}
    <section><h3>Built on</h3><p className="muted">The official rules and open-source engines Frontier Brain's calculators and format checks are built on.</p><div className="source-grid">{behind.map(card)}</div></section></div>;
}
