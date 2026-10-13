import {useEffect,useState} from 'react';
import type {BankEntry,Benchmark,PokemonSet} from '../../shared/workbench.ts';
import {ownSide,withSet,outcome,holds,benchmarkLabel,labelText,autoTitle} from '../../shared/benchmarks.ts';
import {api,Art} from '../ui.tsx';
import '../calc-lab.css';
import {Px,Trash} from '../icons.tsx';

// The Pokémon's benchmarks, re-checked live against the set as it is now (including unsaved edits).
// Saved from the calc ("Save as benchmark"); each one says whether it still holds and what it was when saved.
export default function Benchmarks({entry,set,data,mutate}:{entry:BankEntry;set:PokemonSet;data:any;mutate:(a:any)=>Promise<any>}){
  const list:Benchmark[]=(data.db.benchmarks??[]).filter((b:Benchmark)=>b.bankId===entry.id&&b.kind!=='spread');
  const [now,setNow]=useState<Record<string,any>>({});
  const key=JSON.stringify([list.map(b=>b.id),set]);
  useEffect(()=>{if(!list.length)return;let alive=true;const t=setTimeout(()=>{void Promise.all(list.map(b=>api('/calculate',{kind:b.kind,input:withSet(b,set)}).then(r=>[b.id,r],()=>[b.id,null]))).then(rows=>{if(alive)setNow(Object.fromEntries(rows));});},300);return()=>{alive=false;clearTimeout(t);};},[key]);
  if(!list.length)return <section className="benchmarks"><h3>Benchmarks</h3><p className="muted">No benchmarks saved yet.</p></section>;
  return <section className="benchmarks"><h3>Benchmarks</h3><ul>{list.map(b=>{const side=ownSide(b,set.species);const saved=outcome(b.kind,b.result);const r=now[b.id];const current=r?outcome(b.kind,r):null;const ok=current?holds(b.kind,side,saved,current):null;const label=benchmarkLabel(b,set.species);const auto=labelText(label);const note=b.title&&b.title!==auto&&b.title!==autoTitle(b.kind,side,b.input,b.result)?b.title:'';
    return <li key={b.id} className={ok===false?'broken':ok?'ok':''}><span className="mark" aria-label={ok===null?'checking':ok?'holds':'no longer holds'}>{ok===null?'…':ok?'✓':'✗'}</span>
      <span className="what"><span className="bm-head"><span className={'bm-role '+label.role.toLowerCase().replace(/\s+/g,'-')}>{label.role}</span><span className="bm-opp">{label.opponentSpecies&&<Art name={label.opponentSpecies} fallback={label.opponentSpecies.replace(/-Mega(-[A-Z])?$/,'')} art={data.art} small/>}<b>{label.opponent}</b></span></span>
        {label.detail.length>0&&<small className="bm-detail">{label.detail.join(' · ')}</small>}
        <small>{current?current.text:saved.text}{current&&current.text!==saved.text?` · was ${saved.text}`:''}</small>
        {note&&<small className="bm-note">{note}</small>}</span>
      <button className="icon" aria-label={`Delete benchmark ${auto}`} title="Delete" onClick={()=>{if(confirm(`Delete “${auto}”?`))void mutate({type:'benchmark-delete',benchmarkId:b.id}).catch(()=>{});}}><Px icon={Trash} size={14}/></button></li>;})}</ul></section>;
}
