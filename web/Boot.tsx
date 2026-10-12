import {useEffect,useRef,useState} from 'react';
import {reduced} from './fx.ts';
import {aiKey} from './ai/keys.tsx';
import {hostedSite} from './auth.tsx';

// Once per browser session: "loading frontier-brain.exe" types out in the display face while the wireframe brain
// behind it powers up, a few real status lines check in, then the app switches on like a screen. Any key or click skips.
const KEY='frontierbrain.booted';
export const shouldBoot=()=>{if(reduced())return false;try{return !sessionStorage.getItem(KEY);}catch{return false;}};
const TITLE='loading frontier-brain.exe';
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

export default function Boot({data,error,onDone}:{data:any;error:string;onDone:()=>void}){
  const [typed,setTyped]=useState(0),[lines,setLines]=useState<[string,string][]>([]),[pct,setPct]=useState(0),[leaving,setLeaving]=useState(false);
  const dataRef=useRef(data);dataRef.current=data;const errRef=useRef(error);errRef.current=error;const done=useRef(false);
  const finish=()=>{if(done.current)return;done.current=true;try{sessionStorage.setItem(KEY,'1');}catch{}setLeaving(true);setTimeout(onDone,520);};
  useEffect(()=>{const skip=()=>finish();addEventListener('keydown',skip);addEventListener('pointerdown',skip);return()=>{removeEventListener('keydown',skip);removeEventListener('pointerdown',skip);};},[]);
  useEffect(()=>{let alive=true;
    (async()=>{for(let i=1;i<=TITLE.length;i++){if(!alive)return;setTyped(i);await sleep(42);}
      await sleep(180);
      const steps:[string,()=>Promise<string>][]=[
        ['ENGINE   Champions mechanics, pinned',async()=>'OK'],
        ['LINK     '+(hostedSite?'your account':'local workspace'),async()=>{for(let i=0;i<60&&!dataRef.current&&!errRef.current;i++)await sleep(100);return dataRef.current?'LINKED':errRef.current?'LOST':'WAIT';}],
        ['TEAMS',async()=>dataRef.current?`${dataRef.current.teams.length} LOADED`:'--'],
        ['REPLAYS',async()=>dataRef.current?`${dataRef.current.games.length} INDEXED`:'--'],
        ['AI',async()=>{const k=aiKey();return k?`${k.provider.toUpperCase()} KEY`:hostedSite?'NO KEY':'LOCAL SERVER';}],
      ];
      for(let i=0;i<steps.length;i++){if(!alive)return;const [label,check]=steps[i];setLines(l=>[...l,[label,'']]);const res=await check();if(!alive)return;
        setLines(l=>{const n=[...l];n[n.length-1]=[label,res];return n;});setPct(Math.round((i+1)/steps.length*100));await sleep(170);}
      setLines(l=>[...l,['READY','']]);await sleep(450);finish();})();
    return()=>{alive=false;};},[]);
  const text=TITLE.slice(0,typed);const dot=text.lastIndexOf('.');const ext=dot>15?text.slice(dot):'';
  return <div className={'boot'+(leaving?' leaving':'')} role="status" aria-label="Starting Frontier Brain">
    <div className="boot-inner">
      <p className="boot-exe">{ext?text.slice(0,dot):text}<span className="ext">{ext}</span><span className="caret" aria-hidden="true"/></p>
      <div className="boot-lines">{lines.map(([a,b],i)=><div key={i} className={a==='READY'?'ready':''}><span>{a}</span>{b&&<b className={b==='LOST'||b==='NO KEY'?'warn':''}>{b}</b>}</div>)}</div>
      <div className="boot-bar"><div className="boot-track"><i style={{width:pct+'%'}}/></div><b>{pct}%</b></div>
      <p className="boot-skip">Press any key</p>
    </div>
  </div>;
}
