import {useEffect,useRef} from 'react';
import type {WireBrain} from './wire-brain.js';

// The giant wireframe brain behind every page, in its calm Constellation form (airy, so text stays readable), a little
// brighter on the welcome page. It tilts toward the pointer and fires from wherever you click.
// three.js loads after the page is up, so it never delays the app; still frame for reduced motion; pauses when hidden.
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;};
// While the boot screen runs it starts dark and powers up behind it, then settles at its usual calm level.
export default function BrainBackdrop({route,booting=false}:{route:string;booting?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),brain=useRef<WireBrain|null>(null),rafId=useRef(0);
  const hero=route==='welcome';const target=hero?0.7:0.45;const bootRef=useRef(booting);bootRef.current=booting;const heroRef=useRef(hero);heroRef.current=hero;
  useEffect(()=>{let alive=true,b:WireBrain|null=null;
    void import('./wire-brain.js').then(({createWireBrain})=>{if(!alive||!canvas.current)return;
      try{b=createWireBrain(canvas.current,{mode:'constellation',dark:isDark(),intensity:bootRef.current?0.6:target,spin:0.35,density:hero?0.5:0.4,offsetX:hero?0.18:0.24,maxPixelRatio:1.5});brain.current=b;}catch{canvas.current.style.display='none';}});
    const mo=new MutationObserver(()=>brain.current?.setTheme(isDark()));mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const mq=matchMedia('(prefers-color-scheme: dark)');const sys=()=>brain.current?.setTheme(isDark());mq.addEventListener('change',sys);
    const move=(e:PointerEvent)=>brain.current?.pointer(e.clientX,e.clientY);
    const down=(e:PointerEvent)=>{if(e.button===0)brain.current?.click(e.clientX,e.clientY);};
    addEventListener('pointermove',move,{passive:true});addEventListener('pointerdown',down,{passive:true});
    return()=>{alive=false;mo.disconnect();mq.removeEventListener('change',sys);removeEventListener('pointermove',move);removeEventListener('pointerdown',down);b?.dispose();brain.current=null;};},[]);
  useEffect(()=>{if(bootRef.current)return;brain.current?.setOptions(hero?{intensity:0.7,density:0.5,offsetX:0.18}:{intensity:0.45,density:0.4,offsetX:0.24});},[hero]);
  // Boot: the brain starts dark and big, the loading sequence sweeps light down through it (Boot sends its progress),
  // then at the end it detonates in green electricity and settles back to the calm backdrop.
  useEffect(()=>{if(!booting)return;let cur=0,goal=0,exploded=0,ready=false;
    const prog=(e:Event)=>{goal=Math.max(goal,(e as CustomEvent<number>).detail);};
    const boom=()=>{goal=1;exploded=performance.now();};
    addEventListener('fb-boot-progress',prog);addEventListener('fb-boot-explode',boom);
    const tick:any=(t:number)=>{const b=brain.current;
      if(b&&!ready){ready=true;b.setOptions({intensity:0.6,spin:0.5,offsetX:0.05,density:0.5,scale:1.45,ambient:0.08});}
      if(b){cur+=(goal-cur)*(exploded?0.2:0.045);const fade=exploded?Math.max(0,1-((t-exploded)/1000-0.3)/1.1):1;b.sweep(cur>0.002&&fade>0?Math.min(cur,1):-1,fade);
        if(exploded){const s=(t-exploded)/1000;
          if(s>0.05&&!tick.fired){tick.fired=true;b.setOptions({ambient:1});b.explode();}
          const tg=heroRef.current?0.7:0.45;b.setOptions({intensity:Math.max(tg,1.35-s*0.55),spin:Math.max(0.35,1.4-s*0.5),scale:1+0.45*Math.max(0,1-s/2.4)+0.12*Math.exp(-s*3)});
          if(s>2.6){const h=heroRef.current;b.setOptions({intensity:tg,spin:0.35,offsetX:h?0.18:0.24,density:h?0.5:0.4,scale:1});return;}}}
      rafId.current=requestAnimationFrame(tick);};
    tick.fired=false;rafId.current=requestAnimationFrame(tick);
    return()=>{removeEventListener('fb-boot-progress',prog);removeEventListener('fb-boot-explode',boom);};},[booting]);
  useEffect(()=>()=>cancelAnimationFrame(rafId.current),[]);
  return <canvas ref={canvas} className={'brain-backdrop'+(hero?' hero':'')+(booting?' booting':'')} aria-hidden="true"/>;
}
