import {useEffect,useState,useSyncExternalStore} from 'react';

// Jade × Phosphor effects. Motion only marks real moments (a page opening, a name you point at, a calc landing) and
// every effect is skipped for prefers-reduced-motion.
export const reduced=()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const NOISE='ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/\\';
const DIGITS='0123456789';
const noise=(c:string,pool:string)=>c===' '||/[^\p{L}\p{N}]/u.test(c)?c:pool[(Math.random()*pool.length)|0];

// Resolve an element's text from noise, left to right. Works on its own text nodes and stops if React changes them meanwhile.
const running=new WeakMap<Element,number>();
export function decode(el:Element,{duration=480}:{duration?:number}={}){
  if(reduced()||running.has(el))return;const nodes:Text[]=[];const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  for(let n=walk.nextNode();n;n=walk.nextNode())if((n as Text).data.trim())nodes.push(n as Text);
  if(!nodes.length)return;const token=Date.now();running.set(el,token);const finals=nodes.map(n=>n.data);const written=[...finals];const start=performance.now();
  const frame=(t:number)=>{if(running.get(el)!==token)return;const p=Math.min(1,(t-start)/duration);
    for(let i=0;i<nodes.length;i++){if(nodes[i].data!==written[i]){running.delete(el);return;}const f=finals[i];const keep=Math.floor(f.length*p);
      const next=f.slice(0,keep)+[...f.slice(keep)].map(c=>noise(c,NOISE)).join('');nodes[i].data=next;written[i]=next;}
    if(p<1)requestAnimationFrame(frame);else{nodes.forEach((n,i)=>{if(n.data===written[i])n.data=finals[i];});running.delete(el);}};
  requestAnimationFrame(frame);
}

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

// Pokémon art style: HOME renders (default) or Showdown's animated sprites, Black/White or XY. Kept per browser.
export type SpriteStyle='home'|'gen5'|'xy';
const KEY='frontierbrain.sprites';const listeners=new Set<()=>void>();
let style:SpriteStyle=(()=>{try{const v=localStorage.getItem(KEY);return v==='gen5'||v==='xy'?v:'home';}catch{return 'home';}})();
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
