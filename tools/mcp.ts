// MCP connector: Claude, ChatGPT and CLI agents use Frontier Brain's tools with the player's own subscription.
// Hosted, every request carries a Supabase OAuth access token (the hosted handler checks it and scopes storage to
// that user); locally it serves the one workspace on this machine. Stateless: a fresh server per request.
// Same rules as the in-app assistant: numbers come from these tools, sources stay labelled, and anything that
// changes a team arrives as a proposal the player accepts in the app.
import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema,ListPromptsRequestSchema,GetPromptRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {tools as chatTools,runTool,instructions as chatInstructions} from './chat.ts';
import {readStore,mutateLatest,applyAction,currentTeam} from './workbench-store.ts';
import {importText} from './teams.ts';
import {loadGames} from './replays.ts';
import {transcript,readGame,readSummary} from './replay-summary.ts';
import {readPreferences,preferencesText} from './player.ts';

const teamId={teamId:{type:'string',description:'Team id from list_teams'}};
const str={type:'string'};
const mons=(d:string,n:number)=>({type:'array',items:str,minItems:n,maxItems:n,description:d});
// What a good plan looks like is the same for every assistant: the depth below is the standard the player expects.
const plan={type:'object',properties:{
  id:{...str,description:'Only to EDIT an existing lead plan: its id from get_strategy. Leave out for a new plan.'},
  title:{...str,description:'2–4 words naming the idea, e.g. "Trick Room Mawile" or "Fake Out balance"'},
  lead:mons('The two Pokémon you lead with (species from this team)',2),
  back:mons('The two Pokémon you hold back (the bring-four is lead + back)',2),
  role:{...str,enum:['core','situational','niche','avoid'],description:'REQUIRED. core = a default lead you reach for; situational = good into specific teams; niche = a pocket option; avoid = a pairing not to lead (say why and what to lead instead)'},
  when:{...str,description:'REQUIRED. One short sentence: when to pick this lead (what they run, what you need). For "avoid", what makes it bad.'},
  plan:{...str,description:'Markdown, short. Core/situational: "**T1:** …" then "**T2:** …" with the exact calc numbers that justify it (from calc_damage / calc_speed), and a "**Watch:** …" line for the one thing that beats it. Avoid: one or two sentences naming the safer lead. No filler.'}},
  required:['title','lead','back','role','when','plan']};
const matchup={type:'object',properties:{
  id:{...str,description:'Only to EDIT an existing matchup plan: its id from get_strategy. Leave out for a new plan.'},
  opponent:{...str,description:'Short name of the matchup, e.g. "Tailwind offense", "Sun ± Trick Room"'},
  archetype:{...str,description:'REQUIRED. The team style in one or two words: Tailwind, Trick Room, Rain, Sun, Sand, Psychic Terrain, Balance…'},
  examples:{type:'array',items:str,minItems:3,maxItems:6,description:'REQUIRED. 3–6 Pokémon that mark this matchup (species names)'},
  threat:{...str,enum:['low','medium','high'],description:'REQUIRED. How dangerous it is for this team (from pool share and the calcs)'},
  bring:mons('The four you bring (species from this team). The two you leave home are part of the plan.',4),
  plan:{...str,description:'Markdown, 2–4 sentences: what to lead and why, the key numbers (calc results, speed tiers), who stays home and why, and one "Watch:" for what beats you.'}},
  required:['opponent','archetype','examples','threat','bring','plan']};
const agreed={playerAgreed:{type:'boolean',description:'True only when the player has just asked you to delete this team.'}};
// get_team takes a teamId here (the app passes the open team instead).
const shared=chatTools.map(t=>t.name==='get_team'?{...t,parameters:{type:'object',properties:teamId,required:['teamId']}}:t);
const own=[
  {name:'list_teams',description:'The player\'s teams: id, name, format, the six Pokémon and the record from linked replays. Call this first, and call format_rules once per chat before advising on building (Champions doubles: register 6, bring 4; several Mega Stone holders allowed, one Mega Evolution per battle chosen game by game).',parameters:{type:'object',properties:{}}},
  {name:'list_replays',description:'Replays linked to a team: id, date, result, opponent, both previews and the AI summary if there is one.',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'replay_transcript',description:'Turn-by-turn log of one replay. Judge decisions with the information available at that turn.',parameters:{type:'object',properties:{replayId:{type:'string'}},required:['replayId']}},
  {name:'save_team_brief',description:'Save or update a team\'s brief (goal, core, game plan, what was ruled out). It shows in the team\'s Strategy tab and every assistant reads it.',parameters:{type:'object',properties:{...teamId,brief:{type:'object',description:'The team brief you agreed with the player',properties:{goal:{type:'string',description:'Why this team exists, in the player\'s terms'},core:{type:'array',items:{type:'string'},description:'The Pokémon it is built around'},gamePlan:{type:'string',description:'How it wins: modes, leads, win conditions'},ruledOut:{type:'string',description:'What you considered and the player turned down, and why'},playerAgreed:{type:'boolean',description:'True only if the player said yes to this six and plan'}},required:['goal','core','gamePlan','playerAgreed']}},required:['teamId','brief']}},
  {name:'import_team',description:'Create a new team from a Showdown paste (Champions stat points on the "EVs:" line: 0–32 per stat, 66 total). Never changes an existing team. Call it only once the player has agreed on all six (legal under format_rules: species and item clauses; several Mega Stones are fine); put the game plan and the reasoning behind key spreads in notes.',parameters:{type:'object',properties:{name:{type:'string'},paste:{type:'string'},notes:{type:'string',description:'Optional game plan (markdown)'},brief:{type:'object',description:'The team brief you agreed with the player',properties:{goal:{type:'string',description:'Why this team exists, in the player\'s terms'},core:{type:'array',items:{type:'string'},description:'The Pokémon it is built around'},gamePlan:{type:'string',description:'How it wins: modes, leads, win conditions'},ruledOut:{type:'string',description:'What you considered and the player turned down, and why'},playerAgreed:{type:'boolean',description:'True only if the player said yes to this six and plan'}},required:['goal','core','gamePlan','playerAgreed']}},required:['name','paste','brief']}},
  {name:'get_strategy',description:'A team\'s brief, lead plans and matchup plans with their ids, status (proposed or active) and roles. Call this before proposing, editing or removing plans, so you edit what exists instead of adding duplicates.',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'propose_plans',description:'Add lead and matchup plans to a team as proposals the player accepts in the Strategy tab, or EDIT existing ones by sending their id (get_strategy). Every lead needs a role (core / situational / niche / avoid), a when, a title, a lead pair and a back pair; every matchup needs archetype, examples, threat and a bring of four. Calc numbers in the plan text must come from calc_damage / calc_speed. Editing an existing plan keeps its status.',parameters:{type:'object',properties:{...teamId,leads:{type:'array',items:plan},matchups:{type:'array',items:matchup}},required:['teamId']}},
  {name:'remove_plans',description:'Delete lead or matchup plans by id (get_strategy), active or not. The deleted plans come back in the result, so they can be re-added with propose_plans if the player changes their mind.',parameters:{type:'object',properties:{...teamId,leadIds:{type:'array',items:str},matchupIds:{type:'array',items:str}},required:['teamId']}},
  {name:'update_team',description:'Change an existing team\'s six from a full Showdown paste (all six Pokémon, Champions stat points on the "EVs:" line). Matching Pokémon keep their slot; the rest fill the remaining slots. Saved as a new step in the team\'s History (Manage tab), so the previous sets can always be restored. Optionally pass notes to replace the team\'s game-plan text. For changing one Pokémon, update_set is simpler.',parameters:{type:'object',properties:{...teamId,paste:str,summary:{...str,description:'One line: what changed and why'},notes:{...str,description:'Optional new game plan (markdown)'}},required:['teamId','paste','summary']}},
  {name:'update_set',description:'Change one Pokémon on an existing team: moves, item, ability, nature and/or stat points (send only what changes; moves replaces the whole move list: send all four; statPoints keys hp, atk, def, spa, spd, spe, 0–32 each, 66 total). Checked against the format rules; saved as a new step in History so the previous set can be restored. Use calc_damage / calc_speed to justify the change.',parameters:{type:'object',properties:{...teamId,pokemon:{...str,description:'Which Pokémon on the team (species name as in get_team)'},changes:{type:'object',properties:{moves:{type:'array',items:str,minItems:4,maxItems:4},item:str,ability:str,nature:str,statPoints:{type:'object'}}},summary:{...str,description:'One line: what changed and why'}},required:['teamId','pokemon','changes','summary']}},
  {name:'delete_team',description:'Delete a team and its plans (its replays are kept, unlinked). Only when the player explicitly asked to delete it: needs playerAgreed: true and confirmName equal to the team\'s exact name.',parameters:{type:'object',properties:{...teamId,confirmName:str,...agreed},required:['teamId','confirmName','playerAgreed']}},
];
const all=[...own,...shared];
const record=(games:any[])=>{const w=games.filter(g=>g.result==='win').length,l=games.filter(g=>g.result==='loss').length;return games.length?`${w}–${l}`:'no games';};

async function call(name:string,input:any){
  const db=await readStore();
  if(name==='list_teams'){const games=await loadGames();return db.teams.map(t=>({id:t.id,name:t.name,format:t.format,brief:db.coaching?.[t.id]?.brief?.goal??null,pokemon:currentTeam(db,t).sets.map(s=>s.species),record:record(games.filter(g=>db.associations[g.id]?.teamId===t.id))}));}
  if(name==='list_replays'){const games=(await loadGames()).filter(g=>db.associations[g.id]?.teamId===input.teamId);
    return Promise.all(games.map(async g=>{const o=g.ownSide==='p1'?'p2':'p1';const s:any=await readSummary(g.id);return {id:g.id,date:g.date,result:g.result,opponent:g.players[o]?.name,yours:g.preview[g.ownSide],theirs:g.preview[o],summary:s?.summary??null};}));}
  if(name==='replay_transcript'){const g=await readGame(input.replayId);if(!db.associations[g.id])throw new Error('Replay not found');return {transcript:transcript(g)};}
  if(name==='import_team'){const b=input.brief;
    // A team is created only from a plan the player agreed to; the brief keeps that agreement with the team.
    if(!b||b.playerAgreed!==true||!String(b.goal??'').trim()||!String(b.gamePlan??'').trim()||!Array.isArray(b.core)||!b.core.length)throw new Error('Not created: agree the six and the plan with the player first, then send the brief (goal, core, gamePlan, playerAgreed: true).');
    const r=await mutateLatest(d=>{const t:any=applyAction(d,{type:'import',name:String(input.name).slice(0,120),paste:input.paste,notes:input.notes} as any);applyAction(d,{type:'coaching-update',teamId:t.id,brief:{goal:b.goal,core:b.core,gamePlan:b.gamePlan,ruledOut:b.ruledOut??''}});return t;});
    const t:any=r.result;return {created:t.id,name:t.name,note:'New team created with its brief. Open it in Frontier Brain to review.'};}
  if(name==='save_team_brief'){if(!db.teams.some(t=>t.id===input.teamId))throw new Error('Team not found');const b=input.brief??{};
    await mutateLatest(d=>applyAction(d,{type:'coaching-update',teamId:input.teamId,brief:{goal:b.goal??'',core:b.core??[],gamePlan:b.gamePlan??'',ruledOut:b.ruledOut??''}}));return {saved:true};}
  if(name==='get_strategy'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const c:any=db.coaching?.[t.id]??{leads:[],matchups:[]};
    return {team:t.name,brief:c.brief??null,leads:c.leads.map((l:any)=>({id:l.id,title:l.title,lead:l.lead,back:l.back,role:l.role??null,when:l.when,plan:l.plan,status:l.status})),
      matchups:c.matchups.map((m:any)=>({id:m.id,opponent:m.opponent,archetype:m.archetype??null,examples:m.examples??[],threat:m.threat,bring:m.bring,plan:m.plan,status:m.status}))};}
  if(name==='propose_plans'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    const six=currentTeam(db,t).sets.map((s:any)=>s.species);const known=new Set(six.map((x:string)=>x.toLowerCase()));const cur:any=db.coaching?.[t.id]??{leads:[],matchups:[]};
    const id=()=>randomUUID().slice(0,10);const need=(ok:any,msg:string)=>{if(!ok)throw new Error(msg);};
    const inTeam=(list:any,what:string)=>{for(const m of list)need(known.has(String(m).toLowerCase()),`${what}: "${m}" is not on this team (${six.join(', ')}).`);};
    const key=(a:string[])=>[...a].map(x=>x.toLowerCase()).sort().join('+');
    const edited:string[]=[];
    const leads=(input.leads??[]).slice(0,8).map((p:any)=>{
      need(typeof p.title==='string'&&p.title.trim(),'Every lead plan needs a title.');need(Array.isArray(p.lead)&&p.lead.length===2,`${p.title}: lead is exactly two Pokémon.`);need(Array.isArray(p.back)&&p.back.length===2,`${p.title}: back is exactly two Pokémon (lead + back is the bring of four).`);
      need(['core','situational','niche','avoid'].includes(p.role),`${p.title}: role is required: core, situational, niche or avoid.`);need(typeof p.when==='string'&&p.when.trim(),`${p.title}: when is required (one sentence: when to pick this lead).`);need(typeof p.plan==='string'&&p.plan.trim(),`${p.title}: plan text is required.`);
      inTeam([...p.lead,...p.back],p.title);
      const old=p.id?cur.leads.find((x:any)=>x.id===p.id):undefined;if(p.id)need(old,`No lead plan with id ${p.id}; call get_strategy.`);
      if(old){edited.push(old.title);return {...old,title:p.title,lead:p.lead,back:p.back,role:p.role,when:p.when,plan:p.plan};}
      const dup=cur.leads.find((x:any)=>key(x.lead)===key(p.lead));need(!dup,`A plan for ${p.lead.join(' + ')} already exists ("${dup?.title}", id ${dup?.id}). Send it with that id to edit it.`);
      return {id:id(),title:p.title,lead:p.lead,back:p.back,role:p.role,when:p.when,plan:p.plan,calcIds:[],versionIds:[],status:'proposed'};});
    const matchups=(input.matchups??[]).slice(0,12).map((p:any)=>{
      need(typeof p.opponent==='string'&&p.opponent.trim(),'Every matchup plan needs an opponent name.');need(typeof p.archetype==='string'&&p.archetype.trim(),`${p.opponent}: archetype is required.`);
      need(Array.isArray(p.examples)&&p.examples.length>=3,`${p.opponent}: give 3–6 example Pokémon.`);need(['low','medium','high'].includes(p.threat),`${p.opponent}: threat is required: low, medium or high.`);
      need(Array.isArray(p.bring)&&p.bring.length===4,`${p.opponent}: bring is exactly four Pokémon from this team.`);need(typeof p.plan==='string'&&p.plan.trim(),`${p.opponent}: plan text is required.`);inTeam(p.bring,p.opponent);
      const old=p.id?cur.matchups.find((x:any)=>x.id===p.id):undefined;if(p.id)need(old,`No matchup plan with id ${p.id}; call get_strategy.`);
      if(old){edited.push(old.opponent);return {...old,opponent:p.opponent,archetype:p.archetype,examples:p.examples,threat:p.threat,bring:p.bring,plan:p.plan};}
      const dup=cur.matchups.find((x:any)=>String(x.opponent).toLowerCase()===p.opponent.toLowerCase());need(!dup,`A matchup plan "${dup?.opponent}" already exists (id ${dup?.id}). Send it with that id to edit it.`);
      return {id:id(),opponent:p.opponent,archetype:p.archetype,examples:p.examples,threat:p.threat,bring:p.bring,plan:p.plan,calcIds:[],versionIds:[],status:'proposed'};});
    await mutateLatest(d=>applyAction(d,{type:'coaching-update',teamId:input.teamId,upsert:{leads,matchups}}));
    const created=(l:any[])=>l.filter(x=>!cur.leads.concat(cur.matchups).some((y:any)=>y.id===x.id));
    return {proposed:{leads:created(leads).length,matchups:created(matchups).length},edited,ids:{leads:leads.map((l:any)=>({title:l.title,id:l.id})),matchups:matchups.map((m:any)=>({opponent:m.opponent,id:m.id}))},note:'New plans are proposals in the team\'s Strategy tab for the player to accept; edits keep the plan\'s status.'};}
  if(name==='remove_plans'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const cur:any=db.coaching?.[t.id]??{leads:[],matchups:[]};
    const leadIds:string[]=input.leadIds??[],matchupIds:string[]=input.matchupIds??[];
    const hit=[...cur.leads.filter((x:any)=>leadIds.includes(x.id)),...cur.matchups.filter((x:any)=>matchupIds.includes(x.id))];
    if(hit.length!==leadIds.length+matchupIds.length)throw new Error('Some plan ids were not found; call get_strategy.');
    await mutateLatest(d=>applyAction(d,{type:'coaching-update',teamId:input.teamId,remove:{leads:leadIds,matchups:matchupIds}}));return {removed:hit.length,restorable:hit.map((x:any)=>({...x,id:undefined})),note:'These can be re-added with propose_plans if the player wants them back.'};}
  if(name==='update_team'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    const incoming:any[]=importText(String(input.paste??''));if(incoming.length!==6)throw new Error('Send all six Pokémon in the paste.');
    const r=await mutateLatest(d=>{const team=d.teams.find(x=>x.id===input.teamId)!;const view=currentTeam(d,team);const cur=view.sets.map((s:any)=>String(s.species));
      const base=(sp:string)=>sp.toLowerCase().replace(/-mega(-[xyz])?$/,'');const free=new Set(cur.map((_:any,i:number)=>i));const placed:{slot:number;set:any}[]=[];const rest:any[]=[];
      for(const set of incoming){const i=[...free].find(i=>cur[i].toLowerCase()===String(set.species).toLowerCase())??[...free].find(i=>base(cur[i])===base(String(set.species)));if(i===undefined)rest.push(set);else{free.delete(i);placed.push({slot:i,set});}}
      for(const set of rest){const i=[...free][0];free.delete(i);placed.push({slot:i,set});}
      const out=applyAction(d,{type:'team-replace-sets',teamId:team.id,versionId:view.version.id,parentConfigurationId:view.configuration.id,sets:placed.map(p=>({slot:p.slot,set:p.set})),summary:`Updated by your assistant: ${String(input.summary).slice(0,400)}`} as any);
      if(typeof input.notes==='string'&&input.notes.trim())applyAction(d,{type:'version-notes',teamId:team.id,versionId:view.version.id,notes:input.notes} as any);
      return {out,placed:placed.map(p=>`${cur[p.slot]} → ${p.set.species}`).filter(x=>{const [a,b]=x.split(' → ');return a!==b;})};});
    return {updated:true,changed:r.result.placed,note:'Saved as a new step in the team\'s History (Manage tab), so the previous sets can be restored.'};}
  if(name==='update_set'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const ch=input.changes??{};
    if(!Object.keys(ch).length)throw new Error('changes is empty: send moves, item, ability, nature and/or statPoints.');
    const r=await mutateLatest(d=>{const team=d.teams.find(x=>x.id===input.teamId)!;const view=currentTeam(d,team);const want=String(input.pokemon).toLowerCase();
      const slot=view.sets.findIndex((s:any)=>String(s.species).toLowerCase()===want);if(slot<0)throw new Error(`"${input.pokemon}" is not on this team (${view.sets.map((s:any)=>s.species).join(', ')}).`);
      const set:any=structuredClone(view.sets[slot]);
      if(ch.moves!==undefined){if(!Array.isArray(ch.moves)||ch.moves.length!==4)throw new Error('moves is the full list of four move names (keep the ones that stay).');set.moves=ch.moves.map(String);}
      for(const k of ['item','ability','nature'])if(ch[k]!==undefined)set[k]=String(ch[k]);
      if(ch.statPoints!==undefined){if(typeof ch.statPoints!=='object'||Array.isArray(ch.statPoints))throw new Error('statPoints is an object like {"spa":32,"spe":32,"hp":2}.');set.statPoints={...(set.statPoints??{}),...ch.statPoints};}
      applyAction(d,{type:'team-replace-sets',teamId:team.id,versionId:view.version.id,parentConfigurationId:view.configuration.id,sets:[{slot,set}],summary:`Updated by your assistant: ${String(input.summary).slice(0,400)}`} as any);
      return {pokemon:set.species,moves:set.moves,item:set.item,ability:set.ability,nature:set.nature,statPoints:set.statPoints};});
    return {updated:r.result,note:'Saved as a new step in the team\'s History (Manage tab); the previous set can be restored.'};}
  if(name==='delete_team'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    if(input.playerAgreed!==true)throw new Error('Not deleted: the player has to ask for this. Confirm with them, then call again with playerAgreed: true.');
    if(String(input.confirmName??'').trim()!==t.name)throw new Error(`Not deleted: confirmName must equal the team name exactly ("${t.name}").`);
    const r:any=await mutateLatest(d=>applyAction(d,{type:'team-delete',teamId:t.id} as any));return {deleted:t.name,replaysKept:r.result?.unlinked??0,note:'Its replays stay saved, unlinked.'};}
  return runTool(name,input,name==='get_team'?{teamId:input.teamId}:{},db);
}

// How to work with the player: a teambuilding partner, not a team vending machine.
const collaborate=`You are connected to the player's Frontier Brain workspace. Start with get_player_profile (what they've told Frontier Brain about themselves, across every app) and list_teams when their teams matter. Changes to teams are proposals the player accepts in the app.
Work as a collaborator, in short turns, and hand choices back to the player:
- When they name Pokémon to try or build around, first find out what makes each one distinctive: call pokemon_profile (and team_pool_sets if the pool has it). Say what is genuinely unusual — the Mega's typing, stats and ability, rare support or speed-control moves, which popular threats it hits or walls, how it fares under Trick Room — and what is awkward about it. A low pool share is a feature (opponents won't have a plan for it); say so.
- Then offer two or three distinct directions built around their picks (core, game plan, main risk) and ask which they like. Ask about their preferences (playstyle, Bo1 or Bo3, what they hate facing) if you don't know them.
- Build up from the core one or two slots at a time. Explain every pick by the job it does for this core: which threat it answers and why it beats the alternatives. Don't reach for meta staples (Incineroar, Rillaboom, Sneasler…) by reflex; when one fits, say why it fits this team specifically and name a less obvious option.
- Respect the format (format_rules): plan the fours you'd bring into common teams, and treat multiple Mega options as modes picked at team preview, not a mistake.
- When current events, team reports or what top players are doing matter, call where_to_look and open those pages directly (results, reports, teams); for fundamentals, vgc_playbook first, then the articles it links.
- Test the plan with numbers before settling it: key calcs (calc_damage) and speed tiers (calc_speed) against labelled standard_set opponents, and spread_search for the spreads.
- Only call import_team once the player has agreed on all six, with the brief you agreed (goal, core, game plan, what was ruled out). Afterwards offer lead and matchup plans (propose_plans).
- When the player tells you a lasting preference (playstyle, Bo1/Bo3, Pokémon they love or hate facing), save it with update_player_profile so no app asks again.
- Lead and matchup plans follow one standard so every team reads the same: each lead has a title, a role (core / situational / niche / avoid; never blank), a one-sentence "when", the lead pair and back pair, and a short plan: "**T1:** …", "**T2:** …" with the calc numbers that justify it and one "**Watch:**" line. "Avoid" leads are one or two sentences naming what to lead instead. Each matchup has an archetype, 3–6 example Pokémon, a threat level, the four you bring (and who stays home, with the reason), and 2–4 sentences with exact numbers.
- Before proposing, call get_strategy and edit what exists (send its id) rather than adding a near-duplicate. You can change one Pokémon with update_set (moves, item, ability, nature, stat points) or the whole six with update_team, and edit or remove lead and matchup plans with propose_plans / remove_plans. Those are reversible (set and team changes are kept in History; removed plans are returned), so make them when the player asks. Only delete_team is final: do it only when the player explicitly asks, and pass the exact team name.
- End a turn with a question whenever the next choice is theirs.`;
const prompts=[
  {name:'build_around',description:'Build a team together around Pokémon you want to use',arguments:[{name:'pokemon',description:'The Pokémon to build around, e.g. "Mega Chimecho, Trevenant, Kommo-o"',required:true},{name:'style',description:'Optional: playstyle or anything you already know you want',required:false}],
    text:(a:any)=>`I want to build a Champions Regulation M-C doubles team around ${a.pokemon}.${a.style?` ${a.style}.`:''} Before building anything, check what you know about me (get_player_profile) and the format (format_rules), profile each of them with pokemon_profile and tell me what makes them interesting in this meta and what's awkward, then pitch two or three directions and ask me which to take.`},
  {name:'review_games',description:'Go through your recent games on a team and find what to work on',arguments:[{name:'team',description:'Team name (optional; asks if you have several)',required:false}],
    text:(a:any)=>`Review my recent games${a.team?` on ${a.team}`:''}. Use list_teams, list_replays and replay_transcript; judge decisions with what I knew at each turn, show sample sizes, and end with two or three concrete things to practise.`},
  {name:'tune_spread',description:'Tune one Pokémon\'s spread against real benchmarks',arguments:[{name:'pokemon',description:'Which Pokémon (and team, if several)',required:true}],
    text:(a:any)=>`Help me tune the spread on my ${a.pokemon}. Read the set with get_team, ask me which hits it must survive and which KOs or speed tiers it needs, then use spread_search, calc_damage and calc_speed against labelled standard sets.`},
];
function server(prefs:string){
  // Clients that show connector icons read them from the server info (MCP 2025-11-25); some fall back to /favicon.ico.
  const SITE='https://frontierbrain.vercel.app';
  const info={name:'frontier-brain',title:'Frontier Brain',version:'1.0.0',websiteUrl:SITE,icons:[{src:`${SITE}/brand/icon-512.png`,mimeType:'image/png',sizes:['512x512']},{src:`${SITE}/brand/icon-192.png`,mimeType:'image/png',sizes:['192x192']}]};
  const s=new Server(info,{capabilities:{tools:{},prompts:{}},instructions:`${chatInstructions}\n${collaborate}\n${prefs}`});
  s.setRequestHandler(ListPromptsRequestSchema,async()=>({prompts:prompts.map(({text,...p})=>p)}));
  s.setRequestHandler(GetPromptRequestSchema,async req=>{const p=prompts.find(x=>x.name===req.params.name);if(!p)throw new Error(`Unknown prompt ${req.params.name}`);
    return {description:p.description,messages:[{role:'user',content:{type:'text',text:p.text(req.params.arguments??{})}}]};});
  s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:all.map(t=>({name:t.name,description:t.description,inputSchema:t.parameters as any}))}));
  s.setRequestHandler(CallToolRequestSchema,async req=>{
    if(!all.some(t=>t.name===req.params.name))return {isError:true,content:[{type:'text',text:`Unknown tool ${req.params.name}`}]};
    try{const out=await call(req.params.name,req.params.arguments??{});return {content:[{type:'text',text:JSON.stringify(out)}]};}
    catch(e){return {isError:true,content:[{type:'text',text:(e as Error).message}]};}
  });
  return s;
}
export async function handleMcp(req:IncomingMessage,res:ServerResponse,body?:unknown){
  if(req.method!=='POST'){res.writeHead(405,{Allow:'POST','Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message:'Method not allowed'},id:null}));return;}
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});const s=server(preferencesText(await readPreferences()));
  res.on('close',()=>{void transport.close();void s.close();});
  await s.connect(transport);await transport.handleRequest(req,res,body);
}
