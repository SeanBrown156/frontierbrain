import {useEffect,useState} from 'react';
import {api} from './ui.tsx';

// Says so when the regulation the app is built around is about to end, has ended, was just switched (14 days), or its
// legality data is not verified yet. Quiet otherwise.
const KEY='frontierbrain.regulation-banner';
const day=(iso:string)=>new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export default function RegulationBanner(){
  const [r,setR]=useState<any>(null),[hidden,setHidden]=useState(false);
  useEffect(()=>{let alive=true;void api('/regulation').then(x=>{if(alive)setR(x);}).catch(()=>{});return()=>{alive=false;};},[]);
  // What the banner has to say: the regulation ending or ended, a switch in the last 14 days, or unverified legality data.
  const kind=!r?null:r.status==='ended'?'ended':r.status==='ending'?'ending':r.switched?'switched':r.engineVerified===false?'unverified':null;
  const stamp=r?`${r.id}:${kind}:${r.engineVerified===false?'u':''}`:'';
  useEffect(()=>{try{if(r&&sessionStorage.getItem(KEY)===stamp)setHidden(true);}catch{}},[r,stamp]);
  if(!r||hidden||!kind)return null;
  const ended=kind==='ended';
  const dismiss=()=>{try{sessionStorage.setItem(KEY,stamp);}catch{}setHidden(true);};
  const unverified=r.engineVerified===false&&kind!=='unverified'?<> Legality data for {r.id} is not verified yet.</>:null;
  return <aside className={'reg-banner '+(ended?'ended':'ending')} role="status">
    <p>{kind==='ended'
      ?<><b>Regulation {r.id} ended on {day(r.endsAt)}.</b> Legality, usage and sets here are still {r.id} data.{r.next?<> Next: {r.next.id}{r.next.startsAt?` from ${day(r.next.startsAt)}`:''}{r.next.confidence==='official'?'':' (not confirmed by an official source yet)'}.</>:<> Check the official rules before building for what comes next.</>}{unverified}</>
      :kind==='ending'
      ?<><b>Regulation {r.id} ends on {day(r.endsAt)}</b> ({r.daysLeft} day{r.daysLeft===1?'':'s'} left). What you build now may change with the next regulation.{r.next&&<> Next: {r.next.id}{r.next.startsAt?` from ${day(r.next.startsAt)}`:''}{r.next.confidence==='official'?'':' (not confirmed yet)'}.</>}</>
      :kind==='switched'
      ?<><b>Now on Regulation {r.id}.</b> It started on {day(r.startsAt)}; your teams, replays and saved data are unchanged.{unverified}</>
      :<><b>Legality data for {r.id} is not verified yet.</b> Legality checks and calcs here still come from the previous regulation's engine; check the official eligible list.</>}
      {r.source&&<> <a href={r.source} target="_blank" rel="noreferrer">Official announcement ↗</a></>}</p>
    <button className="text-button" onClick={dismiss}>Dismiss</button>
  </aside>;
}
