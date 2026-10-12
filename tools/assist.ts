// "Ask AI" everywhere: one conversational assistant with guidance per area. Each turn returns a short reply plus
// proposals (sets, teams, plans) that are validated here with the Champions rules before the player can accept them.
// Nothing is saved by this module; accepted proposals are written by the normal store actions.
import {TEAM_STYLES} from '../shared/workbench.ts';
import {resolveTier} from './models.ts';
import {chatJSON,type ChatTurn,type ChatContext,type ChatOptions} from './chat.ts';
import {cleanSet,readStore,currentTeam} from './workbench-store.ts';
import {importText} from './teams.ts';
import {validateTeam,dex} from './mechanics.ts';
import type {PokemonSet} from '../shared/workbench.ts';

// `build` makes a whole team from a brief (New team). `assist` is the one docked chat on team pages; `page` says
// what the player is looking at so its guidance leads. The older per-panel areas are kept so saved jobs still load.
export type Area='build'|'assist'|'team'|'slot'|'coaching'|'strategy';
export type Page='overview'|'slot'|'strategy'|'coaching'|'replays'|'versions'|'general';
type Emit=(event:'tool'|'message'|'error',data:unknown)=>void;
const rules='Champions rules: level 50; stat points 0–32 per stat and at most 66 total (Showdown "EVs:" line); no IVs/Tera/Dynamax; six different species; no duplicate items; every Pokémon has an ability and four legal moves.';
const research='Research with tools before proposing: meta_overview (what wins), team_pool_sets (real items/natures/moves/spreads with player examples), standard_set + calc_damage / calc_speed / spread_search to justify spreads. Quote numbers only from tool results.';
const setShape='{"kind":"set","slot":<0-5 index in get_team>,"set":{"species","ability","item","nature","moves":[4],"statPoints":{"hp","atk","def","spa","spd","spe"}},"why":"one or two sentences with the key calc or usage fact"}';
export const guidance:Record<Area,string>={
  build:`Build a complete team from the player's brief. ${research} ${rules}
Proposals: exactly one {"kind":"team","name","strategy":markdown (game plan, win conditions, key threats, weaknesses),"paste":full Showdown export,"roles":[{"species","role","notes"}],"leads":[{"lead":[a,b],"back":[c,d],"when","plan"}],"matchups":[{"opponent","threat":"low|medium|high","bring":[4],"plan"}]}.`,
  team:`The player is revising the open team as a whole (get_team first). Answer their question, then propose concrete changes: swap or retune specific slots (${setShape}), or a full rebuild ({"kind":"team",...same shape as a team build}). Prefer the smallest change that achieves their goal; explain what each change gives up. ${research} ${rules}`,
  slot:`The player is working on ONE Pokémon: the focused slot in get_team. Answer their question; when they want a change propose 1–3 alternative sets for that slot (${setShape}, slot = the focused slot). A different species is allowed only when he asks for it. ${research} ${rules}`,
  coaching:`The player is planning how to play the open team (get_team first; use meta_overview for the opponents they will face). Plans are read as small cards, so keep them short and structured.
Lead plans: {"kind":"lead","role":"core|situational|niche|avoid","lead":[two team members],"back":[two others],"when":"one sentence: which teams this lead is for","plan":"2–4 short sentences or bullets: turn 1, turn 2, what to watch. Include only the one or two calcs that decide it."}
Matchup plans: {"kind":"matchup","opponent":"short name","archetype":"one of: ${TEAM_STYLES.join(', ')} (or a short custom style)","examples":[3–6 example opposing species],"threat":"low|medium|high","bring":[four team members],"plan":"2–4 short sentences: the lead, the key move or switch, what wins it"}. Don't repeat the archetype's Pokémon list in the opponent name.
Only use the team's own members in lead/back/bring.`,
  strategy:`The player wants the team's strategy write-up improved (get_team first). Propose {"kind":"strategy","text":markdown}: a short introduction to the team, not a manual. Start with "## Game plan" (2 short paragraphs or up to 5 bullets: what the team does, how it wins, its modes); then at most two short sections such as "## Bring rules" or "## Watch out for". Name Pokémon exactly ("Mega Swampert", "Farigiraf") so they render with sprites. Do NOT include lead tables, archetype tables or matchup lists: those belong in lead and matchup plan proposals. Keep it under about 250 words.`,
  assist:'',
};
const style='Write the reply for a narrow side panel: a one-line answer first, then short headings and bullets; at most one compact table (≤5 columns). Name sources (player/event or data source) for usage claims.';
const pageGuide:Record<Page,{full:string;line:string}>={
  general:{full:`No team is open. Answer questions about the metagame, sets, spreads, calcs and rules using the tools (meta_overview, team_pool_sets, standard_set, usage_data, calc_damage, calc_speed, spread_search). Do not call get_team and return no proposals (proposals: []); if he wants changes to a team, tell him to open that team and ask there.`,line:'General questions with no team open: answers only, no proposals.'},
  overview:{full:guidance.team,line:'Team-wide changes: set proposals for any slot (slot = index in get_team) or a full team proposal.'},
  slot:{full:guidance.slot.replace('(slot = the focused slot)','(slot = the focused slot unless he names another Pokémon)')+' Every calc_damage or calc_speed you run is also loaded, with its exact inputs, into the calc panel beside the chat (the last one stays on screen), so use the focused Pokémon as one side, keep the numbers in your reply brief and say the full result is shown in the calc.',line:'One Pokémon: set proposals for that slot.'},
  strategy:{full:`${guidance.strategy}\n${guidance.coaching}`,line:'Strategy write-up, lead and matchup proposals using only team members.'},
  coaching:{full:guidance.coaching,line:'Lead and matchup proposals using only team members.'},
  replays:{full:`The player is reviewing games played with this team. Answer from what they tell you and the team data; propose matchup or lead plans when useful. Never invent replay records. ${guidance.coaching}`,line:'Objectives and matchup plans from games.'},
  versions:{full:guidance.team,line:'Version-level changes.'},
};
// The page's guidance in full, the others as one-liners: any proposal kind is allowed wherever the player asks.
export function assistGuidance(page:Page='overview'){const p=pageGuide[page]??pageGuide.overview;if(page==='general')return `${p.full}\n${style}`;
  return `${p.full}\nHe may also ask for other kinds of changes from this page:\n${(Object.keys(pageGuide) as Page[]).filter(k=>k!==page&&k!=='coaching'&&k!=='general'&&!(page==='strategy'&&k==='versions')).map(k=>`- ${pageGuide[k].line}`).join('\n')}\n${style}`;}
export interface Proposal {kind:'set'|'team'|'lead'|'matchup'|'objective'|'strategy';[k:string]:any;}
const text=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';
const names=(v:unknown,n:number)=>Array.isArray(v)?v.filter(x=>typeof x==='string').slice(0,n):[];
function checkSet(raw:any){const set=cleanSet({...raw,statPoints:raw?.statPoints??{}} as PokemonSet);const total=Object.values(set.statPoints??{}).reduce((a,b)=>a+(b??0),0);if(total>66)throw new Error(`${set.species}: stat points total ${total}, maximum 66`);return set;}
export function validateTeamProposal(p:any){
  const paste=text(p.paste,20000);const sets=importText(paste).map(s=>checkSet(s));if(sets.length!==6)throw new Error(`Team paste has ${sets.length} Pokémon; it needs six`);validateTeam(sets);
  const items=sets.map(s=>s.item).filter(Boolean);if(new Set(items).size!==items.length)throw new Error('Duplicate held items');
  return {kind:'team' as const,name:text(p.name,120)||'New team',strategy:text(p.strategy,12000),paste,sets,roles:(Array.isArray(p.roles)?p.roles:[]).slice(0,6).map((r:any)=>({species:text(r.species,60),role:text(r.role,500),notes:text(r.notes,3000)})),
    leads:(Array.isArray(p.leads)?p.leads:[]).slice(0,4).map((l:any)=>({lead:names(l.lead,2),back:names(l.back,4),...(['core','situational','niche','avoid'].includes(l.role)?{role:l.role}:{}),when:text(l.when,1000),plan:text(l.plan,3000)})),
    matchups:(Array.isArray(p.matchups)?p.matchups:[]).slice(0,6).map((m:any)=>({opponent:text(m.opponent||m.archetype,200),...m.archetype?{archetype:text(m.archetype,80)}:{},...Array.isArray(m.examples)?{examples:names(m.examples,8)}:{},threat:['low','medium','high'].includes(m.threat)?m.threat:'medium',bring:names(m.bring,4),plan:text(m.plan,3000)}))};
}
export function validateProposals(area:Area,value:any,team:PokemonSet[]|null,focus?:number,page?:Page):{reply:string;proposals:Proposal[]}{
  const reply=text(value?.reply,6000);const raw=Array.isArray(value?.proposals)?value.proposals.slice(0,6):[];const members=new Set((team??[]).map(s=>dex.species.get(s.species).baseSpecies));
  const member=(n:string)=>{const b=dex.species.get(n).baseSpecies;if(!members.has(b))throw new Error(`${n} is not on the team`);return dex.species.get(n).name;};
  const proposals=raw.map((p:any):Proposal=>{switch(p?.kind){
    case 'set':{const pinned=area==='slot'||(area==='assist'&&page==='slot');const slot=pinned&&focus!==undefined&&(area==='slot'||p.slot===undefined||p.slot===null)?focus:Number(p.slot);if(!Number.isInteger(slot)||slot<0||slot>5)throw new Error('Set proposals need slot 0–5');const set=checkSet(p.set);
      if(team){const others=team.filter((_,i)=>i!==slot);if(set.item&&others.some(s=>s.item===set.item))throw new Error(`${set.item} is already held by another team member`);if(others.some(s=>dex.species.get(s.species).baseSpecies===dex.species.get(set.species).baseSpecies))throw new Error(`${set.species} is already on the team`);}
      // forSpecies records what the slot held when proposed, so a late Accept can warn if it has changed since.
      return {kind:'set',slot,set,why:text(p.why,1500),forSpecies:team?.[slot]?.species};}
    case 'team':return validateTeamProposal(p);
    case 'lead':return {kind:'lead',lead:names(p.lead,2).map(member),back:names(p.back,4).map(member),...(['core','situational','niche','avoid'].includes(p.role)?{role:p.role}:{}),when:text(p.when,1000),plan:text(p.plan,3000)};
    case 'matchup':return {kind:'matchup',opponent:text(p.opponent||p.archetype,200),...p.archetype?{archetype:text(p.archetype,80)}:{},...Array.isArray(p.examples)?{examples:names(p.examples,8)}:{},threat:['low','medium','high'].includes(p.threat)?p.threat:'medium',bring:names(p.bring,4).map(member),plan:text(p.plan,3000)};
    case 'objective':return {kind:'objective',type:p.type==='todo'?'todo':'test',text:text(p.text,1000)};
    case 'strategy':return {kind:'strategy',text:text(p.text,12000)};
    default:throw new Error(`Unknown proposal kind: ${p?.kind}`);}});
  if(area==='build'&&!proposals.some((p:Proposal)=>p.kind==='team'))throw new Error('A team build must include one team proposal');
  return {reply,proposals};
}
export async function assist(area:Area,messages:ChatTurn[],ctx:ChatContext,emit:Emit,opts:ChatOptions={}){
  if(!(area in guidance))throw new Error('Unknown assistant area');const page=ctx.page as Page|undefined;
  if(!Array.isArray(messages)||!messages.length||messages.length>40)throw new Error('Send 1–40 messages');
  // An explicit model (tests, scripts) skips the Settings tiers and the availability check.
  const tier:{model:string;effort?:ChatOptions['effort'];note?:string}=opts.model||opts.fetchImpl?{model:opts.model??'test',effort:opts.effort}:await resolveTier(area==='build'?'build':'chat');let team:PokemonSet[]|null=null;if(ctx.teamId){const db=await readStore();const t=db.teams.find(t=>t.id===ctx.teamId);if(t)team=currentTeam(db,t,ctx.versionId,ctx.configurationId).sets;}
  return chatJSON(messages,ctx,emit,v=>validateProposals(area,v,team,ctx.slot,page),{maxSteps:area==='build'?30:16,extraInstructions:`${area==='assist'?assistGuidance(page):guidance[area]}\nReply as JSON: {"reply":"short markdown answer or summary for the player","proposals":[...]} (proposals may be empty when they only asked a question).`,...opts,model:tier.model,effort:tier.effort}).then(r=>({...r,model:tier.model,modelNote:tier.note}));
}
