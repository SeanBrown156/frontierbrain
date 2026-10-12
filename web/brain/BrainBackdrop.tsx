import {useEffect,useRef} from 'react';
import type {WireBrain} from './wire-brain.js';

// The giant wireframe brain behind every page, in its calm Constellation form (airy, so text stays readable), a little
// brighter on the welcome page. It tilts toward the pointer and fires from wherever you click.
// three.js loads after the page is up, so it never delays the app; still frame for reduced motion; pauses when hidden.
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;};
// While the boot screen runs it starts dark and powers up behind it, then settles at its usual calm level.
export default function BrainBackdrop({route,booting=false}:{route:string;booting?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),brain=useRef<WireBrain|null>(null);
  const hero=route==='welcome';const target=hero?0.7:0.45;const bootRef=useRef(booting);bootRef.current=booting;
  useEffect(()=>{let alive=true,b:WireBrain|null=null;
    void import('./wire-brain.js').then(({createWireBrain})=>{if(!alive||!canvas.current)return;
      try{b=createWireBrain(canvas.current,{mode:'constellation',dark:isDark(),intensity:bootRef.current?0.02:target,spin:0.35,density:hero?0.5:0.4,offsetX:hero?0.18:0.24,maxPixelRatio:1.5});brain.current=b;}catch{canvas.current.style.display='none';}});
    const mo=new MutationObserver(()=>brain.current?.setTheme(isDark()));mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const mq=matchMedia('(prefers-color-scheme: dark)');const sys=()=>brain.current?.setTheme(isDark());mq.addEventListener('change',sys);
    const move=(e:PointerEvent)=>brain.current?.pointer(e.clientX,e.clientY);
    const down=(e:PointerEvent)=>{if(e.button===0)brain.current?.click(e.clientX,e.clientY);};
    addEventListener('pointermove',move,{passive:true});addEventListener('pointerdown',down,{passive:true});
    return()=>{alive=false;mo.disconnect();mq.removeEventListener('change',sys);removeEventListener('pointermove',move);removeEventListener('pointerdown',down);b?.dispose();brain.current=null;};},[]);
  useEffect(()=>{brain.current?.setOptions(hero?{intensity:0.7,density:0.5,offsetX:0.18}:{intensity:0.45,density:0.4,offsetX:0.24});},[hero]);
  // Boot: overshoot to a bright flash of activity (the "power on"), then ease down to the calm backdrop.
  useEffect(()=>{if(!bootRef.current)return;let raf=0;const start=performance.now();const ramp=(t:number)=>{const b=brain.current;const s=(t-start)/1000;
      if(b){const v=s<2.2?0.02+(1.1-0.02)*Math.pow(Math.min(1,s/2.2),2):Math.max(target,1.1-(s-2.2)*0.5);b.setOptions({intensity:v,spin:s<2.2?0.35+s*0.5:0.35});if(s>2.2&&v<=target)return;}
      raf=requestAnimationFrame(ramp);};raf=requestAnimationFrame(ramp);return()=>cancelAnimationFrame(raf);},[]);
  return <canvas ref={canvas} className={'brain-backdrop'+(hero?' hero':'')+(booting?' booting':'')} aria-hidden="true"/>;
}
