import {useEffect,useRef} from 'react';

// The neural network behind every page: faint emerald nodes drifting slowly, wired to their neighbours, with the odd
// pulse of light along a wire. Plain 2D canvas, about 60 nodes, capped at 30 fps; still for reduced motion and
// paused while the tab is hidden. It sits under the glass, so panels frost it.
export default function NetworkBackdrop(){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const c=ref.current!;const g=c.getContext('2d');if(!g)return;const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w=0,h=0,dpr=1;const nodes=Array.from({length:64},(_,i)=>({x:Math.random(),y:Math.random(),vx:(Math.random()-.5)*.00012,vy:(Math.random()-.5)*.00012,r:1+Math.random()*1.6,p:i*0.7}));
    const pulses=Array.from({length:7},()=>({a:0,b:0,t:Math.random()}));
    const size=()=>{dpr=Math.min(2,devicePixelRatio||1);w=innerWidth;h=innerHeight;c.width=w*dpr;c.height=h*dpr;g.setTransform(dpr,0,0,dpr,0,0);};size();addEventListener('resize',size);
    const accent=()=>getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()||'#1FD08A';
    let raf=0,last=0,col=accent();const mo=new MutationObserver(()=>{col=accent();});mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    const link=Math.min(220,Math.max(140,Math.hypot(innerWidth,innerHeight)/9));
    const draw=(t:number)=>{g.clearRect(0,0,w,h);const pts=nodes.map(n=>[n.x*w,n.y*h]);
      g.lineWidth=1;g.strokeStyle=col;
      const pairs:[number,number][]=[];
      for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){const d=Math.hypot(pts[i][0]-pts[j][0],pts[i][1]-pts[j][1]);if(d<link){pairs.push([i,j]);g.globalAlpha=0.2*(1-d/link);g.beginPath();g.moveTo(pts[i][0],pts[i][1]);g.lineTo(pts[j][0],pts[j][1]);g.stroke();}}
      g.fillStyle=col;for(const [k,n] of nodes.entries()){g.globalAlpha=0.35+0.2*Math.sin(t/900+n.p);g.beginPath();g.arc(pts[k][0],pts[k][1],n.r,0,7);g.fill();}
      if(pairs.length)for(const p of pulses){if(p.t>=1||!pairs[p.a]){const q=pairs[Math.floor(Math.random()*pairs.length)];p.a=pairs.indexOf(q);p.t=0;}
        const [i,j]=pairs[p.a]??pairs[0];const x=pts[i][0]+(pts[j][0]-pts[i][0])*p.t,y=pts[i][1]+(pts[j][1]-pts[i][1])*p.t;
        g.globalAlpha=0.85*Math.sin(p.t*Math.PI);const grd=g.createRadialGradient(x,y,0,x,y,7);grd.addColorStop(0,col);grd.addColorStop(1,'transparent');g.fillStyle=grd;g.beginPath();g.arc(x,y,7,0,7);g.fill();p.t+=0.006;}
      g.globalAlpha=1;};
    const loop=(t:number)=>{raf=requestAnimationFrame(loop);if(document.hidden||t-last<33)return;last=t;
      for(const n of nodes){n.x+=n.vx;n.y+=n.vy;if(n.x<-.05||n.x>1.05)n.vx*=-1;if(n.y<-.05||n.y>1.05)n.vy*=-1;}draw(t);};
    if(still)draw(0);else raf=requestAnimationFrame(loop);
    return()=>{cancelAnimationFrame(raf);removeEventListener('resize',size);mo.disconnect();};},[]);
  return <canvas ref={ref} className="network-backdrop" aria-hidden="true"/>;
}
