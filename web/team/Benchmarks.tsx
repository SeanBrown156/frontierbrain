import {useEffect,useState} from 'react';
import type {BankEntry,Benchmark,PokemonSet} from '../../shared/workbench.ts';
import {ownSide,withSet,outcome,holds} from '../../shared/benchmarks.ts';
import {api} from '../ui.tsx';
import {Px,Trash} from '../icons.tsx';

// The Pokémon's benchmarks, re-checked live against the set as it is now (including unsaved edits).
// Saved from the calc ("Save as benchmark"); each one says whether it still holds and what it was when saved.
export default function Benchmarks({entry,set,data,mutate}:{entry:BankEntry;set:PokemonSet;data:any;mutate:(a:any)=>Promise<any>}){
  const list:Benchmark[]=(data.db.benchmarks??[]).filter((b:Benchmark)=>b.bankId===entry.id&&b.kind!=='spread');
  const [now,setNow]=useState<Record<string,any>>({});
  const key=JSON.stringify([list.map(b=>b.id),set]);
  useEffect(()=>{if(!list.length)return;let alive=true;const t=setTimeout(()=>{void Promise.all(list.map(b=>api('/calculate',{kind:b.kind,input:withSet(b,set)}).then(r=>[b.id,r],()=>[b.id,null]))).then(rows=>{if(alive)setNow(Object.fromEntries(rows));});},300);return()=>{alive=false;clearTimeout(t);};},[key]);
  if(!list.length)return <section className="benchmarks"><h3>Benchmarks</h3><p className="muted">No benchmarks saved yet.</p></section>;
  return <section className="benchmarks"><h3>Benchmarks</h3><ul>{list.map(b=>{const side=ownSide(b,set.species);const saved=outcome(b.kind,b.result);const r=now[b.id];const current=r?outcome(b.kind,r):null;const ok=current?holds(b.kind,side,saved,current):null;
    return <li key={b.id} className={ok===false?'broken':ok?'ok':''}><span className="mark" aria-label={ok===null?'checking':ok?'holds':'no longer holds'}>{ok===null?'…':ok?'✓':'✗'}</span>
      <span className="what"><b>{b.title}</b><small>{current?current.text:saved.text}{current&&current.text!==saved.text?` · was ${saved.text}`:''}</small></span>
      <button className="icon" aria-label={`Delete benchmark ${b.title}`} title="Delete" onClick={()=>{if(confirm(`Delete “${b.title}”?`))void mutate({type:'benchmark-delete',benchmarkId:b.id}).catch(()=>{});}}><Px icon={Trash} size={14}/></button></li>;})}</ul></section>;
}
