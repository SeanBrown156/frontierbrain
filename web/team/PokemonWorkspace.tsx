import {useState,useEffect,useRef,type ReactNode} from 'react';
import {setStrategyText,POKEMON_STRATEGY_TEMPLATE} from '../../shared/workbench.ts';
import type {SetRevision,SetNotes,PokemonSet,BankEntry} from '../../shared/workbench.ts';
import {api,Art,Notice,Empty,date,TypeBadges,ItemIcon,useDex,Markdown,SetArt,MegaBadge} from '../ui.tsx';
import {Px as Icon,Pencil,Check} from '../icons.tsx';
import {Px,ArrowLeft,WarningDiamond} from '../icons.tsx';
import BenchmarkLab from '../BenchmarkLab.tsx';
import Benchmarks from './Benchmarks.tsx';
import SpeciesPicker,{type SavedOption} from '../ai/SpeciesPicker.tsx';
import {ItemPicker,MovePicker} from '../ai/Pickers.tsx';
import {getView,versionName,stats,statLabel} from './editors.tsx';
import {teamHref,monHref} from './Hub.tsx';
import {useDraft,useDirty,useOffers,takeOffer} from '../save-state.ts';

const blank=():SetNotes=>({role:'',benchmarks:''});
type Draft={set:PokemonSet;notes:SetNotes};
type Meta={reuse?:boolean;basis?:string[];why?:string;noted?:boolean};
export type Mutate=(action:any,options?:{quiet?:boolean;before?:(result:any)=>void;optimistic?:(data:any)=>any})=>Promise<any>;
// Team → Pokémon: one editable set card (species, item, ability, nature, moves, stat points, notes) and the calc.
// Edits save automatically once the set is complete (logged in History; nothing earlier is lost).
// Older versions open read-only.
export default function PokemonWorkspace({team,data,mutate,versionId,slot,swap}:{team:any;data:any;mutate:Mutate;versionId:string;slot:number;swap?:boolean}){
  const view=getView(team,data.db,versionId);const current=view.revisions[slot];
  if(!current?.revision)return <Empty>That Pokémon slot doesn't exist. <a href={teamHref(team.id,'overview',versionId)}>Back to the team.</a></Empty>;
  return <div className="workspace">
    <div className="hub-head"><a href={teamHref(team.id,'overview',view.version.id)} className="text-button back-link"><Px icon={ArrowLeft} size={14}/>{team.name}</a></div>
    <nav className="mon-switcher" aria-label="Team members">{view.revisions.map((r,i)=><a key={i} href={monHref(team.id,view.version.id,i)} className={i===slot?'selected':''} aria-current={i===slot?'page':undefined}><span className="slot-no">{String(i+1).padStart(2,'0')}</span><SetArt set={r.revision.set} art={data.art} small/><span className="slot-name">{r.revision.set.species}</span></a>)}</nav>
    <SetWorkspace key={`${view.version.id}-${slot}`} team={team} data={data} mutate={mutate} view={view} slot={slot} swap={swap}/>
  </div>;
}

// A Bench candidate is edited with the same workspace: its saves go to the bench entry instead of a team slot.
export interface Candidate {id:string;entry:BankEntry;revision:SetRevision;others:PokemonSet[];}
export function SetWorkspace({team,data,mutate,view,slot,swap,candidate}:{team:any;data:any;mutate:Mutate;view:any;slot:number;swap?:boolean;candidate?:Candidate}){
  const {entry,revision}=(candidate??view.revisions[slot]) as {entry:BankEntry;revision:SetRevision};const at=candidate?`bench-${candidate.id}`:String(slot);
  const others:PokemonSet[]=candidate?candidate.others:view.sets.filter((_:any,i:number)=>i!==slot);const readOnly=!candidate&&view.version.id!==team.activeVersionId;
  // Where the current draft came from (an AI suggestion, a usage-data fill, a restored set). Recorded with the next save.
  const [meta,setMeta]=useState<Meta>({});
  const d=useDraft<Draft>(`set-${team.id}-${at}`,{set:revision.set,notes:revision.notes},revision.id,`${revision.set.species}`,{guard:false});
  const set=d.draft.set;const problems=checkSet(set,others);
  useDirty(`set-${team.id}-${at}`,d.dirty&&problems.length>0&&!readOnly,`${set.species} (not saved: ${problems[0]??''})`);
  const [error,setError]=useState(''),[loading,setLoading]=useState('');
  const update=(patch:Partial<PokemonSet>)=>{d.setDraft(x=>({...x,set:{...x.set,...patch}}));setMeta(m=>({...m,reuse:false}));};
  const replace=(next:PokemonSet,m:Meta,strategy?:string)=>{d.setDraft(x=>({...x,set:structuredClone(next),...strategy?{notes:{role:strategy,benchmarks:''}}:{}}));setMeta(strategy?{...m,noted:true}:m);};
  // Picking a species fills its most expected set from the data pool (items already on the team are skipped).
  const pickSpecies=async(species:string)=>{setLoading(species);setError('');try{const avoid=others.map((s:any)=>s.item).filter(Boolean).join('|');const r=await api(`/typical-set?species=${encodeURIComponent(species)}&avoid=${encodeURIComponent(avoid)}`);d.setDraft(()=>({set:r.set,notes:blank()}));setMeta({basis:r.basis});}
    catch(e){d.setDraft(()=>({set:{species,ability:'',item:'',nature:'Serious',moves:[],statPoints:{}},notes:blank()}));setMeta({basis:[`No usage data for ${species}: fill the set in by hand. (${(e as Error).message})`]});}finally{setLoading('');}};
  const savedSets:SavedOption[]=data.db.bank.flatMap((b:BankEntry)=>b.revisions.filter(r=>r.starred).map(r=>({id:r.id,label:r.starred!.label,species:r.set.species,value:r})));
  const [starring,setStarring]=useState(false),[starLabel,setStarLabel]=useState('');
  useOffers(`set:${team.id}:${at}`,p=>{replace(p.set,{why:p.why},p.strategy);scrollTo({top:0,behavior:'smooth'});return true;});
  useEffect(()=>{const p=takeOffer(`set:${team.id}:${at}`);if(p)replace(p.set,{why:p.why},p.strategy);},[]);

  // Autosave: a moment after the last edit (or straight away when you leave), the set is saved if it's complete.
  // One save at a time; edits made meanwhile go in the next one. A burst of edits amends one history entry.
  const latest=useRef({draft:d.draft,meta,dirty:d.dirty,valid:!problems.length&&!readOnly});latest.current={draft:d.draft,meta,dirty:d.dirty,valid:!problems.length&&!readOnly};
  const baseRef=useRef(d.base);useEffect(()=>{baseRef.current=d.base;},[d.base]);
  const mine=useRef(new Set<string>()),start=useRef(revision.set),inflight=useRef<Promise<void>|null>(null),again=useRef(false);
  const flush=():Promise<void>=>{if(inflight.current){again.current=true;return inflight.current;}
    const {draft,meta:m,dirty,valid}=latest.current;if(!dirty||!valid)return Promise.resolve();
    d.markSaving(draft);const base=baseRef.current;const note=m.why?`AI: ${m.why}`:m.basis?.join(' ');
    const action=candidate?{type:'bench-update',teamId:team.id,benchId:candidate.id,baseRevisionId:base,set:draft.set,notes:draft.notes,reuse:!!m.reuse,amend:mine.current.has(base)}
      :{type:'team-replace-sets',teamId:team.id,versionId:view.version.id,sets:[{slot,set:draft.set,notes:draft.notes,baseRevisionId:base,reuse:!!m.reuse,amend:mine.current.has(base),note:m.noted?undefined:note}],summary:summarise(start.current,draft.set)};
    const run=mutate(action,
      {quiet:true,optimistic:data=>{const t=data.db.teams.find((x:any)=>x.id===team.id);const v=t?.versions.find((x:any)=>x.id===view.version.id);const c=v?.configurations.find((x:any)=>x.id===v.currentConfigurationId);const sl=candidate?t?.bench?.find((b:any)=>b.id===candidate.id):c?.slots[slot];const r=data.db.bank.find((b:any)=>b.id===sl?.bankId)?.revisions.find((x:any)=>x.id===sl?.revisionId);if(r){r.set=structuredClone(draft.set);r.notes=structuredClone(draft.notes);}return data;},before:r=>{const id=candidate?r?.result?.revisionId:r?.result?.revisionIds?.[slot];if(id){mine.current.add(id);baseRef.current=id;d.markSaved(id);}}})
      .then(()=>{setError('');if(note)setMeta(x=>x===m?{...x,noted:true}:x);},e=>{d.markFailed();setError((e as Error).message);})
      .finally(()=>{inflight.current=null;if(again.current){again.current=false;void flush();}});
    inflight.current=run;return run;};
  const draftKey=JSON.stringify(d.draft);
  useEffect(()=>{if(!d.dirty||problems.length||readOnly)return;const t=setTimeout(()=>void flush(),800);return()=>clearTimeout(t);},[draftKey]);
  useEffect(()=>{const leave=()=>void flush();addEventListener('pagehide',leave);return()=>{removeEventListener('pagehide',leave);leave();};},[]);

  // "My sets": star the set as saved (saving any pending edits first).
  const star=async()=>{await flush();try{await mutate(candidate?{type:'set-star',bankId:entry.id,revisionId:revision.id,label:starLabel}:{type:'set-star',teamId:team.id,versionId:view.version.id,slot,label:starLabel});setStarring(false);setStarLabel('');}catch{}};
  const inferred=(k:keyof NonNullable<SetRevision['fields']>)=>revision.provenance==='observed'&&revision.fields?.[k]==='inferred'&&JSON.stringify(revision.set[k])===JSON.stringify(set[k]);
  const megaForm=(useDex([set.species],[]).megas[set.species]??[]).find(m=>m.item===set.item);
  const pending=d.dirty&&!readOnly&&(problems[0]??error);const isStarred=!!revision.starred&&!d.dirty;
  // One notes field. Older records split notes into four; they show here merged under headings, and the first edit saves the merged text.
  const notesText=mergeNotes(d.draft.notes);
  return <><div className="workspace-grid">
    <div className="set-column">
    <section className={'set-card panel'+(readOnly?' read-only':'')} aria-label={`${set.species} set`}>
      {readOnly&&<div className="notice warn">This is {versionName(view.version)}, an older version (read-only). <a href={monHref(team.id,team.activeVersionId,slot)}>Edit the current team →</a></div>}
      <fieldset className="plain" disabled={readOnly}>
      {d.changedElsewhere&&<div className="notice warn">This Pokémon was changed elsewhere (e.g. accepted from Ask Frontier Brain). <span className="button-row"><button onClick={d.loadLatest}>Load latest</button><button onClick={d.keepMine}>Keep my edits</button></span></div>}
      <div className="set-card-head"><div className="art-wrap"><Art name={megaForm?.name??set.species} fallback={set.species} art={data.art}/>
        {!readOnly&&<button type="button" className={'fav'+(isStarred?' on':'')} aria-pressed={isStarred} aria-label={isStarred?`In My sets as “${revision.starred!.label}”. Remove from My sets`:'Save to My sets'} title={isStarred?`In My sets: ${revision.starred!.label} (click to remove)`:'Save to My sets'}
          onClick={()=>{if(isStarred)void mutate({type:'set-unstar',bankId:entry.id,revisionId:revision.id}).catch(()=>{});else setStarring(!starring);}}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg></button>}
        {starring&&!isStarred&&<div className="fav-pop" role="dialog" aria-label="Save to My sets"><label>Name for My sets<input autoFocus placeholder={`e.g. Bulky TR ${set.species}`} value={starLabel} onChange={e=>setStarLabel(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void star();if(e.key==='Escape')setStarring(false);}}/></label><div className="button-row"><button className="primary" onClick={()=>void star()} disabled={problems.length>0||!starLabel.trim()}>Save</button><button onClick={()=>setStarring(false)}>Cancel</button></div>{problems.length>0&&<p className="footnote">Finish the set first: {problems[0]}</p>}</div>}</div><div className="grow">
        <SpeciesPicker label="Species" value={set.species} onPick={sp=>void pickSpecies(sp)} onPickSaved={o=>replace(o.value.set,{reuse:true,basis:[`Reusing your saved set: ${o.label}.`]})} disabled={others.map((s:any)=>s.species)} saved={savedSets} autoFocus={swap}/>
        <div className="set-types"><TypeBadges species={megaForm?.name??set.species}/>{megaForm&&<MegaBadge title={`Battles as Mega ${set.species}`}/>}{isStarred&&<span className="fav-label">★ {revision.starred!.label}</span>}</div>
        {loading&&<p className="muted">Loading the most common {loading} set…</p>}
        <input className="nickname" aria-label="Nickname" placeholder="Nickname (optional)" value={set.nickname??''} onChange={e=>update({nickname:e.target.value||undefined})}/></div></div>
      {(meta.basis||meta.why)&&<ul className="basis">{meta.why&&<li>AI: {meta.why}</li>}{meta.basis?.map((b,i)=><li key={i}>{b}</li>)}</ul>}
      {pending&&<p className="set-pending" role="status"><Px icon={WarningDiamond} size={12}/>Not saved yet: {pending}</p>}
      <SetFields set={set} update={update} inferred={inferred} others={others}/>
      <History entry={entry} revision={revision} load={r=>replace(r.set,{reuse:true,basis:[`Restored the ${date(r.createdAt)} set.`]})}/>
      </fieldset>
    </section>
    <section className="panel set-benchmarks"><Benchmarks entry={entry} set={set} data={data} mutate={mutate}/></section>
    <SetStrategy species={set.species} text={notesText} readOnly={readOnly} onChange={t=>d.setDraft(x=>({...x,notes:{role:t,benchmarks:''}}))}/>
    </div>
    <BenchmarkLab offerKey={`calc:${team.id}:${at}`} entry={entry} revision={revision} own={set} data={data} mutate={mutate} onUseSpread={(nature,statPoints)=>update({nature,statPoints})}/>
  </div>
</>;
}

// The set's fields. Fields guessed from replays (observed sets) carry a "guess" tag until edited.
function SetFields({set,update,inferred,others}:{set:PokemonSet;update:(p:Partial<PokemonSet>)=>void;inferred:(k:any)=>boolean;others:PokemonSet[]}){
  const [dex,setDex]=useState<any>(null),[final,setFinal]=useState<any>(null);
  // Species data (base stats, abilities, Megas). A failed request (e.g. the API restarting) retries rather than leaving the card blank.
  useEffect(()=>{let alive=true,timer:any;setDex((d:any)=>d?.species?.name===set.species?d:null);
    const load=(n:number)=>api('/dex?species='+encodeURIComponent(set.species)).then(r=>{if(alive)setDex(r);}).catch(()=>{if(alive&&n<5)timer=setTimeout(()=>load(n+1),800*(n+1));});
    load(0);return()=>{alive=false;clearTimeout(timer);};},[set.species]);
  // A Mega stone holder battles as the Mega, so its stats are shown by default (toggle to the base form).
  const [form,setForm]=useState<'mega'|'base'>('mega');const mega=dex?.species?.megas?.find((m:any)=>m.item===set.item);const shown=mega&&form==='mega'?mega:dex?.species;
  const key=JSON.stringify({species:shown?.name??set.species,nature:set.nature,statPoints:set.statPoints});
  useEffect(()=>{let alive=true;api('/calculate',{kind:'stats',input:JSON.parse(key)}).then(r=>{if(alive)setFinal(r);}).catch(()=>{if(alive)setFinal(null);});return()=>{alive=false;};},[key]);
  const guess=(k:string)=>inferred(k)?<span className="guess" title="Guessed from replays; edit it or leave it as an assumption">guess</span>:null;
  const abilities=[...new Set([...(dex?.species?.abilities??[]),set.ability].filter(Boolean))];const total=stats.reduce((n,k)=>n+(set.statPoints?.[k]??0),0);
  const taken=new Set(others.map(o=>o.item).filter(Boolean));
  return <div className="set-fields">
    <div className="form-grid">
      <label className="item-field">Item {guess('item')}<ItemPicker value={set.item??''} onChange={v=>update({item:v})} dex={dex} taken={[...taken].filter(Boolean) as string[]}/></label>
      <label>Ability {guess('ability')}<select value={set.ability??''} onChange={e=>update({ability:e.target.value})}>{abilities.map(a=><option key={a}>{a}</option>)}</select></label>
      <label>Nature {guess('nature')}<select value={set.nature??'Serious'} onChange={e=>update({nature:e.target.value})}>{(dex?.natures??[set.nature]).map((n:string)=><option key={n}>{n}</option>)}</select></label>
    </div>
    <fieldset className="moves"><legend>Moves {guess('moves')}</legend><div className="form-grid">{[0,1,2,3].map(i=><MovePicker key={i} label={`Move ${i+1}`} dex={dex} value={set.moves?.[i]??''} exclude={(set.moves??[]).filter(Boolean) as string[]} onChange={v=>{const moves=[...(set.moves??[])];while(moves.length<4)moves.push('');moves[i]=v;update({moves});}}/>)}</div></fieldset>
    <fieldset className="stat-points"><legend>Stat points <b className={total>66?'error':''}>{total} / 66</b> {guess('statPoints')}</legend>
      <StatBars base={shown?.baseStats} final={final} points={set.statPoints??{}} setPoint={(k,v)=>update({statPoints:{...set.statPoints,[k]:v}})}
        head={mega?<div className="segmented stat-form" role="group" aria-label="Stats for">{[['mega',mega.name.replace(/^(.*)-Mega(-[XYZ])?$/,(_:string,b:string,x?:string)=>`Mega ${b}${x?' '+x.slice(1):''}`)],['base',set.species]].map(([v,l])=><button key={v} type="button" className={form===v?'on':''} aria-pressed={form===v} onClick={()=>setForm(v as any)}>{l}</button>)}</div>:null}/></fieldset>
    <datalist id="set-items">{dex?.items.map((m:string)=><option key={m} value={m}/>)}</datalist><datalist id="set-moves">{dex?.moves.map((m:string)=><option key={m} value={m}/>)}</datalist>
  </div>;
}

// Stat bars: the species' base stat, with the stat points added on the end, then the final level-50 stat.
// Final stats come from the server (pinned Champions formula); the nature arrow is read off them.
const BAR_SCALE=220;const barWidth=(v:number)=>`${Math.min(100,100*v/BAR_SCALE)}%`;const baseColour=(v:number)=>`hsl(${Math.min(180,Math.round(v*180/255))} 55% 45%)`;
function StatBars({base,final,points,setPoint,head}:{base?:Record<string,number>;final:any;points:Record<string,number>;setPoint:(k:string,v:number)=>void;head?:ReactNode}){
  const bst=base?stats.reduce((n,k)=>n+base[k],0):null;
  return <div className="stat-bars">
    <div className="stat-bars-head">{head}<span className="muted">{bst?`Base total ${bst}`:''}</span><span className="stat-key"><i className="key-base"/>Base <i className="key-sp"/>Stat points</span></div>
    {stats.map(k=>{const b=base?.[k]??0,sp=points[k]??0,f=final?.[k];const nat=k==='hp'||f==null||!base?0:Math.sign(f-(b+sp+20));
      return <label key={k} className="stat-row"><span className="stat-name">{statLabel[k]}{nat>0?<b className="nat up" title="Nature +10%">↑</b>:nat<0?<b className="nat down" title="Nature −10%">↓</b>:null}</span>
        <span className="stat-bar" title={base?`Base ${b} + ${sp} stat points${nat?`, nature ${nat>0?'+':'−'}10%`:''} = ${f??'…'}`:''}><span className="base" style={{width:barWidth(b),background:baseColour(b)}}/><span className="sp" style={{width:barWidth(sp)}}/></span>
        <span className="stat-base">{base?b:'—'}{sp>0&&<b className="stat-plus">+{sp}</b>}</span>
        <input type="number" min="0" max="32" aria-label={`${statLabel[k]} stat points`} value={sp} onChange={e=>setPoint(k,Math.max(0,Math.min(32,Number(e.target.value)||0)))}/>
        <output className={'stat-final'+(nat>0?' up':nat<0?' down':'')}>{f??'—'}</output></label>;})}
  </div>;
}

function History({entry,revision,load}:{entry:BankEntry;revision:SetRevision;load:(r:SetRevision)=>void}){
  const [all,setAll]=useState(false);if(entry.revisions.length<2)return null;const list=[...entry.revisions].reverse();const shown=all?list:list.slice(0,3);
  return <fieldset className="set-history"><legend>History <b>{list.length}</b></legend><ol>{shown.map(r=><li key={r.id} className={r.id===revision.id?'current':''}>
      <span className="h-date">{date(r.createdAt)}</span><span className="h-set">{r.set.item||'No item'} · {r.set.nature}</span><span className="h-sp">{stats.map(k=>r.set.statPoints?.[k]??0).join('/')}</span>
      {r.id===revision.id?<span className="tag ok">Now</span>:<button type="button" className="compact" onClick={()=>load(r)}>Restore</button>}</li>)}</ol>
    {list.length>3&&<button type="button" className="text-button h-more" onClick={()=>setAll(!all)}>{all?'Show less':`Show all ${list.length}`}</button>}</fieldset>;
}

// The Pokémon's strategy: Markdown that reads as a short guide, with Edit to change it (it saves with the set).
function SetStrategy({species,text,readOnly,onChange}:{species:string;text:string;readOnly:boolean;onChange:(t:string)=>void}){
  const [editing,setEditing]=useState(false);
  return <section className="panel set-notes"><header className="panel-heading"><h2>Strategy</h2>{!readOnly&&(editing?<button onClick={()=>setEditing(false)}><Icon icon={Check}/>Done</button>:<button onClick={()=>setEditing(true)}><Icon icon={Pencil}/>Edit</button>)}</header>
    {editing?<label className="set-notes-edit"><span className="sr-only">Strategy for {species} (Markdown)</span><textarea autoFocus rows={Math.max(8,text.split('\n').length+2)} placeholder={POKEMON_STRATEGY_TEMPLATE} value={text} onChange={e=>onChange(e.target.value)}/></label>
      :text.trim()?<div className="set-guide"><Markdown text={text}/></div>:<p className="muted">No strategy yet.</p>}</section>;
}
const mergeNotes=setStrategyText;
export function checkSet(set:PokemonSet,others:PokemonSet[]){
  const out:string[]=[];const moves=(set.moves??[]).filter(m=>m.trim());
  if(!set.species)out.push('Choose a Pokémon.');if(moves.length!==4)out.push('Give it four moves.');else if(new Set(moves).size!==4)out.push('Moves must be different.');
  const total=stats.reduce((n,k)=>n+(set.statPoints?.[k]??0),0);if(total>66)out.push(`Stat points total ${total}; the maximum is 66.`);
  if(set.item&&others.some(o=>o.item===set.item))out.push(`${set.item} is already held by another team member.`);
  if(others.some(o=>o.species.split('-')[0]===set.species.split('-')[0]))out.push(`${set.species} is already on the team.`);
  return out;
}
// A short label for the change list, e.g. "Mawile: item Mawilite → Life Orb, spread".
export function summarise(before:PokemonSet,after:PokemonSet){
  if(before.species!==after.species)return `Swapped ${before.species} → ${after.species}`;
  const parts:string[]=[];if(before.item!==after.item)parts.push(`item ${before.item||'none'} → ${after.item||'none'}`);if(before.ability!==after.ability)parts.push(`ability → ${after.ability}`);if(before.nature!==after.nature)parts.push(`nature → ${after.nature}`);
  const added=(after.moves??[]).filter(m=>!before.moves?.includes(m));if(added.length)parts.push(`moves +${added.join(', +')}`);if(JSON.stringify(before.statPoints)!==JSON.stringify(after.statPoints))parts.push('spread');if(before.nickname!==after.nickname)parts.push('nickname');
  return `${after.species}: ${parts.join(', ')||'notes'}`;
}
