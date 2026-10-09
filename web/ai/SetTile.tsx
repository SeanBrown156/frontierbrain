import {useState,useEffect} from 'react';
import type {PokemonSet} from '../../shared/workbench.ts';
import {api,Art} from '../ui.tsx';
const stats=['hp','atk','def','spa','spd','spe'] as const;
const label:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
// A set shown the way the team page shows Pokémon: art, item/ability/nature, moves, stat points and final stats.
// When `current` is given, anything that differs from it is highlighted.
export default function SetTile({set,current,art,note,actions}:{set:PokemonSet;current?:PokemonSet;art:any;note?:string;actions?:React.ReactNode}){
  const [final,setFinal]=useState<any>(null);const key=JSON.stringify(set);
  useEffect(()=>{let alive=true;api('/calculate',{kind:'stats',input:set}).then(r=>{if(alive)setFinal(r);}).catch(()=>{});return()=>{alive=false;};},[key]);
  const diff=(k:keyof PokemonSet)=>!!current&&JSON.stringify(current[k])!==JSON.stringify(set[k]);
  const swapped=!!current&&current.species!==set.species;
  return <article className={'set-tile'+(swapped?' swapped':'')}><div className="set-tile-head"><Art name={set.species} art={art}/><div><h3>{set.species}{swapped&&<small className="was"> replaces {current!.species}</small>}</h3>
      <p className={diff('item')?'changed':''}>@ {set.item||'no item'}</p><p><span className={diff('ability')?'changed':''}>{set.ability}</span> · <span className={diff('nature')?'changed':''}>{set.nature}</span></p></div></div>
    <ul className="move-list">{set.moves?.map(m=><li key={m} className={current&&!current.moves?.includes(m)?'changed':''}><span>▸</span>{m}</li>)}</ul>
    <div className="tile-stats">{stats.map(k=><div key={k} className={current&&(current.statPoints?.[k]??0)!==(set.statPoints?.[k]??0)?'changed':''}><span>{label[k]}</span><b>{set.statPoints?.[k]??0}</b><small>{final?.[k]??'—'}</small></div>)}</div>
    {note&&<p className="tile-note">{note}</p>}{actions&&<div className="button-row">{actions}</div>}</article>;
}
