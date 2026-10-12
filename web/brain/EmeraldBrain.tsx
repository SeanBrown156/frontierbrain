import {useEffect,useRef} from 'react';
import {createBrain,type Brain} from './brain.ts';

// The live 3D mark. It breathes, leans toward the pointer, wrings into a twist while hovered and can be dragged to
// spin. Loaded lazily (three.js stays out of the main bundle); still for reduced motion; pauses when off screen.
export default function EmeraldBrain({className='',label='Frontier Brain',network=false}:{className?:string;label?:string;network?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const el=canvas.current!;let brain:Brain;try{brain=createBrain(el,{detail:3,network});}catch{el.classList.add('no-webgl');return;}
    const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fit=()=>{const r=el.getBoundingClientRect();brain.resize(Math.max(1,r.width),Math.max(1,r.height));};fit();const ro=new ResizeObserver(fit);ro.observe(el);
    let raf=0,visible=true,start=performance.now(),drag:{x:number;spin:number}|null=null,spin=0;
    const loop=()=>{raf=requestAnimationFrame(loop);if(visible)brain.frame(still?0:(performance.now()-start)/1000);};
    if(still)brain.frame(0);else loop();
    const io=new IntersectionObserver(([e])=>{visible=e.isIntersecting;});io.observe(el);
    const move=(e:PointerEvent)=>{const r=el.getBoundingClientRect();const x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
      if(drag){spin=drag.spin+(e.clientX-drag.x)/r.width*Math.PI*2;brain.set({spin});}brain.set({yaw:Math.max(-.6,Math.min(.6,x*1.1)),pitch:Math.max(-.3,Math.min(.3,y*.6))});};
    const enter=()=>brain.set({twist:0.55,breathe:1.6}),leave=()=>{brain.set({twist:0,breathe:1,yaw:0,pitch:0});drag=null;};
    const down=(e:PointerEvent)=>{drag={x:e.clientX,spin};el.setPointerCapture(e.pointerId);brain.set({twist:-0.8});},up=()=>{drag=null;brain.set({twist:0.55});};
    addEventListener('pointermove',move);el.addEventListener('pointerenter',enter);el.addEventListener('pointerleave',leave);el.addEventListener('pointerdown',down);el.addEventListener('pointerup',up);
    return()=>{cancelAnimationFrame(raf);ro.disconnect();io.disconnect();removeEventListener('pointermove',move);el.removeEventListener('pointerenter',enter);el.removeEventListener('pointerleave',leave);el.removeEventListener('pointerdown',down);el.removeEventListener('pointerup',up);brain.dispose();};},[]);
  return <canvas ref={canvas} className={'emerald-brain '+className} role="img" aria-label={label}/>;
}
