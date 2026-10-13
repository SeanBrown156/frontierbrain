import {useState} from 'react';
import {api,Modal,Empty,SetArt,Markdown} from '../ui.tsx';
import {Px,Plus,Trash,ArrowLeft,Swap} from '../icons.tsx';
import SpeciesPicker,{type SavedOption} from '../ai/SpeciesPicker.tsx';
import SetTile from '../ai/SetTile.tsx';
import {getView} from './editors.tsx';
import {MonCard,monHref} from './Hub.tsx';
import {SetWorkspace,checkSet,type Mutate} from './PokemonWorkspace.tsx';
import {setStrategyText,BENCH_LABEL,BENCH_LIMIT} from '../../shared/workbench.ts';
import type {BankEntry,BenchEntry,SetRevision,PokemonSet} from '../../shared/workbench.ts';

export const benchHref=(teamId:string,benchId?:string)=>`#team/${teamId}/bench${benchId?`/${benchId}`:''}`;
interface Item {b:BenchEntry;entry:BankEntry;revision:SetRevision;}
// The candidates with their library entries (an entry that has gone missing is skipped rather than breaking the page).
function items(team:any,data:any):Item[]{return (team.bench??[]).flatMap((b:BenchEntry)=>{const entry=data.db.bank.find((e:BankEntry)=>e.id===b.bankId);const revision=entry?.revisions.find((r:SetRevision)=>r.id===b.revisionId);return entry&&revision?[{b,entry,revision}]:[];});}
// Whether the candidate would be legal in a slot, with the same checks the Pokémon page uses before it saves.
const fitIn=(set:PokemonSet,sixSets:PokemonSet[],slot:number)=>slot<0?null:checkSet(set,sixSets.filter((_,i)=>i!==slot));
const slotFor=(sixSets:PokemonSet[],replaces?:string)=>{const i=sixSets.findIndex(s=>s.species===replaces);return i;};

// Team → Bench: the six on one side, the candidates on the other. Nothing here changes the team until one is promoted.
export default function Bench({team,data,mutate,notify}:{team:any;data:any;mutate:Mutate;notify:(s:string)=>void}){
  const view=getView(team,data.db,team.activeVersionId);const list=items(team,data);const [adding,setAdding]=useState(false),[dialog,setDialog]=useState<{item:Item;promote:boolean}|null>(null);
  const remove=async(it:Item)=>{if(!confirm(`Take ${it.revision.set.species} off the ${BENCH_LABEL}? Its set stays in your Pokémon library.`))return;await mutate({type:'bench-remove',teamId:team.id,benchId:it.b.id}).catch(()=>{});};
  return <div className="bench">
    <div className="bench-intro"><p className="muted">Pokémon you are weighing for {team.name}. Promote one to swap it in; the one it replaces moves here.</p>
      <button className="primary" onClick={()=>setAdding(true)}><Px icon={Plus}/>Add Pokémon</button></div>
    {adding&&<AddDialog team={team} data={data} mutate={mutate} count={list.length} onClose={()=>setAdding(false)}/>}
    <div className="bench-layout">
      <aside className="bench-team panel" aria-label="On the team"><span className="eyebrow">On the team</span>
        <ol>{view.sets.map((s:PokemonSet,i:number)=><li key={i}><a href={monHref(team.id,view.version.id,i)}><span className="slot-no">{String(i+1).padStart(2,'0')}</span><SetArt set={s} art={data.art} small/><span className="bench-team-name">{s.species}</span><small>{s.item||'No item'}</small></a></li>)}</ol></aside>
      <div className="bench-main">
        {list.length?<div className="six-grid bench-grid">{list.map((it,n)=>{const slot=slotFor(view.sets,it.b.replaces);const problems=fitIn(it.revision.set,view.sets,slot);
          return <div className="bench-item" key={it.b.id}>
            <MonCard i={n} numbered={false} revision={it.revision} href={benchHref(team.id,it.b.id)} active art={data.art}/>
            <div className="bench-meta">
              <label className="bench-replaces"><span>Could replace</span><select value={it.b.replaces??''} aria-label={`${it.revision.set.species}: could replace`} onChange={e=>void mutate({type:'bench-update',teamId:team.id,benchId:it.b.id,replaces:e.target.value}).catch(()=>{})}>
                <option value="">Not decided</option>{view.sets.map((s:PokemonSet,i:number)=><option key={i} value={s.species}>{s.species}</option>)}</select></label>
              {problems===null?<p className="bench-fit muted">Pick who it could replace to check it is legal.</p>:problems.length?<p className="bench-fit warn">Not legal in place of {it.b.replaces}: {problems[0]}</p>:<p className="bench-fit ok">Legal in place of {it.b.replaces}.</p>}
              {it.b.source==='assistant'&&<small className="muted">Added by your assistant</small>}
            </div>
            <div className="button-row"><button onClick={()=>setDialog({item:it,promote:false})}><Px icon={Swap}/>Compare</button><button className="primary" onClick={()=>setDialog({item:it,promote:true})}>Promote</button><button onClick={()=>void remove(it)}><Px icon={Trash}/>Remove</button></div>
          </div>;})}</div>
        :<Empty>Nothing on the {BENCH_LABEL} yet. Use <b>Add Pokémon</b> to try one in place of a Pokémon on the team, or ask Frontier Brain for ideas.</Empty>}
      </div>
    </div>
    {dialog&&<CompareDialog team={team} data={data} mutate={mutate} notify={notify} item={dialog.item} promote={dialog.promote} onClose={()=>setDialog(null)}/>}
  </div>;
}

// Add a candidate, the way a Pokémon is added to a team: choose a Pokémon (it starts from its most common set, or one of
// My sets), or paste a Showdown set. Nothing is added until the button at the bottom.
function AddDialog({team,data,mutate,count,onClose}:{team:any;data:any;mutate:Mutate;count:number;onClose:()=>void}){
  const [mode,setMode]=useState<'pokemon'|'paste'>('pokemon'),[paste,setPaste]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [choice,setChoice]=useState<{species:string;saved?:SavedOption}|null>(null);const view=getView(team,data.db,team.activeVersionId);
  const saved:SavedOption[]=data.db.bank.flatMap((b:BankEntry)=>b.revisions.filter(r=>r.starred).map(r=>({id:r.id,label:r.starred!.label,species:r.set.species,value:{bankId:b.id,revisionId:r.id}})));
  const full=count>=BENCH_LIMIT;const ready=mode==='pokemon'?!!choice:!!paste.trim();
  const add=async()=>{setBusy(true);setError('');
    try{let r:any;
      if(mode==='paste')r=await mutate({type:'bench-add',teamId:team.id,paste});
      else if(choice!.saved)r=await mutate({type:'bench-add',teamId:team.id,bankId:choice!.saved.value.bankId,revisionId:choice!.saved.value.revisionId});
      else{let t:any;
        try{t=await api(`/typical-set?species=${encodeURIComponent(choice!.species)}&avoid=${encodeURIComponent(view.sets.map((x:PokemonSet)=>x.item).filter(Boolean).join('|'))}`);}
        catch(e){throw new Error(`No usage data for ${choice!.species}, so there is no set to start from. Paste one instead. (${(e as Error).message})`);}
        r=await mutate({type:'bench-add',teamId:team.id,set:t.set});}
      onClose();location.hash=benchHref(team.id,r.result.id);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal title={`Add to the ${BENCH_LABEL}`} onClose={onClose}>
    {full?<p className="notice warn">The {BENCH_LABEL} holds up to {BENCH_LIMIT} Pokémon. Remove one to add another.</p>:<div className="bench-add-modal">
      <div className="segmented" role="group" aria-label="How to add">{([['pokemon','Pokémon'],['paste','Showdown paste']] as const).map(([v,l])=><button key={v} className={mode===v?'on':''} aria-pressed={mode===v} onClick={()=>{setMode(v);setError('');}}>{l}</button>)}</div>
      {mode==='pokemon'?<>
        <SpeciesPicker label="Pokémon" placeholder="Search Pokémon" value="" onPick={sp=>setChoice({species:sp})} onPickSaved={o=>setChoice({species:o.species,saved:o})} saved={saved} autoFocus/>
        {choice?<div className="bench-chosen"><SetArt set={{species:choice.species} as any} art={data.art} small/><div><b>{choice.species}</b><small>{choice.saved?`Your saved set: ${choice.saved.label}`:'Starts from its most common set in the data pool'}</small></div></div>
          :<p className="footnote">Starts from its most common set in the data pool. Sets you have saved are listed under their Pokémon.</p>}
      </>:<>
        <label className="sr-only" htmlFor="bench-paste">Showdown paste of one Pokémon</label>
        <textarea id="bench-paste" value={paste} placeholder={'Golisopod @ Assault Vest\nAbility: Emergency Exit\n…'} onChange={e=>setPaste(e.target.value)} autoFocus/>
      </>}
      {error&&<p className="error" role="alert">{error}</p>}
    </div>}
    <div className="modal-footer">{!full&&<button className="primary" disabled={busy||!ready} onClick={()=>void add()}><Px icon={Plus}/>{busy?'Adding…':mode==='pokemon'&&choice?`Add ${choice.species}`:`Add to the ${BENCH_LABEL}`}</button>}</div>
  </Modal>;
}

// A candidate beside the slot it would take, differences highlighted, with the checks that decide whether it can go in.
function CompareDialog({team,data,mutate,notify,item,promote,onClose}:{team:any;data:any;mutate:Mutate;notify:(s:string)=>void;item:Item;promote:boolean;onClose:()=>void}){
  const view=getView(team,data.db,team.activeVersionId);const hint=slotFor(view.sets,item.b.replaces);const [slot,setSlot]=useState(hint>=0?hint:0);const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const cand=item.revision.set,current=view.sets[slot];const problems=checkSet(cand,view.sets.filter((_:PokemonSet,i:number)=>i!==slot));const strategy=setStrategyText(item.revision.notes);
  const go=async()=>{setBusy(true);setError('');
    try{await mutate({type:'bench-promote',teamId:team.id,benchId:item.b.id,slot,baseRevisionId:view.slots[slot].revisionId});notify(`${cand.species} is in slot ${slot+1}. ${current.species} is on the ${BENCH_LABEL}.`);onClose();location.hash=benchHref(team.id);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal title={promote?`Promote ${cand.species}`:`Compare ${cand.species}`} onClose={onClose}>
    <label className="bench-slot"><span>Takes the place of</span><select value={slot} onChange={e=>setSlot(Number(e.target.value))}>{view.sets.map((s:PokemonSet,i:number)=><option key={i} value={i}>{`${String(i+1).padStart(2,'0')} · ${s.species}`}</option>)}</select></label>
    <div className="bench-compare">
      <div><span className="eyebrow">On the team</span><SetTile set={current} art={data.art}/></div>
      <div><span className="eyebrow">Candidate</span><SetTile set={cand} current={current} art={data.art}/></div>
    </div>
    {strategy.trim()&&<details className="tile-strategy"><summary>How {cand.species} would play</summary><Markdown text={strategy}/></details>}
    {problems.length?<ul className="bench-problems" role="alert">{problems.map(p=><li key={p}>{p}</li>)}</ul>:<p className="bench-fit ok">Legal in slot {slot+1}.</p>}
    <p className="footnote">Saved as a new step in History, which you can restore. {current.species} goes onto the {BENCH_LABEL}; {cand.species}’s benchmarks and strategy come with it.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="modal-footer"><button className="primary" disabled={busy||problems.length>0} onClick={()=>void go()}>{busy?'Promoting…':`Promote ${cand.species}`}</button></div>
  </Modal>;
}

// One candidate: the same set editor, strategy note, benchmarks and calcs as a team Pokémon, saved to the bench.
export function BenchWorkspace({team,data,mutate,notify,benchId}:{team:any;data:any;mutate:Mutate;notify:(s:string)=>void;benchId:string}){
  const list=items(team,data);const it=list.find(x=>x.b.id===benchId);const view=getView(team,data.db,team.activeVersionId);const [dialog,setDialog]=useState<boolean|null>(null);
  if(!it)return <Empty>That candidate is no longer on the {BENCH_LABEL}. <a href={benchHref(team.id)}>Back to the {BENCH_LABEL}.</a></Empty>;
  const slot=slotFor(view.sets,it.b.replaces);const others=slot>=0?view.sets.filter((_:PokemonSet,i:number)=>i!==slot):[];
  const remove=async()=>{if(!confirm(`Take ${it.revision.set.species} off the ${BENCH_LABEL}? Its set stays in your Pokémon library.`))return;await mutate({type:'bench-remove',teamId:team.id,benchId:it.b.id}).then(()=>{location.hash=benchHref(team.id);}).catch(()=>{});};
  return <div className="workspace bench-workspace">
    <div className="hub-head"><a href={benchHref(team.id)} className="text-button back-link"><Px icon={ArrowLeft} size={14}/>{team.name} · {BENCH_LABEL}</a></div>
    <nav className="mon-switcher" aria-label={`${BENCH_LABEL} candidates`}>{list.map(x=><a key={x.b.id} href={benchHref(team.id,x.b.id)} className={x.b.id===benchId?'selected':''} aria-current={x.b.id===benchId?'page':undefined}><SetArt set={x.revision.set} art={data.art} small/><span className="slot-name">{x.revision.set.species}</span></a>)}</nav>
    <section className="panel bench-bar"><span className="eyebrow">{BENCH_LABEL} candidate · not on the team</span>
        <label className="bench-replaces"><span>Could replace</span><select value={it.b.replaces??''} onChange={e=>void mutate({type:'bench-update',teamId:team.id,benchId:it.b.id,replaces:e.target.value}).catch(()=>{})}><option value="">Not decided</option>{view.sets.map((s:PokemonSet,i:number)=><option key={i} value={s.species}>{s.species}</option>)}</select></label>
      <div className="button-row"><button onClick={()=>setDialog(false)}><Px icon={Swap}/>Compare</button><button className="primary" onClick={()=>setDialog(true)}>Promote</button><button onClick={()=>void remove()}><Px icon={Trash}/>Remove</button></div></section>
    <SetWorkspace key={benchId} team={team} data={data} mutate={mutate} view={view} slot={-1} candidate={{id:benchId,entry:it.entry,revision:it.revision,others}}/>
    {dialog!==null&&<CompareDialog team={team} data={data} mutate={mutate} notify={notify} item={it} promote={dialog} onClose={()=>setDialog(null)}/>}
  </div>;
}
