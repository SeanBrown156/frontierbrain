// AI summaries of the player's replays: one per game ("what happened, what to work on") and one digest per team
// ("themes across games"). Runs on the chat model tier. Inputs are a compact, chat-free transcript built from the
// parsed log, so the model judges decisions from the recorded sequence; counts in the digest are recomputed here.
import {createHash} from 'node:crypto';
import {json,optionalJSON,save,removeFile,dataContext,activeAI} from './io.ts';
import {keepAlive} from './keep-alive.ts';
import type {Game,ReplayIndex} from './replays.ts';
import {chatJSON,type ChatOptions} from './chat.ts';
import {resolveTier} from './models.ts';
import {readStore,currentTeam} from './workbench-store.ts';
import {startTask,listJobs} from './ai-jobs.ts';

import {TEAM_STYLES} from '../shared/workbench.ts';
// The same team styles matchup plans use, so a plan and the games it covers share one vocabulary.
export const STYLES=TEAM_STYLES;
export interface ReplaySummary {gameId:string;summary:string;keyMoments:{turn:number;text:string}[];workOn:{title:string;detail:string;category:'play'|'building'|'variance';turn?:number}[];opponentStyle:string[];confidence:'high'|'medium'|'low';model:string;createdAt:string;association:string;setsBasis:string;
  /** True when the player edited the AI's text; `earlierSummary` keeps the wording a later re-summary replaced. */edited?:boolean;earlierSummary?:string;}
export interface TeamDigest {teamId:string;themes:{title:string;detail:string;games:string[];count:number;of:'losses'|'games';total:number}[];strengths:string[];games:number;model:string;createdAt:string;edited?:boolean;/** Set when games were deleted since it was made; cleared by a refresh. */note?:string;}
const DIR='reports/replay-summaries',DIGESTS='reports/replay-digests';
const shown=(raw:string)=>raw.replace(/^p[12][ab]?: ?/,'');

export async function readGame(id:string):Promise<Game>{const index=await json<ReplayIndex>('replays/index.json');const entry=index.games.find(g=>g.id===id);if(!entry)throw new Error('Replay not found');return json<Game>(entry.parsed);}
// Per turn: moves, damage (HP after), KOs, crits/misses, Megas and field changes. Chat and raw HTML are left out:
// replay text is data, never instructions.
export function transcript(game:Game){
  const own=game.ownSide;const side=(ref:string)=>ref.startsWith(own)?'You':'Opp';const who=(ref:string)=>`${side(ref)} ${shown(ref)}`;
  const keep=new Set(['switch','drag','move','-damage','faint','-crit','-miss','-supereffective','-resisted','-immune','-mega','-weather','-fieldstart','-fieldend','-sidestart','-sideend','-boost','-unboost','-status','cant','-fail','-heal','-hitcount','detailschange','-activate']);
  const lines:string[]=[];
  for(const t of [0,...game.turns.map(x=>x.turn)]){const events=game.events.filter(e=>e.turn===t&&keep.has(e.type));if(!events.length)continue;
    lines.push(t===0?'Leads:':`Turn ${t}:`);
    for(const e of events){const [a='',b='',c='']=e.args;
      const text=e.type==='move'?`${who(a)} used ${b}${c&&c!==a?` → ${who(c)}`:''}`:e.type==='switch'||e.type==='drag'?`${who(a)} switched in`:e.type==='-damage'?`  ${who(a)} at ${b.split(' ')[0]}${e.args.find(x=>x.startsWith('[from]'))?` (${e.args.find(x=>x.startsWith('[from]'))!.slice(7)})`:''}`
        :e.type==='-heal'?`  ${who(a)} healed to ${b.split(' ')[0]}`:e.type==='faint'?`  ${who(a)} fainted`:e.type==='-crit'?`  critical hit on ${who(a)}`:e.type==='-miss'?`  ${who(a)} missed`:e.type==='-supereffective'?`  super effective on ${who(a)}`:e.type==='-resisted'?`  resisted by ${who(a)}`:e.type==='-immune'?`  ${who(a)} immune`
        :e.type==='-mega'?`  ${who(a)} Mega Evolved`:e.type==='-boost'||e.type==='-unboost'?`  ${who(a)} ${b} ${e.type==='-boost'?'+':'-'}${c}`:e.type==='-status'?`  ${who(a)} ${b}`:e.type==='cant'?`  ${who(a)} couldn't move (${b})`:e.type==='-fail'?`  ${who(a)}'s move failed`:e.type==='-hitcount'?`  hit ${b} times`
        :e.type==='-weather'?(e.args.includes('[upkeep]')?'':`  weather: ${a}`):e.type==='-fieldstart'?`  ${a.replace('move: ','')} started`:e.type==='-fieldend'?`  ${a.replace('move: ','')} ended`:e.type==='-sidestart'?`  ${a.startsWith(own)?'Your':'Opp'} side: ${b.replace('move: ','')}`:e.type==='-sideend'?`  ${a.startsWith(own)?'Your':'Opp'} ${b.replace('move: ','')} ended`:e.type==='-activate'&&/Protect|Wide Guard|Quick Guard|Detect|Follow Me|Rage Powder|Ally Switch|Substitute/.test(b)?`  ${who(a)}: ${b.replace(/^(move|ability): /,'')}`:'';
      if(text)lines.push(text);}}
  return lines.join('\n').slice(0,14000);
}
const fingerprint=(a:unknown)=>createHash('sha256').update(JSON.stringify(a??null)).digest('hex').slice(0,16);
const text=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
export function validateSummary(value:any,game:Game){
  const turns=new Set(game.turns.map(t=>t.turn));const turn=(n:unknown)=>{if(n===undefined||n===null)return undefined;if(!Number.isInteger(n)||!turns.has(n as number))throw new Error(`Turn ${n} is not in this game (turns 1–${game.turns.length})`);return n as number;};
  const summary=text(value?.summary,900);if(!summary)throw new Error('summary is required');
  const keyMoments=(Array.isArray(value?.keyMoments)?value.keyMoments:[]).slice(0,5).map((m:any)=>({turn:turn(m.turn)!,text:text(m.text,300)})).filter((m:any)=>m.turn!==undefined&&m.text);
  const workOn=(Array.isArray(value?.workOn)?value.workOn:[]).slice(0,3).map((w:any)=>{if(!['play','building','variance'].includes(w.category))throw new Error('workOn category must be play, building or variance');return {title:text(w.title,90),detail:text(w.detail,800),category:w.category,turn:turn(w.turn)};}).filter((w:any)=>w.title);
  const opponentStyle=(Array.isArray(value?.opponentStyle)?value.opponentStyle:[]).map((s:any)=>{if(!(STYLES as readonly string[]).includes(s))throw new Error(`Unknown style ${s}; use one of: ${STYLES.join(', ')}`);return s;}).slice(0,4);
  return {summary,keyMoments,workOn,opponentStyle,confidence:['high','medium','low'].includes(value?.confidence)?value.confidence:'medium'};
}
const guidance=`You are summarising ONE of the player's Pokémon Champions VGC doubles replays (Regulation M-C) for their own review.
Judge each decision only with information available at that turn, not what was revealed later. Never state an opponent's unrevealed item, spread or move as fact. Separate play mistakes (play), team-building weaknesses (building) and luck such as crits, misses or speed ties (variance). Cite turn numbers. Be concrete and brief; no generic advice.
Reply as JSON only: {"summary":"1–2 sentences: how the game was won or lost","keyMoments":[{"turn":n,"text":"..."}] (2–4),"workOn":[{"title":"short imperative","detail":"one or two sentences","category":"play|building|variance","turn":n?}] (1–3, most important first; for a clean win it can be one 'keep doing' item),"opponentStyle":[tags from: ${STYLES.join(', ')}],"confidence":"high|medium|low"}.`;

// The game, its team link and the sets it is judged against (shared by the in-app AI and by summaries an assistant saves).
async function replayContext(gameId:string){
  const game=await readGame(gameId);const db=await readStore();const association=db.associations[gameId];const team=association?db.teams.find(t=>t.id===association.teamId):undefined;
  let sets='No team linked.',setsBasis='none';
  if(team){const v=currentTeam(db,team,association!.versionId??team.activeVersionId,association!.certainty==='exact'?association!.configurationId:undefined);setsBasis=association!.certainty==='exact'?(association!.basis==='auto'?'sets current when played, consistent with the game (spreads unconfirmed)':'exact sets played'):'current sets (the sets played were not matched)';
    sets=v.sets.map(s=>`${s.species} @ ${s.item||'no item'} · ${s.ability} · ${s.nature} · ${(s.moves??[]).join(' / ')}`).join('\n');}
  return {game,db,association,team,sets,setsBasis};
}
// A summary written by the player's own assistant over MCP: checked by the same rules as the in-app AI's, then stored the same way.
export async function saveReplaySummary(gameId:string,value:any,model='Your assistant (MCP)'):Promise<ReplaySummary>{
  const {game,association,setsBasis}=await replayContext(gameId);if(!association)throw new Error('Replay not found');
  const out:ReplaySummary={gameId,...validateSummary(value,game),model,createdAt:new Date().toISOString(),association:fingerprint(association),setsBasis,...await carried(gameId)};
  await save(`${DIR}/${gameId}.json`,out);return out;
}
// The wording of a summary the player edited is kept (as `earlierSummary`) when a re-summary replaces it.
async function carried(gameId:string):Promise<{earlierSummary?:string}>{const p=await readSummary(gameId);if(!p)return {};
  return p.edited?{earlierSummary:p.summary}:p.earlierSummary?{earlierSummary:p.earlierSummary}:{};}
// What the player already has for this game, put in front of whoever is re-summarising so their points are folded in.
export function priorForPrompt(p:ReplaySummary|null):string{if(!p)return '';
  return `\n\nThe player already has a summary of this game${p.edited?' (they edited it, so treat their wording as their view)':''}:\n${p.summary}${p.keyMoments.length?'\nKey moments: '+p.keyMoments.map(m=>`turn ${m.turn}: ${m.text}`).join(' | '):''}${p.workOn.length?'\nWork on: '+p.workOn.map(w=>`${w.title}: ${w.detail}`).join(' | '):''}\nKeep what is still true and keep the player's own wording and points where they still hold; do not drop them.`;}
// The team's "what to work on" digest written by an assistant. Counts and totals are recomputed here from the saved summaries.
export async function saveTeamDigest(teamId:string,value:any,model='Your assistant (MCP)'):Promise<TeamDigest>{
  const db=await readStore();const ids=Object.entries(db.associations).filter(([,a])=>a.teamId===teamId).map(([id])=>id);
  const rows:{gameId:string;result:string}[]=[];for(const id of ids){if(!(await readSummary(id)))continue;const g=await readGame(id).catch(()=>null);if(g)rows.push({gameId:id,result:g.result});}
  if(rows.length<2)throw new Error('Save summaries for at least two of this team\'s replays first.');
  const prev=await readDigest(teamId);const out:TeamDigest={teamId,...validateDigest(value,rows),games:rows.length,model,createdAt:new Date().toISOString(),...prev?.edited?{edited:true}:{}};
  await save(`${DIGESTS}/${teamId}.json`,out);return out;
}
export async function summariseReplay(gameId:string,emit:(e:any,d:any)=>void=()=>{},opts:ChatOptions={}):Promise<ReplaySummary>{
  const {game,association,team,sets,setsBasis}=await replayContext(gameId);
  const other=game.ownSide==='p1'?'p2':'p1';
  const prompt=`Result: ${game.result} (${game.turns.length} turns). Format: ${game.format}.
The player's team (${setsBasis}):\n${sets}
The player brought: ${game.revealed[game.ownSide].join(', ')}${game.unknownBackSlots[game.ownSide]?` + ${game.unknownBackSlots[game.ownSide]} unseen`:''}. Lead: ${game.leads[game.ownSide].join(' + ')}.
Opponent preview: ${game.preview[other].join(', ')}. Opponent brought (seen): ${game.revealed[other].join(', ')}${game.unknownBackSlots[other]?` + ${game.unknownBackSlots[other]} unseen`:''}. Lead: ${game.leads[other].join(' + ')}.

Transcript ("You" is the player):\n${transcript(game)}${priorForPrompt(await readSummary(gameId))}`;
  const tier=opts.model||opts.fetchImpl?{model:opts.model??'test',effort:opts.effort}:await resolveTier('chat');
  const r=await chatJSON(prompt,{teamId:team?.id,versionId:association?.versionId},emit,v=>validateSummary(v,game),{maxSteps:6,keepTranscript:false,extraInstructions:guidance,...opts,model:tier.model,effort:tier.effort});
  const out:ReplaySummary={gameId,...r.value,model:tier.model,createdAt:new Date().toISOString(),association:fingerprint(association),setsBasis,...await carried(gameId)};
  await save(`${DIR}/${gameId}.json`,out);return out;
}
export async function readSummary(gameId:string){return optionalJSON<ReplaySummary|null>(`${DIR}/${gameId}.json`,null);}
export const isStale=(s:ReplaySummary,association:unknown)=>s.association!==fingerprint(association);

export function validateDigest(value:any,summaries:{gameId:string;result:string}[]){
  const ids=new Set(summaries.map(s=>s.gameId));const losses=summaries.filter(s=>s.result==='loss').length;
  const themes=(Array.isArray(value?.themes)?value.themes:[]).slice(0,5).map((t:any)=>{const games=[...new Set((Array.isArray(t.games)?t.games:[]).filter((g:any)=>ids.has(g)))] as string[];if(!games.length)throw new Error(`Theme "${t.title}" must list game ids from the input`);
    const of=t.of==='losses'?'losses':'games';const count=of==='losses'?games.filter(g=>summaries.find(s=>s.gameId===g)!.result==='loss').length:games.length;
    return {title:text(t.title,90),detail:text(t.detail,900),games,count,of,total:of==='losses'?losses:summaries.length};}).filter((t:any)=>t.title&&t.count>0);
  return {themes,strengths:(Array.isArray(value?.strengths)?value.strengths:[]).slice(0,3).map((s:any)=>text(s,200)).filter(Boolean)};
}
// The debrief the player already has (and their notes on it), so a refresh builds on it instead of discarding it.
async function priorDigest(teamId:string):Promise<string>{const d=await readDigest(teamId);if(!d)return '';
  return `\n\nThe player already has this debrief${d.edited?' (they edited it, so keep their wording where it still fits)':''}:\n${d.themes.map(t=>`- ${t.title}: ${t.detail}`).join('\n')}${d.strengths?.length?'\nWorking: '+d.strengths.join(' | '):''}\nKeep what still holds, keep their wording where it fits, and drop only what the newer games contradict.`;}
export async function teamDigest(teamId:string,emit:(e:any,d:any)=>void=()=>{},opts:ChatOptions={}):Promise<TeamDigest>{
  const db=await readStore();const ids=Object.entries(db.associations).filter(([,a])=>a.teamId===teamId).map(([id])=>id);
  const rows:{gameId:string;result:string;s:ReplaySummary}[]=[];for(const id of ids){const s=await readSummary(id);if(!s)continue;const g=await readGame(id).catch(()=>null);if(g)rows.push({gameId:id,result:g.result,s});}
  if(rows.length<2)throw new Error('Summarise at least two games first');
  const prompt=`Summaries of ${rows.length} games (${rows.filter(r=>r.result==='win').length} wins, ${rows.filter(r=>r.result==='loss').length} losses) with one team. Find what to work on across games.\n\n${rows.map(r=>`Game ${r.gameId} (${r.result}): ${r.s.summary}\nWork on: ${r.s.workOn.map(w=>`[${w.category}] ${w.title}: ${w.detail}`).join(' | ')}\nOpponent style: ${r.s.opponentStyle.join(', ')||'—'}`).join('\n\n')}${await priorDigest(teamId)}`;
  const guide=`Group recurring problems into 2–5 themes, most important first. Each theme lists the exact game ids it comes from; say "losses" when it explains losses. Prefer play and building themes over variance. Don't invent anything not in the summaries; ${rows.length} games is a small sample, so word it as patterns to test, not verdicts.
Reply as JSON only: {"themes":[{"title":"short imperative","detail":"two sentences: what keeps happening, and what to try","games":["id",...],"of":"losses|games"}],"strengths":["..."] (0–2)}.`;
  const tier=opts.model||opts.fetchImpl?{model:opts.model??'test',effort:opts.effort}:await resolveTier('chat');
  const r=await chatJSON(prompt,{teamId},emit,v=>validateDigest(v,rows),{maxSteps:2,keepTranscript:false,extraInstructions:guide,...opts,model:tier.model,effort:tier.effort});
  const prev=await readDigest(teamId);
  const out:TeamDigest={teamId,...r.value,games:rows.length,model:tier.model,createdAt:new Date().toISOString(),...prev?.edited?{edited:true}:{}};
  await save(`${DIGESTS}/${teamId}.json`,out);return out;
}
export async function readDigest(teamId:string){return optionalJSON<TeamDigest|null>(`${DIGESTS}/${teamId}.json`,null);}

// After a replay is deleted: drop it from the team's debrief themes and recompute their counts from the games that remain.
// Deleting a replay keeps the debrief (including the player's edits) for the games that remain, with a note that it is built
// from fewer games than before; it goes only when no theme is left. A refresh rebuilds it and clears the note.
export async function pruneDigest(teamId:string,goneId:string):Promise<'none'|'unchanged'|'updated'|'removed'>{
  const d=await readDigest(teamId);if(!d)return 'none';
  const db=await readStore();const rows:{gameId:string;result:string}[]=[];
  for(const [id,a] of Object.entries(db.associations))if(a.teamId===teamId&&id!==goneId&&await readSummary(id)){const g=await readGame(id).catch(()=>null);if(g)rows.push({gameId:id,result:g.result});}
  if(!rows.length){await removeFile(`${DIGESTS}/${teamId}.json`).catch(()=>{});return 'removed';}
  if(!d.themes.some(t=>t.games.includes(goneId))&&d.games===rows.length)return 'unchanged';
  const losses=rows.filter(r=>r.result==='loss').length;
  const themes=d.themes.map(t=>{const games=t.games.filter(g=>g!==goneId);const count=t.of==='losses'?games.filter(g=>rows.find(r=>r.gameId===g)?.result==='loss').length:games.length;return {...t,games,count,total:t.of==='losses'?losses:rows.length};}).filter(t=>t.games.length&&t.count>0);
  if(!themes.length){await removeFile(`${DIGESTS}/${teamId}.json`).catch(()=>{});return 'removed';}
  const note=`Built from ${d.games} games; ${rows.length} summarised game${rows.length===1?'':'s'} remain after a replay was deleted. Refresh to rebuild it${rows.length<2?' once there are two':''}.`;
  await save(`${DIGESTS}/${teamId}.json`,{...d,themes,games:rows.length,note});return 'updated';
}
// The player's own edits: the AI's text is theirs to change. A re-summary or refresh is shown what they wrote and builds on it.
export async function editReplaySummary(gameId:string,patch:{summary?:unknown;keyMoments?:unknown;workOn?:unknown}):Promise<ReplaySummary>{
  const s=await readSummary(gameId);if(!s)throw new Error('Nothing to edit yet: summarise this game first.');const game=await readGame(gameId);
  if(typeof patch.summary==='string'&&!patch.summary.trim())throw new Error('The summary cannot be empty.');
  const v=validateSummary({summary:patch.summary??s.summary,keyMoments:patch.keyMoments??s.keyMoments,workOn:patch.workOn??s.workOn,opponentStyle:s.opponentStyle,confidence:s.confidence},game);
  if(v.workOn.some((w:{title:string})=>!w.title))throw new Error('Each item to work on needs a title.');
  const changed=JSON.stringify([v.summary,v.keyMoments,v.workOn])!==JSON.stringify([s.summary,s.keyMoments,s.workOn]);
  const next:ReplaySummary={...s,summary:v.summary,keyMoments:v.keyMoments,workOn:v.workOn,...changed?{edited:true}:{}};
  await save(`${DIR}/${gameId}.json`,next);return next;
}
export async function editTeamDigest(teamId:string,patch:{themes?:unknown;strengths?:unknown}):Promise<TeamDigest>{
  const d=await readDigest(teamId);if(!d)throw new Error('There is no debrief to edit yet.');const next={...d};
  // Themes are edited by position: each keeps its games and counts, only the wording changes; leaving one out removes it.
  if(Array.isArray(patch.themes)){const used=new Set<number>();
    next.themes=patch.themes.slice(0,5).map((t:any)=>{const i=Number(t?.from);if(!Number.isInteger(i)||!d.themes[i]||used.has(i))throw new Error('Unknown theme.');used.add(i);
      const title=text(t.title,90),detail=text(t.detail,900);if(!title)throw new Error('A theme needs a title.');return {...d.themes[i],title,detail};});}
  if(Array.isArray(patch.strengths))next.strengths=patch.strengths.slice(0,3).map((x:any)=>text(x,200)).filter(Boolean);
  if(JSON.stringify([next.themes,next.strengths])!==JSON.stringify([d.themes,d.strengths]))next.edited=true;
  await save(`${DIGESTS}/${teamId}.json`,next);return next;
}
// New replays are summarised one at a time in the background, then the team digest is refreshed (from 2 games up).
// One queue per owner, so users never wait on each other's summaries.
const queues=new Map<string,Promise<unknown>>();
export function queueSummaries(teamId:string|undefined,gameIds:string[],digest=true){
  if(!activeAI())return Promise.resolve(); // no key, no summaries (guests, or a player who hasn't added one)
  const owner=dataContext().userId??'local';let queue=queues.get(owner)??Promise.resolve();
  for(const id of gameIds)queue=queue.then(()=>new Promise<void>(done=>{const job=startTask('replay-summary',`Summarise ${id}`,{teamId},[],async(emit,signal)=>{const s=await summariseReplay(id,emit,{signal});return {value:s,model:s.model};});
    const wait=setInterval(()=>{if(job.status!=='running'){clearInterval(wait);done();}},500);}));
  if(teamId&&digest)queue=queue.then(async()=>{const db=await readStore();const ids=Object.entries(db.associations).filter(([,a])=>a.teamId===teamId).map(([id])=>id);let n=0;for(const id of ids)if(await readSummary(id))n++;
    if(n>=2)await new Promise<void>(done=>{const job=startTask('team-digest',`What to work on`,{teamId},[],async(emit,signal)=>{const d=await teamDigest(teamId,emit,{signal});return {value:d,model:d.model};});const wait=setInterval(()=>{if(job.status!=='running'){clearInterval(wait);done();}},500);});}).catch(()=>{});
  queues.set(owner,queue);keepAlive(queue);return queue;
}
// What's running for a team, for "Summarising…" badges.
export async function runningFor(teamId:string){return (await listJobs(60)).filter(j=>j.status==='running'&&(j.area==='replay-summary'||j.area==='team-digest')&&j.context.teamId===teamId).map(j=>({area:j.area,title:j.title}));}
