// What Frontier Brain remembers about the player, across ChatGPT, Claude and the in-app assistant: how they like to
// play and be coached. Stored in the player's workspace (context/preferences.json), visible and editable in Settings.
// Personal preferences, never mechanics: assistants use them to tailor suggestions and questions.
import {optionalJSON,save} from './io.ts';

export interface Preferences {playstyle:string;formats:''|'Bo1'|'Bo3'|'both';explain:''|'brief'|'standard'|'detailed';goals:string;likes:string[];dislikes:string[];styleLikes:string[];styleDislikes:string[];hateFacing:string[];notes:string[];updatedAt?:string}
export const EMPTY:Preferences={playstyle:'',formats:'',explain:'',goals:'',likes:[],dislikes:[],styleLikes:[],styleDislikes:[],hateFacing:[],notes:[]};
const FILE='context/preferences.json';
const text=(v:unknown,max=400)=>typeof v==='string'?v.trim().slice(0,max):'';
const list=(v:unknown,n=20,max=120)=>Array.isArray(v)?[...new Set(v.map(x=>text(x,max)).filter(Boolean))].slice(0,n):[];

export async function readPreferences():Promise<Preferences>{return {...EMPTY,...await optionalJSON<Partial<Preferences>>(FILE,{})};}
// Replaces the fields given; leaves the rest alone.
export async function updatePreferences(patch:any):Promise<Preferences>{
  const current=await readPreferences();const next:Preferences={...current};
  if('playstyle'in patch)next.playstyle=text(patch.playstyle);
  if('formats'in patch)next.formats=['Bo1','Bo3','both'].includes(patch.formats)?patch.formats:'';
  if('explain'in patch)next.explain=['brief','standard','detailed'].includes(patch.explain)?patch.explain:'';
  if('goals'in patch)next.goals=text(patch.goals,600);
  for(const k of ['likes','dislikes','styleLikes','styleDislikes','hateFacing'] as const)if(k in patch)next[k]=list(patch[k]);
  if('notes'in patch)next.notes=list(patch.notes,30,300);
  next.updatedAt=new Date().toISOString();await save(FILE,next);return next;
}
const known=(p:Preferences)=>!!(p.playstyle||p.formats||p.explain||p.goals||p.likes.length||p.dislikes.length||p.styleLikes.length||p.styleDislikes.length||p.hateFacing.length||p.notes.length);
// The lines every assistant prompt carries.
export function preferencesText(p:Preferences){
  if(!known(p))return 'What the player has told Frontier Brain about themselves: nothing yet. When it matters, ask (playstyle, Bo1 or Bo3, Pokémon they love or avoid, team styles they like or dislike) and save the answers with update_player_profile.';
  const parts=[p.playstyle&&`playstyle: ${p.playstyle}`,p.formats&&`plays: ${p.formats==='both'?'Bo1 and Bo3':p.formats}`,p.explain&&`explanations: ${p.explain}`,p.goals&&`goals: ${p.goals}`,
    p.likes.length&&`likes using: ${p.likes.join(', ')}`,p.dislikes.length&&`avoids: ${p.dislikes.join(', ')}`,p.styleLikes.length&&`team styles they like: ${p.styleLikes.join(', ')}`,p.styleDislikes.length&&`team styles they dislike: ${p.styleDislikes.join(', ')}`,p.hateFacing.length&&`hates facing: ${p.hateFacing.join(', ')}`,p.notes.length&&`notes: ${p.notes.join('; ')}`].filter(Boolean);
  return `What the player has told Frontier Brain about themselves (preferences, not rules; don't re-ask these): ${parts.join(' · ')}. Save anything new they tell you with update_player_profile.`;
}
