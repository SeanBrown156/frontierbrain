import {useEffect,useState} from 'react';
import {api} from './ui.tsx';

// Says so when the regulation the app is built around is about to end, or already has. Quiet otherwise.
const KEY='frontierbrain.regulation-banner';
const day=(iso:string)=>new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export default function RegulationBanner(){
  const [r,setR]=useState<any>(null),[hidden,setHidden]=useState(false);
  useEffect(()=>{let alive=true;void api('/regulation').then(x=>{if(alive)setR(x);}).catch(()=>{});return()=>{alive=false;};},[]);
  useEffect(()=>{try{if(r&&sessionStorage.getItem(KEY)===`${r.id}:${r.status}`)setHidden(true);}catch{}},[r]);
  if(!r||hidden||(r.status!=='ending'&&r.status!=='ended'))return null;
  const ended=r.status==='ended';
  const dismiss=()=>{try{sessionStorage.setItem(KEY,`${r.id}:${r.status}`);}catch{}setHidden(true);};
  return <aside className={'reg-banner '+(ended?'ended':'ending')} role="status">
    <p>{ended
      ?<><b>Regulation {r.id} ended on {day(r.endsAt)}.</b> Legality, usage and sets here are still {r.id} data. Check the official rules before building for what comes next.</>
      :<><b>Regulation {r.id} ends on {day(r.endsAt)}</b> ({r.daysLeft} day{r.daysLeft===1?'':'s'} left). What you build now may change with the next regulation.</>}
      {r.source&&<> <a href={r.source} target="_blank" rel="noreferrer">Official announcement ↗</a></>}</p>
    <button className="text-button" onClick={dismiss}>Dismiss</button>
  </aside>;
}
