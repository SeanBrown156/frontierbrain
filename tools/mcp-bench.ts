// MCP tools for the Bench: Pokémon a team is considering. Adding and editing candidates is exploration, so it applies
// straight away and never joins the Accept/Reject queue; promoting a candidate into the team does (a suggestion by
// default, apply: true to apply), the same flow as update_set.
import {readStore,mutateLatest,applyAction,currentTeam,validation} from './workbench-store.ts';
import {importText} from './teams.ts';
import {finalStats} from './mechanics.ts';
import {setStrategyText,checkPokemonStrategy,BENCH_LABEL,BENCH_LIMIT} from '../shared/workbench.ts';
import type {Workbench,Formula,BenchEntry,PokemonSet} from '../shared/workbench.ts';

const str={type:'string'};const teamId={teamId:{type:'string',description:'Team id from list_teams'}};
const strategy={...str,description:'The Pokémon\'s Strategy for THIS team, always three sections: "## Role" (one line: the job it would do), "## How to play", "## Watch out for", each a sentence or two. Say what it gives that the Pokémon it could replace does not.'};
const applyFlag={apply:{type:'boolean',description:'Default false: the promotion is sent to the player as a suggestion they accept in Frontier Brain. Set true only when the player has asked you to just apply it.'}};
const label=BENCH_LABEL.toLowerCase();
export const benchTools=[
  {name:'get_bench',description:`The team's ${label}: Pokémon being considered for this team, each with its set, final stats, Strategy, the Pokémon it could replace and whether it would be legal in each slot. Call it before adding, so you edit what exists instead of adding a near-duplicate.`,parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'add_to_bench',description:`Put one candidate Pokémon on the team's ${label}: something the player might promote into the team later. Only Pokémon in the current regulation's roster can be added (anything else is refused; check dex_lookup or usage_data first, and never suggest from older formats). It is exploration, so it is saved straight away and is not a suggestion to accept; nothing about the six changes. Send a Showdown paste of ONE Pokémon (Champions stat points on the "EVs:" line, 66 total), a Strategy in the standard Role / How to play / Watch out for format, and optionally the team member it could replace. Support your reasoning with calc_damage / calc_speed numbers. Up to ${BENCH_LIMIT} candidates.`,parameters:{type:'object',properties:{...teamId,paste:{...str,description:'Showdown paste of the one candidate'},strategy,replaces:{...str,description:'Optional: the team Pokémon it could replace (species on the team now). A hint, it locks nothing.'}},required:['teamId','paste','strategy']}},
  {name:'update_bench',description:`Change a candidate on the ${label} (send only what changes; moves replaces the whole list of four; statPoints keys hp, atk, def, spa, spd, spe, 0–32 each, 66 total) and/or its Strategy and/or which team Pokémon it could replace. Saved straight away: the ${label} is a scratchboard.`,parameters:{type:'object',properties:{...teamId,benchId:{...str,description:'Candidate id from get_bench'},changes:{type:'object',properties:{moves:{type:'array',items:str,minItems:4,maxItems:4},item:str,ability:str,nature:str,statPoints:{type:'object'},strategy},description:'Only the fields that change'},replaces:{...str,description:'The team Pokémon it could replace; an empty string clears the hint'}},required:['teamId','benchId']}},
  {name:'remove_from_bench',description:`Take a candidate off the ${label}. The set stays in the player's Pokémon library. Its content comes back in the result so it can be added again.`,parameters:{type:'object',properties:{...teamId,benchId:str},required:['teamId','benchId']}},
  {name:'promote_from_bench',description:`Move a ${label} candidate into the team in place of one of the six; that Pokémon goes onto the ${label} so the swap can be undone. Checked against the format rules (item and species clause, stat points). By default a suggestion the player accepts in Frontier Brain; with apply: true it is saved straight away as a new step in History. The candidate's saved set goes in as it is, so its benchmarks and Strategy travel with it. Show the player the \`message\` you get back.`,parameters:{type:'object',properties:{...teamId,benchId:str,pokemon:{...str,description:'The team Pokémon it takes the slot of. Defaults to the candidate\'s "replaces" hint.'},summary:{...str,description:'One line: why (shown to the player)'},...applyFlag},required:['teamId','benchId','summary']}},
];
export const benchNames=new Set(benchTools.map(t=>t.name));
const where='Open this team in Frontier Brain and the suggestion shows under Ask Frontier Brain to Accept or Reject.';
const team=(db:Workbench,id:unknown):Formula=>{const t=db.teams.find(x=>x.id===id);if(!t)throw new Error('Team not found');return t;};
const candidate=(db:Workbench,t:Formula,id:unknown)=>{const item=(t.bench??[]).find(b=>b.id===id);if(!item)throw new Error('No candidate with that id on the bench; call get_bench.');
  const entry=db.bank.find(b=>b.id===item.bankId)!;const revision=entry.revisions.find(r=>r.id===item.revisionId)!;return {item,entry,revision};};
// Would this set be legal in each slot? Returns a refusal reason per slot that would not be.
function fit(db:Workbench,t:Formula,set:PokemonSet){
  const view=currentTeam(db,t);const out:{slot:number;replaces:string;legal:boolean;problem?:string}[]=[];
  for(let i=0;i<6;i++){const errors=validation(view.sets.map((s,j)=>j===i?set:s),t.format);out.push({slot:i,replaces:view.sets[i].species,legal:!errors.length,...errors.length?{problem:errors.join(' ').replace(/^Illegal team:\s*/,'')}:{}});}
  return out;
}
const slotOf=(db:Workbench,t:Formula,name:unknown)=>{const sets=currentTeam(db,t).sets;const i=sets.findIndex(s=>s.species.toLowerCase()===String(name).trim().toLowerCase());
  if(i<0)throw new Error(`"${name}" is not on this team (${sets.map(s=>s.species).join(', ')}).`);return i;};
const describe=(db:Workbench,t:Formula,item:BenchEntry)=>{const {entry,revision}=candidate(db,t,item.id);const s=revision.set;
  return {id:item.id,pokemon:s.species,item:s.item,ability:s.ability,nature:s.nature,moves:s.moves,statPoints:s.statPoints,finalStats:finalStats(s),strategy:setStrategyText(revision.notes),replaces:item.replaces??null,source:item.source,
    benchmarks:(db.benchmarks??[]).filter(b=>b.revisionId===revision.id).length,library:entry.name,fits:fit(db,t,s).map(f=>f.legal?`slot ${f.slot+1} (${f.replaces}): legal`:`slot ${f.slot+1} (${f.replaces}): ${f.problem}`)};};
const changeLines=(before:PokemonSet,after:PokemonSet)=>{const L:string[]=[];if(before.species!==after.species)L.push(`**Pokémon:** ${before.species} → ${after.species}`);
  for(const [k,l] of [['item','Item'],['ability','Ability'],['nature','Nature']] as const)if((before[k]??'')!==(after[k]??''))L.push(`**${l}:** ${before[k]||'—'} → ${after[k]||'—'}`);
  const out=(before.moves??[]).filter(m=>!after.moves?.includes(m)),inn=(after.moves??[]).filter(m=>!before.moves?.includes(m));if(out.length||inn.length)L.push(`**Moves:** ${out.join(', ')||'—'} → ${inn.join(', ')||'—'}`);
  const sp=['hp','atk','def','spa','spd','spe'].filter(k=>((before.statPoints as any)?.[k]??0)!==((after.statPoints as any)?.[k]??0)).map(k=>`${k.toUpperCase()} ${(before.statPoints as any)?.[k]??0} → ${(after.statPoints as any)?.[k]??0}`);if(sp.length)L.push(`**Stat points:** ${sp.join(', ')}`);return L;};
const text=(v:unknown,max:number)=>String(v??'').trim().slice(0,max);

export async function benchCall(name:string,input:any,db:Workbench):Promise<unknown>{
  const t=team(db,input.teamId);const six=currentTeam(db,t).sets.map(s=>s.species);
  if(name==='get_bench')return {team:t.name,format:t.format,six,bench:(t.bench??[]).map(b=>describe(db,t,b)),note:`${(t.bench??[]).length} of ${BENCH_LIMIT}. The player sees these on the team's ${BENCH_LABEL} tab.`};
  if(name==='add_to_bench'){
    const one:PokemonSet[]=importText(String(input.paste??''));if(one.length!==1)throw new Error('Send exactly one Pokémon in the paste.');
    const s=text(input.strategy,6000);if(!s)throw new Error('strategy is required: Role / How to play / Watch out for.');const bad=checkPokemonStrategy(s);if(bad)throw new Error(bad);
    const replaces=input.replaces?six[slotOf(db,t,input.replaces)]:undefined;
    const r:any=await mutateLatest(d=>applyAction(d,{type:'bench-add',teamId:t.id,set:one[0],notes:{role:s,benchmarks:''},replaces,source:'assistant'} as any));
    const now=await readStore();const fresh=now.teams.find(x=>x.id===t.id)!;
    return {added:r.result.species,benchId:r.result.id,replaces:replaces??null,fits:describe(now,fresh,(fresh.bench??[]).find(b=>b.id===r.result.id)!).fits,note:`Saved to the team's ${BENCH_LABEL} tab. The six is unchanged; promote_from_bench would suggest moving it in.`};}
  if(name==='update_bench'){const {item,revision}=candidate(db,t,input.benchId);const ch=input.changes??{};const before=revision.set;
    if(ch.moves===undefined&&ch.item===undefined&&ch.ability===undefined&&ch.nature===undefined&&ch.statPoints===undefined&&ch.strategy===undefined&&input.replaces===undefined)throw new Error('Nothing to change: send changes and/or replaces.');
    const set:any=structuredClone(before);
    if(ch.moves!==undefined){if(!Array.isArray(ch.moves)||ch.moves.length!==4)throw new Error('moves is the full list of four move names (keep the ones that stay).');set.moves=ch.moves.map(String);}
    for(const k of ['item','ability','nature'])if(ch[k]!==undefined)set[k]=String(ch[k]);
    if(ch.statPoints!==undefined){if(typeof ch.statPoints!=='object'||Array.isArray(ch.statPoints))throw new Error('statPoints is an object like {"spa":32,"spe":32,"hp":2}.');set.statPoints={...(before.statPoints??{}),...ch.statPoints};}
    let notes:any;if(ch.strategy!==undefined){const s=text(ch.strategy,6000);if(!s)throw new Error('strategy cannot be empty: send the full write-up.');const bad=checkPokemonStrategy(s);if(bad)throw new Error(bad);notes={role:s,benchmarks:''};}
    const replaces=input.replaces===undefined?undefined:input.replaces===''?'':six[slotOf(db,t,input.replaces)];
    const lines=changeLines(before,set);if(notes&&text(ch.strategy,6000)!==setStrategyText(revision.notes).trim())lines.push('**Strategy:** rewritten');
    await mutateLatest(d=>applyAction(d,{type:'bench-update',teamId:t.id,benchId:item.id,baseRevisionId:item.revisionId,set,...notes?{notes}:{notes:structuredClone(revision.notes)},...replaces!==undefined?{replaces}:{}} as any));
    return {updated:before.species,changes:lines.length?lines:['Hint only.'],note:`Saved to the team's ${BENCH_LABEL} tab.`};}
  if(name==='remove_from_bench'){const {item,revision}=candidate(db,t,input.benchId);await mutateLatest(d=>applyAction(d,{type:'bench-remove',teamId:t.id,benchId:item.id} as any));
    return {removed:revision.set.species,restorable:{set:revision.set,strategy:setStrategyText(revision.notes),replaces:item.replaces??null},note:'The set stays in the player\'s Pokémon library.'};}
  if(name==='promote_from_bench'){const {item,revision}=candidate(db,t,input.benchId);const target=input.pokemon??item.replaces;
    if(!target)throw new Error('Say which team Pokémon it takes the slot of (pokemon): this candidate has no "replaces" hint.');
    const slot=slotOf(db,t,target);const view=currentTeam(db,t);const current=view.sets[slot];const problem=fit(db,t,revision.set)[slot];
    if(!problem.legal)throw new Error(`Not legal in slot ${slot+1} (${current.species}): ${problem.problem}`);
    const lines=changeLines(current,revision.set);const baseRevisionId=view.configuration.slots[slot].revisionId;
    if(input.apply!==true){
      const strategyText=setStrategyText(revision.notes);
      const proposal={kind:'promote' as const,benchId:item.id,slot,species:revision.set.species,replacing:current.species,baseRevisionId,set:revision.set,why:text(input.summary,1500),...strategyText?{strategy:strategyText}:{}};
      await mutateLatest(d=>{for(const x of (d.pending??[]).filter(p=>p.teamId===t.id&&p.proposal.kind==='promote'&&p.proposal.benchId===item.id))applyAction(d,{type:'pending-resolve',id:x.id} as any);
        applyAction(d,{type:'pending-add',teamId:t.id,summary:`Promote ${revision.set.species} for ${current.species}`,proposal} as any);});
      return {proposed:true,pokemon:revision.set.species,replacing:current.species,changes:lines,message:`**Suggested: promote ${revision.set.species} from the ${label}, replacing ${current.species}**\n${lines.map(l=>`- ${l}`).join('\n')}\n\n_${input.summary}_\n\n${where}`};}
    const r:any=await mutateLatest(d=>applyAction(d,{type:'bench-promote',teamId:t.id,benchId:item.id,slot,baseRevisionId,summary:`Promoted by your assistant: ${text(input.summary,400)}`} as any));
    return {promoted:r.result.promoted,displaced:r.result.displaced,changes:lines,note:`Saved as a new step in the team's History. ${r.result.displaced} is on the ${BENCH_LABEL} now, so the swap can be undone.`};}
  throw new Error(`Unknown tool ${name}`);
}

// Added to the connector's instructions.
export const benchGuidance=`- The ${BENCH_LABEL} is where "what else could be in this slot?" lives: Pokémon the player is considering for a team, each with a Strategy for this team. When they wonder whether Pokémon X could replace Y, or ask for an idea to try, profile it (pokemon_profile), calc it against the team's real threats, then add_to_bench with the Strategy in the standard format and replaces set. Adding and editing candidates is saved straight away (it is a scratchboard and changes nothing about the six); promote_from_bench is the suggestion the player accepts. Use get_bench first so you edit what exists, and use update_set (not the ${BENCH_LABEL}) for changes to a Pokémon already on the team.`;
