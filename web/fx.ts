import {useEffect,useState,useSyncExternalStore} from 'react';

// Jade × Phosphor effects. Motion only marks real moments (a page opening, a name you point at, a calc landing) and
// every effect is skipped for prefers-reduced-motion.
export const reduced=()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const NOISE='ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/\\';
const DIGITS='0123456789';
const noise=(c:string,pool:string)=>c===' '||/[^\p{L}\p{N}]/u.test(c)?c:pool[(Math.random()*pool.length)|0];

// Resolve an element's text from noise, left to right. Works on its own text nodes and stops if React changes them meanwhile.
// `lock` holds the element's box while it runs, so wider noise glyphs never nudge the layout around it.
const running=new WeakMap<Element,number>();
// Every scrambled string written to a text node, with its real text, so noise can always be put back: by the effect
// itself, by a fallback timer if animation frames stall (a background tab, a slow first render), or by a later effect.
const scrambled=new WeakMap<Text,{final:string;noise:Set<string>}>();
const restore=(n:Text)=>{const s=scrambled.get(n);if(s&&s.noise.has(n.data))n.data=s.final;scrambled.delete(n);};
export function decode(el:Element,{duration=480,lock=false}:{duration?:number;lock?:boolean}={}){
  if(reduced()||running.has(el))return;const nodes:Text[]=[];const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  for(let n=walk.nextNode();n;n=walk.nextNode())if((n as Text).data.trim())nodes.push(n as Text);
  if(!nodes.length)return;nodes.forEach(restore);
  const token=Date.now()+Math.random();running.set(el,token);const finals=nodes.map(n=>n.data);const written=[...finals];let start=0;
  nodes.forEach((n,i)=>scrambled.set(n,{final:finals[i],noise:new Set()}));
  const box=el as HTMLElement;const {width,height,boxSizing,whiteSpace,overflow}=box.style;
  // Noise glyphs run wider than the real text: hold the box's size, and keep one-line text on one line while it resolves.
  if(lock){const r=box.getBoundingClientRect();const lh=parseFloat(getComputedStyle(box).lineHeight)||parseFloat(getComputedStyle(box).fontSize)*1.2;
    Object.assign(box.style,{width:r.width+'px',height:r.height+'px',boxSizing:'border-box'});if(r.height<lh*1.6)Object.assign(box.style,{whiteSpace:'nowrap',overflow:'hidden'});}
  // Any node still showing noise gets its real text back (a node React rewrote keeps React's text), and the box is released.
  let settled=false;
  const settle=()=>{if(settled)return;settled=true;clearTimeout(fallback);nodes.forEach(restore);if(lock)Object.assign(box.style,{width,height,boxSizing,whiteSpace,overflow});if(running.get(el)===token)running.delete(el);};
  const fallback=setTimeout(settle,duration+600);
  const step=(p:number)=>{for(let i=0;i<nodes.length;i++){const f=finals[i];const keep=Math.floor(f.length*p);
    const next=f.slice(0,keep)+[...f.slice(keep)].map(c=>noise(c,NOISE)).join('');scrambled.get(nodes[i])?.noise.add(next);nodes[i].data=next;written[i]=next;}};
  // The clock starts on the first painted frame, so a page that takes a moment to render still shows the whole resolve.
  const frame=()=>{if(settled||running.get(el)!==token){settle();return;}if(nodes.some((n,i)=>n.data!==written[i])){settle();return;}
    const now=performance.now();if(!start)start=now;const p=Math.min(1,(now-start)/duration);step(p);
    if(p<1)requestAnimationFrame(frame);else settle();};
  step(0);requestAnimationFrame(frame);
}

// Pointing at a name decodes it once; the same name then rests for a moment, so sweeping back and forth never strobes.
const lastHover=new WeakMap<Element,number>();
export function hoverDecode(el:Element,duration=340){const now=Date.now();if(now-(lastHover.get(el)??0)<1500)return;lastHover.set(el,now);decode(el,{duration,lock:true});}

// A brief phosphor flicker: the element jitters and its glow splits for a moment (keyframes in jade.css).
export function glitch(el:Element){if(reduced()||el.classList.contains('fx-glitch'))return;el.classList.add('fx-glitch');
  const done=()=>el.classList.remove('fx-glitch');el.addEventListener('animationend',done,{once:true});setTimeout(done,800);}

// A number (or any text) that rolls its digits for a moment whenever `key` changes, then settles on the real value.
export function useRolling(text:string,key:string,duration=520){
  const [shown,setShown]=useState(text);
  useEffect(()=>{if(reduced()){setShown(text);return;}let raf=0;const start=performance.now();
    const frame=(t:number)=>{const p=Math.min(1,(t-start)/duration);const keep=Math.floor(text.length*p);
      setShown(text.slice(0,keep)+[...text.slice(keep)].map(c=>/\d/.test(c)?noise(c,DIGITS):c).join(''));if(p<1)raf=requestAnimationFrame(frame);};
    raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);},[key]);
  useEffect(()=>{setShown(text);},[text]);
  return shown;
}

// Pokémon art style: HOME 3D models (default), the official illustrations, or Showdown's animated Black & White or X & Y sprites. Kept per browser.
export type SpriteStyle='home'|'art'|'gen5'|'xy';
const KEY='frontierbrain.sprites';const listeners=new Set<()=>void>();
let style:SpriteStyle=(()=>{try{const v=localStorage.getItem(KEY);return v==='gen5'||v==='xy'||v==='art'?v:'home';}catch{return 'home';}})();
export function setSpriteStyle(next:SpriteStyle){style=next;try{localStorage.setItem(KEY,next);}catch{}listeners.forEach(f=>f());}
export const useSpriteStyle=()=>useSyncExternalStore(f=>{listeners.add(f);return()=>{listeners.delete(f);};},()=>style);

// Showdown sprite ids keep hyphens only between a species and its form ("ogerpon-wellspring"), except species whose
// own name has one.
const HYPHENATED=['ho-oh','porygon-z','jangmo-o','hakamo-o','kommo-o','chi-yu','ting-lu','wo-chien','chien-pao','type: null','mr. mime','mime jr.','mr. rime'];
const toID=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export function spriteId(species:string){const s=species.toLowerCase();const base=HYPHENATED.find(h=>s===h||s.startsWith(h+'-'));
  if(base){const rest=s.slice(base.length+1);return toID(base)+(rest?'-'+toID(rest):'');}
  const i=s.indexOf('-');return i<0?toID(s):toID(s.slice(0,i))+'-'+toID(s.slice(i+1));}
// Animated first, then the static sprite of the same set, so a species without an animation still matches the style.
export function spriteUrls(species:string,kind:SpriteStyle):string[]{const id=spriteId(species);const base='https://play.pokemonshowdown.com/sprites/';
  return kind==='gen5'?[`${base}gen5ani/${id}.gif`,`${base}gen5/${id}.png`]:kind==='xy'?[`${base}ani/${id}.gif`,`${base}dex/${id}.png`]:[];}
