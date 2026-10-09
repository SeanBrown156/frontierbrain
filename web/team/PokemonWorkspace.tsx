import {useState,useEffect,type ReactNode} from 'react';
import type {SetRevision,SetNotes,PokemonSet,BankEntry} from '../../shared/workbench.ts';
import {api,Art,Notice,Empty,date} from '../ui.tsx';
import {Px,ArrowLeft} from '../icons.tsx';
import BenchmarkLab from '../BenchmarkLab.tsx';
import SpeciesPicker,{type SavedOption} from '../ai/SpeciesPicker.tsx';
import {getView,versionName,stats,statLabel,noteTitles} from './editors.tsx';
import {teamHref,monHref} from './Hub.tsx';
import {useDraft,useOffers,takeOffer,saving} from '../save-state.ts';

const blank=():SetNotes=>({role:'',benchmarks:'',partners:'',matchups:''});
type Draft={set:PokemonSet;notes:SetNotes;reuse?:boolean;basis?:string[];why?:string};
// Team → Pokémon: one editable set card (species, item, ability, nature, moves, stat points, notes) and the calc.
// Edits stay a draft until Save; saving updates the current team (logged as an edit; nothing earlier is lost).
// Older versions open read-only.
export default function PokemonWorkspace({team,data,mutate,versionId,slot,swap}:{team:any;data:any;mutate:(a:any)=>Promise<any>;versionId:string;slot:number;swap?:boolean}){
  const view=getView(team,data.db,versionId);const current=view.revisions[slot];
  if(!current?.revision)return <Empty>That Pokémon slot doesn't exist. <a href={teamHref(team.id,'overview',versionId)}>Back to the team.</a></Empty>;
  return <div className="workspace">
    <div className="hub-head"><a href={teamHref(team.id,'overview',view.version.id)} className="text-button"><Px icon={ArrowLeft} size={12}/>{team.name} · {versionName(view.version)}</a>
      <nav className="mon-switcher" aria-label="Team members">{view.revisions.map((r,i)=><a key={i} href={monHref(team.id,view.version.id,i)} className={i===slot?'selected':''} title={r.revision.set.species} aria-current={i===slot?'page':undefined}><Art name={r.revision.set.species} art={data.art} small/></a>)}</nav></div>
    <SetWorkspace key={`${view.version.id}-${slot}`} team={team} data={data} mutate={mutate} view={view} slot={slot} swap={swap}/>
  </div>;
}

function SetWorkspace({team,data,mutate,view,slot,swap}:{team:any;data:any;mutate:(a:any)=>Promise<any>;view:any;slot:number;swap?:boolean}){
  const {entry,revision}=view.revisions[slot] as {entry:BankEntry;revision:SetRevision};
  const d=useDraft<Draft>(`set-${team.id}-${slot}`,{set:revision.set,notes:revision.notes},revision.id,`${revision.set.species}`);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState('');
  const set=d.draft.set;const others=view.sets.filter((_:any,i:number)=>i!==slot);
  const update=(patch:Partial<PokemonSet>)=>d.setDraft(x=>({...x,set:{...x.set,...patch},reuse:false}));
  // Picking a species fills its most expected set from the data pool (items already on the team are skipped).
  const pickSpecies=async(species:string)=>{setLoading(species);setError('');try{const avoid=others.map((s:any)=>s.item).filter(Boolean).join('|');const r=await api(`/typical-set?species=${encodeURIComponent(species)}&avoid=${encodeURIComponent(avoid)}`);d.setDraft(()=>({set:r.set,notes:blank(),basis:r.basis}));}
    catch(e){d.setDraft(()=>({set:{species,ability:'',item:'',nature:'Serious',moves:[],statPoints:{}},notes:blank(),basis:[`No usage data for ${species}: fill the set in by hand. (${(e as Error).message})`]}));}finally{setLoading('');}};
  const savedSets:SavedOption[]=data.db.bank.flatMap((b:BankEntry)=>b.revisions.filter(r=>r.starred).map(r=>({id:r.id,label:r.starred!.label,species:r.set.species,value:r})));
  const readOnly=view.version.id!==team.activeVersionId;const [starring,setStarring]=useState(false),[starLabel,setStarLabel]=useState('');
  useOffers(`set:${team.id}:${slot}`,p=>{d.setDraft(x=>({...x,set:p.set,why:p.why,basis:undefined,reuse:false}));scrollTo({top:0,behavior:'smooth'});return true;});
  useEffect(()=>{const p=takeOffer(`set:${team.id}:${slot}`);if(p)d.setDraft(x=>({...x,set:p.set,why:p.why,reuse:false}));},[]);
  const problems=checkSet(set,others);
  const save=async()=>{if(readOnly)return false;if(problems.length){setError(problems.join(' '));return false;}setBusy(true);setError('');d.markSaving();saving();
    try{const r=await mutate({type:'team-replace-sets',teamId:team.id,versionId:view.version.id,sets:[{slot,set,notes:d.draft.notes,baseRevisionId:d.base,reuse:!!d.draft.reuse,note:d.draft.why?`AI: ${d.draft.why}`:d.draft.basis?.join(' ')}],summary:summarise(revision.set,set)});return !!r;}
    catch(e){d.markFailed();setError((e as Error).message);return false;}finally{setBusy(false);}};
  // "My sets": star the set as saved (saving the draft first if needed).
  const star=async()=>{if(d.dirty&&!(await save()))return;try{await mutate({type:'set-star',teamId:team.id,versionId:view.version.id,slot,label:starLabel});setStarring(false);setStarLabel('');}catch{}};
  const inferred=(k:keyof NonNullable<SetRevision['fields']>)=>revision.provenance==='observed'&&revision.fields?.[k]==='inferred'&&JSON.stringify(revision.set[k])===JSON.stringify(set[k]);
  return <div className="workspace-grid">
    <section className={'set-card panel'+(d.dirty?' dirty':'')+(readOnly?' read-only':'')} aria-label={`${set.species} set`}>
      {readOnly&&<div className="notice warn">This is {versionName(view.version)}, an older version (read-only). <a href={monHref(team.id,team.activeVersionId,slot)}>Edit the current team →</a></div>}
      <fieldset className="plain" disabled={readOnly}>
      {d.changedElsewhere&&<div className="notice warn">This Pokémon was changed elsewhere (e.g. accepted from Ask Frontier Brain). <button onClick={d.loadLatest}>Load latest</button><button onClick={d.keepMine}>Keep my edits</button></div>}
      <div className="set-card-head"><Art name={set.species} art={data.art}/><div className="grow">
        <SpeciesPicker label="Species" value={set.species} onPick={sp=>void pickSpecies(sp)} onPickSaved={o=>d.setDraft(x=>({...x,set:structuredClone(o.value.set),reuse:true,basis:[`Reusing your saved set: ${o.label}.`]}))} disabled={others.map((s:any)=>s.species)} saved={savedSets} autoFocus={swap}/>
        {loading&&<p className="muted">Loading the most common {loading} set…</p>}
        <input className="nickname" aria-label="Nickname" placeholder="Nickname (optional)" value={set.nickname??''} onChange={e=>update({nickname:e.target.value||undefined})}/></div></div>
      {(d.draft.basis||d.draft.why)&&<ul className="basis">{d.draft.why&&<li>AI: {d.draft.why}</li>}{d.draft.basis?.map((b,i)=><li key={i}>{b}</li>)}</ul>}
      <SetFields set={set} update={update} inferred={inferred} others={others}/>
      <details className="set-notes-edit"><summary>Notes</summary>{(Object.keys(noteTitles) as (keyof SetNotes)[]).map(k=><label key={k}>{noteTitles[k]}<textarea rows={2} value={d.draft.notes[k]} onChange={e=>d.setDraft(x=>({...x,notes:{...x.notes,[k]:e.target.value}}))}/></label>)}</details>
      <History entry={entry} revision={revision} load={r=>d.setDraft(x=>({...x,set:structuredClone(r.set),reuse:true,basis:[`Restoring the ${date(r.createdAt)} set.`]}))}/>
      {!readOnly&&(revision.starred&&!d.dirty?<p className="my-set">★ In My sets as “{revision.starred.label}” <button className="text-button" onClick={()=>void mutate({type:'set-unstar',bankId:entry.id,revisionId:revision.id}).catch(()=>{})}>Remove</button></p>
        :starring?<div className="star-form"><input autoFocus aria-label="Name for My sets" placeholder={`e.g. Bulky TR ${set.species}`} value={starLabel} onChange={e=>setStarLabel(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void star();if(e.key==='Escape')setStarring(false);}}/><button className="primary" onClick={()=>void star()} disabled={busy||problems.length>0}>{d.dirty?'Save & add':'Add'}</button><button onClick={()=>setStarring(false)}>Cancel</button></div>
        :<button className="text-button star-button" onClick={()=>setStarring(true)}>☆ Save to My sets</button>)}
      </fieldset>
      {(d.dirty||error)&&<div className="save-bar" role="region" aria-label="Unsaved changes">{error?<span className="error">{error}</span>:<span>{problems.length?<span className="error">{problems[0]}</span>:'Unsaved changes'}</span>}
        <div className="button-row"><button onClick={()=>{d.discard();setError('');}} disabled={busy}>Discard</button><button className="primary" onClick={()=>void save()} disabled={busy||!d.dirty||readOnly}>{busy?'Saving…':'Save'}</button></div></div>}
    </section>
    <BenchmarkLab entry={entry} revision={revision} own={set} data={data} mutate={mutate} onUseSpread={(nature,statPoints)=>update({nature,statPoints})}/>
  </div>;
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
      <label>Item {guess('item')}<input list="set-items" value={set.item??''} onChange={e=>update({item:e.target.value})} className={set.item&&taken.has(set.item)?'invalid':''}/></label>
      <label>Ability {guess('ability')}<select value={set.ability??''} onChange={e=>update({ability:e.target.value})}>{abilities.map(a=><option key={a}>{a}</option>)}</select></label>
      <label>Nature {guess('nature')}<select value={set.nature??'Serious'} onChange={e=>update({nature:e.target.value})}>{(dex?.natures??[set.nature]).map((n:string)=><option key={n}>{n}</option>)}</select></label>
    </div>
    <fieldset className="moves"><legend>Moves {guess('moves')}</legend><div className="form-grid">{[0,1,2,3].map(i=><input key={i} aria-label={`Move ${i+1}`} list="set-moves" value={set.moves?.[i]??''} onChange={e=>{const moves=[...(set.moves??[])];while(moves.length<4)moves.push('');moves[i]=e.target.value;update({moves});}}/>)}</div></fieldset>
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
        <span className="stat-base">{base?b:'—'}</span>
        <input type="number" min="0" max="32" aria-label={`${statLabel[k]} stat points`} value={sp} onChange={e=>setPoint(k,Math.max(0,Math.min(32,Number(e.target.value)||0)))}/>
        <output className={'stat-final'+(nat>0?' up':nat<0?' down':'')}>{f??'—'}</output></label>;})}
  </div>;
}

function History({entry,revision,load}:{entry:BankEntry;revision:SetRevision;load:(r:SetRevision)=>void}){
  if(entry.revisions.length<2)return null;
  return <details className="history"><summary>Undo history</summary><ol>{[...entry.revisions].reverse().slice(0,6).map(r=><li key={r.id} className={r.id===revision.id?'current':''}><span>{date(r.createdAt)} · {r.set.item||'no item'} · {r.set.nature} · {stats.map(k=>r.set.statPoints?.[k]??0).join('/')}</span>
    {r.id===revision.id?<span className="muted">now</span>:<button className="text-button" onClick={()=>load(r)}>Go back to this</button>}</li>)}</ol></details>;
}

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
