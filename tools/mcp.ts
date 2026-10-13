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
import {importText,exportText} from './teams.ts';
import {validateProposals,validateTeamProposal} from './assist.ts';
import {FORMATS} from '../shared/formats.ts';
import {benchmarkLabel} from '../shared/benchmarks.ts';
import {setStrategyText,checkPokemonStrategy,composePokemonStrategy,TEAM_STYLES,matchTeamStyle} from '../shared/workbench.ts';
import {deleteReplays} from './replays.ts';
import {removeFile,config} from './io.ts';
import {loadGames} from './replays.ts';
import {transcript,readGame,readSummary,isStale,saveReplaySummary,saveTeamDigest,queueSummaries,STYLES} from './replay-summary.ts';
import {readPreferences,preferencesText} from './player.ts';
import {intakeReplays,removeReplay} from './replay-intake.ts';
import {showdownReplayId} from './replay-links.ts';
import {createPokepaste} from './pokepaste.ts';
import {activeAI,config as profile} from './io.ts';
import {focusTools,focusCall,focusInstructions} from './focus.ts';
import {benchTools,benchNames,benchCall,benchGuidance} from './mcp-bench.ts';
import {inboxTools,inboxNames,inboxCall} from './inbox.ts'; // get_inbox (read-only)
import {backupTools,backupNames,backupCall,originOf} from './mcp-backup.ts';
import {requestOrigin} from './backup-link.ts';

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
  archetype:{...str,description:`REQUIRED. Exactly one team style: ${TEAM_STYLES.join(', ')}. Near-misses (TR, tailwind, Rain team) are mapped and reported; anything else is refused. Put specifics in the plan text.`},
  examples:{type:'array',items:str,minItems:3,maxItems:6,description:'REQUIRED. 3–6 Pokémon that mark this matchup (species names)'},
  threat:{...str,enum:['low','medium','high'],description:'REQUIRED. How dangerous it is for this team (from pool share and the calcs)'},
  bring:mons('The four you bring (species from this team). The two you leave home are part of the plan.',4),
  plan:{...str,description:'Markdown, 2–4 sentences: what to lead and why, the key numbers (calc results, speed tiers), who stays home and why, and one "Watch:" for what beats you.'}},
  required:['opponent','archetype','examples','threat','bring','plan']};
const applyFlag={apply:{type:'boolean',description:'Default false: the change is sent to the player as a suggestion they accept in Frontier Brain (like the in-app chat). Set true only when the player has asked you to just apply it.'}};
const agreed={playerAgreed:{type:'boolean',description:'True only when the player has just asked you to delete this team.'}};
// get_team takes a teamId here (the app passes the open team instead).
const shared=chatTools.map(t=>t.name==='get_team'?{...t,parameters:{type:'object',properties:teamId,required:['teamId']}}:t);
const own=[
  {name:'list_teams',description:'The player\'s teams: id, name, format, the six Pokémon and the record from linked replays. Call this first, and call format_rules once per chat before advising on building (Champions doubles: register 6, bring 4; several Mega Stone holders allowed, one Mega Evolution per battle chosen game by game).',parameters:{type:'object',properties:{}}},
  {name:'list_replays',description:'Replays linked to a team: id, date, result, opponent, both previews, and the saved summary if there is one. needsSummary is true for games with no summary (or whose team link changed since): these are waiting for you. Summarise them with replay_transcript then save_replay_summary.',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'save_replay_summary',description:'Save your summary of ONE replay so it appears on that game in Frontier Brain (and feeds the team\'s "what to work on"). Read replay_transcript first and judge each decision only with the information available at that turn. Never state an opponent\'s unrevealed item, spread or move as fact. Separate play mistakes (play), team-building weaknesses (building) and luck such as crits, misses or speed ties (variance). Cite turn numbers that exist in the game.',parameters:{type:'object',properties:{replayId:str,summary:{...str,description:'1–2 sentences: how the game was won or lost'},keyMoments:{type:'array',description:'2–4 turning points',items:{type:'object',properties:{turn:{type:'integer'},text:str},required:['turn','text']}},workOn:{type:'array',description:'1–3 things to work on, most important first (a clean win may have one \'keep doing\' line)',items:{type:'object',properties:{title:{...str,description:'Short imperative'},detail:{...str,description:'One or two sentences'},category:{type:'string',enum:['play','building','variance']},turn:{type:'integer'}},required:['title','detail','category']}},opponentStyle:{type:'array',description:'How the opponent\'s team plays, from the shared styles',items:{type:'string',enum:[...STYLES]}},confidence:{type:'string',enum:['high','medium','low']}},required:['replayId','summary','keyMoments','workOn']}},
  {name:'save_team_digest',description:'Save the team\'s "what to work on" digest: 2–5 themes that recur across its summarised games (needs at least two saved summaries). Each theme lists the replay ids it comes from; Frontier Brain recomputes the counts. Word it as patterns to test, not verdicts: it is a small sample.',parameters:{type:'object',properties:{...teamId,themes:{type:'array',items:{type:'object',properties:{title:{...str,description:'Short imperative'},detail:{...str,description:'Two sentences: what keeps happening, and what to try'},games:{type:'array',items:str,description:'Replay ids from list_replays'},of:{type:'string',enum:['losses','games']}},required:['title','detail','games']}},strengths:{type:'array',items:str,description:'0–2 things going well'}},required:['teamId','themes']}},
  {name:'replay_transcript',description:'Turn-by-turn log of one replay. Judge decisions with the information available at that turn.',parameters:{type:'object',properties:{replayId:{type:'string'}},required:['replayId']}},
  {name:'import_team',description:'Create a NEW team from a Showdown paste (Champions stat points on the "EVs:" line: 0–32 per stat, 66 total). It only ever creates a new team; nothing existing changes, so no confirmation is needed once the six is settled (legal under format_rules: species and item clauses; several Mega Stones are fine). Put the agreed plan in `notes`: why the team exists, what it is built around, how it wins, what was ruled out. It becomes the team\'s Strategy write-up, which is where the player reads it, and the reasoning behind key spreads goes in setNotes.',parameters:{type:'object',properties:{name:str,paste:str,notes:{...str,description:'The Strategy write-up (markdown): goal, what it is built around, game plan, what was ruled out'},setNotes:{type:'object',description:'Optional Strategy for each Pokémon, keyed by species: {"Mawile":{"role":"one line","howToPlay":"…","watchOut":"…"}}. They become its "Role / How to play / Watch out for" write-up.'}},required:['name','paste']}},
  {name:'rename_team',description:'Rename a team.',parameters:{type:'object',properties:{...teamId,name:str},required:['teamId','name']}},
  {name:'set_team_format',description:'Change the format a team is checked against.',parameters:{type:'object',properties:{...teamId,format:{...str,enum:FORMATS.map(f=>f.id),description:FORMATS.map(f=>`${f.id}: ${f.label}`).join('; ')}},required:['teamId','format']}},
  {name:'duplicate_team',description:'Copy a team (its six and game-plan text) as a new team, e.g. to try a variation without touching the original.',parameters:{type:'object',properties:{...teamId,name:{...str,description:'Optional; defaults to "<name> (copy)"'}},required:['teamId']}},
  {name:'export_team',description:'The team as a Showdown paste (all six sets).',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'replace_pokemon',description:'Swap one Pokémon on a team for a different species. Send a Showdown paste of the one replacement Pokémon (Champions stat points on the "EVs:" line). A team is always six, so there is no empty slot or removal: replace instead. By default a suggestion for the player to accept in the app; apply: true saves it now as a new step in History.',parameters:{type:'object',properties:{...teamId,pokemon:{...str,description:'The Pokémon being replaced'},paste:{...str,description:'Showdown paste of the one replacement'},summary:{...str,description:'One line: why'},strategy:{...str,description:'Optional Strategy write-up for the new Pokémon: three sections "## Role" (one line), "## How to play", "## Watch out for"'},...applyFlag},required:['teamId','pokemon','paste','summary']}},
  {name:'star_set',description:'Save one Pokémon\'s current set to the player\'s My sets (shown first when picking that species). unstar_set removes it.',parameters:{type:'object',properties:{...teamId,pokemon:str,label:{...str,description:'Optional name for the saved set'},unstar:{type:'boolean',description:'True to remove it from My sets'}},required:['teamId','pokemon']}},
  {name:'get_strategy',description:'A team\'s lead plans and matchup plans with their ids, status (proposed or active) and roles. Call this before proposing, editing or removing plans, so you edit what exists instead of adding duplicates.',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'propose_plans',description:'Add lead and matchup plans to a team as proposals the player accepts in the Strategy tab, or EDIT existing ones by sending their id (get_strategy). Every lead needs a role (core / situational / niche / avoid), a when, a title, a lead pair and a back pair; every matchup needs archetype, examples, threat and a bring of four. Calc numbers in the plan text must come from calc_damage / calc_speed. Editing an existing plan keeps its status.',parameters:{type:'object',properties:{...teamId,leads:{type:'array',items:plan},matchups:{type:'array',items:matchup}},required:['teamId']}},
  {name:'remove_plans',description:'Delete lead or matchup plans by id (get_strategy), active or not. The deleted plans come back in the result, so they can be re-added with propose_plans if the player changes their mind.',parameters:{type:'object',properties:{...teamId,leadIds:{type:'array',items:str},matchupIds:{type:'array',items:str}},required:['teamId']}},
  {name:'update_team',description:'Change an existing team\'s six from a full Showdown paste (all six Pokémon, Champions stat points on the "EVs:" line). Matching Pokémon keep their slot; the rest fill the remaining slots. By default this is a suggestion the player accepts in Frontier Brain (like the in-app chat; it becomes a new version they activate); with apply: true it is saved straight away as a new step in History. Optionally pass notes for the game-plan text. For changing one Pokémon, update_set is simpler. Show the player the `message` you get back.',parameters:{type:'object',properties:{...teamId,paste:str,summary:{...str,description:'One line: what changed and why'},notes:{...str,description:'Optional new game plan (markdown)'},...applyFlag},required:['teamId','paste','summary']}},
  {name:'update_strategy',description:'Set the team\'s strategy write-up (the game plan text on its Strategy tab): a short introduction, not a manual. Start with "## Game plan" (two short paragraphs or up to five bullets), then at most two short sections such as "## Bring rules" or "## Watch out for". Name Pokémon exactly. By default it is a suggestion the player accepts in the app; apply: true saves it now.',parameters:{type:'object',properties:{...teamId,text:str,...applyFlag},required:['teamId','text']}},
  {name:'update_set',description:'Change one Pokémon on an existing team: moves, item, ability, nature, stat points and/or its Strategy write-up (send only what changes; moves replaces the whole move list: send all four; statPoints keys hp, atk, def, spa, spd, spe, 0–32 each, 66 total). Checked against the format rules. By default it is sent to the player as a suggestion (with the before → after and your reason) to accept in Frontier Brain, like the in-app chat; with apply: true it is saved straight away as a new step in History. Use calc_damage / calc_speed to justify the change, and show the player the `message` you get back.',parameters:{type:'object',properties:{...teamId,pokemon:{...str,description:'Which Pokémon on the team (species name as in get_team)'},changes:{type:'object',properties:{moves:{type:'array',items:str,minItems:4,maxItems:4},item:str,ability:str,nature:str,statPoints:{type:'object'},strategy:{...str,description:'The Pokémon\'s whole Strategy write-up, always three sections: "## Role" (one line), "## How to play", "## Watch out for", each a sentence or two. It replaces the current one (get_team shows it as strategy), so keep what should stay.'}}},summary:{...str,description:'One line: what changed and why (shown to the player)'},...applyFlag},required:['teamId','pokemon','changes','summary']}},
  {name:'save_benchmark',description:'Save a calc as a benchmark on one of the team\'s Pokémon, so it shows on that Pokémon\'s page and in its history. Send the same input you would give calc_damage, calc_speed or spread_search; Frontier Brain re-runs it and stores input and result. Save the calcs a set is built around (what it must survive, what it must KO or outspeed), with a title and a one-line context. Multi-Pokémon calcs are saved as their independent claims, never as one composite: from a four-way order (calc_speed_order) save one speed benchmark per pair ({a, b, trickRoom}; cross-side pairs involving this Pokémon), and for a spread move into two targets (secondDefender) save one damage benchmark per target. Two attackers into one target (secondMove) is one combined benchmark. A benchmark has no title: its headline (role, opponent, move and the conditions) is generated from the calc; context is an optional one-line note shown small beside it.',parameters:{type:'object',properties:{...teamId,pokemon:{...str,description:'The team Pokémon this benchmark belongs to'},kind:{...str,enum:['damage','speed','spread']},input:{type:'object',description:'The calc input exactly as for calc_damage (attacker, defender, move, field, moveOptions), calc_speed, or spread_search'},context:{...str,description:'Optional one-liner: why this benchmark matters'},sources:{type:'array',items:str,description:'Optional http(s) links for the opposing set'}},required:['teamId','pokemon','kind','input']}},
  {name:'list_benchmarks',description:'The benchmarks saved on a team\'s Pokémon (id, role, opponent, detail, kind, headline result), optionally for one Pokémon.',parameters:{type:'object',properties:{...teamId,pokemon:str},required:['teamId']}},
  {name:'delete_benchmark',description:'Delete a saved benchmark by id (list_benchmarks). Its input comes back in the result, so it can be saved again.',parameters:{type:'object',properties:{benchmarkId:str},required:['benchmarkId']}},
  {name:'delete_team',description:'Delete a team, its plans and its replays with their analysis. Only when the player explicitly asked to delete it: needs playerAgreed: true and confirmName equal to the team\'s exact name.',parameters:{type:'object',properties:{...teamId,confirmName:str,...agreed},required:['teamId','confirmName','playerAgreed']}},
  {name:'add_replays',description:'Add replays to Frontier Brain on the player\'s request: public Showdown replay links (replay.pokemonshowdown.com only; fetched and stored as data) and/or pasted replay HTML. Each is parsed, stored once (duplicates are recognised) and linked to the team whose six it matches, at the edit current when it was played; pass teamId to limit the search to one team. An automatic "exact" link means the sets are consistent with the game, not that the player confirmed their spreads. A replay that matches no team is kept unlinked (inbox). Needs the player\'s Showdown name in Settings. New games are summarised in the app when an AI key is set; otherwise they wait for you (list_replays needsSummary, then replay_transcript and save_replay_summary). Only add replays the player gave you.',parameters:{type:'object',properties:{links:{type:'array',items:str,maxItems:40,description:'https://replay.pokemonshowdown.com/… links the player gave you'},html:{type:'array',items:str,maxItems:10,description:'Replay HTML the player pasted (Showdown\'s Download button), under 6 MB each'},teamId:{...str,description:'Optional: link to this team (list_teams) when the six matches'}}}},
  {name:'delete_replay',description:'Permanently delete ONE replay: its link to the team, the stored original, the parsed copy and its summary; the team\'s debrief is kept for the games that remain, with a note that it now covers fewer games. Cannot be undone. Only when the player explicitly asked to delete this replay: needs playerAgreed: true and its exact id from list_replays.',parameters:{type:'object',properties:{replayId:{...str,description:'Replay id from list_replays'},playerAgreed:{type:'boolean',description:'True only when the player has just asked you to delete this replay.'}},required:['replayId','playerAgreed']}},
  {name:'create_pokepaste',description:'PUBLISHES the team\'s six to pokepast.es, a public paste site: anyone with the link can read it and it cannot be taken back from here. Only when the player explicitly asked to publish this team: needs playerAgreed: true. Returns the paste URL. The author defaults to the player\'s Showdown name, as the app\'s PokePaste button does; pass author to use something else (an empty string posts none).',parameters:{type:'object',properties:{...teamId,author:{...str,description:'Optional name shown on the paste (max 60 characters)'},notes:{...str,description:'Optional note shown on the paste (max 1000 characters)'},playerAgreed:{type:'boolean',description:'True only when the player has just asked you to publish this team publicly to pokepast.es.'}},required:['teamId','playerAgreed']}},
  {name:'backup_info',description:'What a Frontier Brain backup would hold (counts) and where to make or restore one. A backup is one file with every replay\'s full log, which does not fit in a chat tool result, so it never travels through a tool result. export_backup makes one and returns a short-lived download link for the player to open; restoring is only in the app: Settings (avatar in the header) → Backup → Restore. Restoring merges and never overwrites.',parameters:{type:'object',properties:{}}},
];
const all=[...own,...benchTools,...shared,...backupTools];
all.push(...focusTools as any[]); // get_focus (tools/focus.ts)
all.push(...inboxTools as any[]); // get_inbox (tools/inbox.ts)
// "What's changing": the same before → after the app's suggestion tiles show, as markdown for the chat.
const changeLines=(before:any,after:any):string[]=>{const L:string[]=[];
  if(String(before.species)!==String(after.species))L.push(`**Pokémon:** ${before.species} → ${after.species}`);
  const f=(k:string,l:string)=>{if((before[k]??'')!==(after[k]??''))L.push(`**${l}:** ${before[k]||'—'} → ${after[k]||'—'}`);};
  f('item','Item');f('ability','Ability');f('nature','Nature');
  const mb:string[]=before.moves??[],ma:string[]=after.moves??[];const out=mb.filter(m=>!ma.includes(m)),inn=ma.filter(m=>!mb.includes(m));
  if(out.length||inn.length)L.push(`**Moves:** ${out.join(', ')||'—'} → ${inn.join(', ')||'—'}`);
  const sp=['hp','atk','def','spa','spd','spe'].filter(k=>(before.statPoints?.[k]??0)!==(after.statPoints?.[k]??0)).map(k=>`${k.toUpperCase()} ${before.statPoints?.[k]??0} → ${after.statPoints?.[k]??0}`);
  if(sp.length)L.push(`**Stat points:** ${sp.join(', ')}`);
  return L.length?L:['No change from the current set.'];};
const where='Open this team in Frontier Brain and Ask Frontier Brain shows it as a suggestion to Accept or Reject.';
const record=(games:any[])=>{const w=games.filter(g=>g.result==='win').length,l=games.filter(g=>g.result==='loss').length;return games.length?`${w}–${l}`:'no games';};

async function call(name:string,input:any){
  const db=await readStore();
  if(name==='list_teams'){const games=await loadGames();return db.teams.map(t=>({id:t.id,name:t.name,format:t.format,pokemon:currentTeam(db,t).sets.map(s=>s.species),record:record(games.filter(g=>db.associations[g.id]?.teamId===t.id))}));}
  if(name==='list_replays'){const games=(await loadGames()).filter(g=>db.associations[g.id]?.teamId===input.teamId);
    return Promise.all(games.map(async g=>{const o=g.ownSide==='p1'?'p2':'p1';const s:any=await readSummary(g.id);const stale=!!s&&isStale(s,db.associations[g.id]);return {id:g.id,date:g.date,result:g.result,opponent:g.players[o]?.name,yours:g.preview[g.ownSide],theirs:g.preview[o],summary:s?.summary??null,...s?{workOn:s.workOn.map((w:any)=>w.title),summarisedBy:s.model,...s.edited?{editedByPlayer:true}:{}}:{},needsSummary:!s||stale};}));}
  if(name==='save_replay_summary'){const id=String(input.replayId??'');if(!db.associations[id])throw new Error('Replay not found: use an id from list_replays.');
    const {replayId,...value}=input;const s=await saveReplaySummary(id,value);
    let waiting=0;for(const g of await loadGames())if(db.associations[g.id]?.teamId===db.associations[id].teamId&&g.id!==id&&!(await readSummary(g.id)))waiting++;
    return {saved:true,replayId:id,summary:s.summary,stillWaiting:waiting,note:waiting?`Saved. ${waiting} more game${waiting===1?' is':'s are'} waiting: carry on with list_replays.`:'Saved. Every replay for this team now has a summary: call save_team_digest.'};}
  if(name==='save_team_digest'){if(!db.teams.some(t=>t.id===input.teamId))throw new Error('Team not found');const d=await saveTeamDigest(input.teamId,input);
    return {saved:true,games:d.games,themes:d.themes.map(t=>`${t.title} (${t.count} of ${t.total} ${t.of})`),note:'Saved. It appears under "What to work on" on the team\'s Replays tab.'};}
  if(name==='replay_transcript'){const g=await readGame(input.replayId);if(!db.associations[g.id])throw new Error('Replay not found');return {transcript:transcript(g)};}
  if(name==='import_team'){
    if(typeof input.name!=='string'||!input.name.trim())throw new Error('name is required');
    const r=await mutateLatest(d=>{const t:any=applyAction(d,{type:'import',name:String(input.name).slice(0,120),paste:input.paste,notes:input.notes,setNotes:input.setNotes&&typeof input.setNotes==='object'?Object.fromEntries(Object.entries(input.setNotes as any).map(([sp,v]:any)=>[sp,{role:composePokemonStrategy({role:String(v?.role??'').slice(0,500),howToPlay:String(v?.howToPlay??v?.notes??'').slice(0,3000),watchOut:String(v?.watchOut??'').slice(0,1500)}),benchmarks:''}])):undefined} as any);
      return t;});
    const t:any=r.result;return {created:t.id,name:t.name,note:'New team created. Open it in Frontier Brain to review; nothing existing was changed.'};}
  if(name==='rename_team'){await mutateLatest(d=>applyAction(d,{type:'team-rename',teamId:input.teamId,name:input.name} as any));return {renamed:String(input.name).trim()};}
  if(name==='set_team_format'){await mutateLatest(d=>applyAction(d,{type:'team-format',teamId:input.teamId,format:input.format} as any));return {format:input.format};}
  if(name==='export_team'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');return {name:t.name,paste:exportText(currentTeam(db,t).sets as any,t.format,{validate:false}),legal:!currentTeam(db,t).errors.length};}
  if(name==='duplicate_team'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const view=currentTeam(db,t);
    const r=await mutateLatest(d=>applyAction(d,{type:'import',name:String(input.name||`${t.name} (copy)`).slice(0,120),paste:exportText(view.sets as any,t.format,{validate:false}),format:t.format,notes:view.version.notes??'',benchFrom:t.id} as any));
    const n:any=r.result;return {created:n.id,name:n.name,note:'A copy of the six, the game-plan text and the bench. Plans and replays stay with the original.'};}
  if(name==='replace_pokemon'||name==='star_set'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const view=currentTeam(db,t);
    const slot=view.sets.findIndex((s:any)=>String(s.species).toLowerCase()===String(input.pokemon).toLowerCase());if(slot<0)throw offTeam(db,t,input.pokemon,view.sets);
    if(name==='star_set'){const r:any=await mutateLatest(d=>applyAction(d,{type:input.unstar?'set-unstar':'set-star',teamId:t.id,slot,label:input.label} as any));return {pokemon:view.sets[slot].species,starred:!input.unstar,label:r.result?.starred?.label??null};}
    const one:any[]=importText(String(input.paste??''));if(one.length!==1)throw new Error('Send exactly one Pokémon in the paste.');
    const lines=changeLines(view.sets[slot],one[0]);
    const rStrategy=typeof input.strategy==='string'&&input.strategy.trim()?input.strategy.trim().slice(0,6000):undefined;
    if(rStrategy){const bad=checkPokemonStrategy(rStrategy);if(bad)throw new Error(bad);}
    if(input.apply!==true){const proposal:any=validateProposals('assist',{reply:'',proposals:[{kind:'set',slot,set:one[0],why:String(input.summary),...rStrategy?{strategy:rStrategy}:{}}]},view.sets as any,slot,'overview').proposals[0];
      await mutateLatest(d=>applyAction(d,{type:'pending-add',teamId:t.id,summary:`${view.sets[slot].species} → ${one[0].species}`,proposal} as any));
      return {proposed:true,pokemon:view.sets[slot].species,changes:lines,message:`**Suggested: replace ${view.sets[slot].species} with ${one[0].species}**\n${lines.map(l=>`- ${l}`).join('\n')}\n\n_${input.summary}_\n\n${where}`};}
    await mutateLatest(d=>{const team=d.teams.find(x=>x.id===t.id)!;const v=currentTeam(d,team);applyAction(d,{type:'team-replace-sets',teamId:team.id,versionId:v.version.id,parentConfigurationId:v.configuration.id,sets:[{slot,set:one[0],...rStrategy?{notes:{role:rStrategy,benchmarks:''}}:{}}],summary:`Updated by your assistant: ${String(input.summary).slice(0,400)}`} as any);});
    return {replaced:`${view.sets[slot].species} → ${one[0].species}`,changes:lines,note:'Saved as a new step in the team\'s History (Manage tab).'};}
  if(name==='get_strategy'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const c:any=db.coaching?.[t.id]??{leads:[],matchups:[]};
    return {team:t.name,strategy:currentTeam(db,t).version.notes,leads:c.leads.map((l:any)=>({id:l.id,title:l.title,lead:l.lead,back:l.back,role:l.role??null,when:l.when,plan:l.plan,status:l.status})),
      matchups:c.matchups.map((m:any)=>({id:m.id,opponent:m.opponent,archetype:m.archetype??null,examples:m.examples??[],threat:m.threat,bring:m.bring,plan:m.plan,status:m.status}))};}
  if(name==='propose_plans'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    const six=currentTeam(db,t).sets.map((s:any)=>s.species);const known=new Set(six.map((x:string)=>x.toLowerCase()));const cur:any=db.coaching?.[t.id]??{leads:[],matchups:[]};
    const id=()=>randomUUID().slice(0,10);const need=(ok:any,msg:string)=>{if(!ok)throw new Error(msg);};
    const inTeam=(list:any,what:string)=>{for(const m of list)need(known.has(String(m).toLowerCase()),`${what}: "${m}" is not on this team (${six.join(', ')}).`);};
    const key=(a:string[])=>[...a].map(x=>x.toLowerCase()).sort().join('+');
    const edited:string[]=[],mapped:{opponent:string;from:string;to:string}[]=[];
    // archetype is the shared team-style vocabulary (replay tags and filters read it): near-misses map, the rest is refused.
    const style=(p:any)=>{const m=matchTeamStyle(p.archetype);need(m,`${p.opponent}: archetype "${String(p.archetype).slice(0,60)}" is not a team style. Use exactly one of: ${TEAM_STYLES.join(', ')}. Put anything more specific in the plan text.`);
      if(m!.mapped&&m!.style!==p.archetype)mapped.push({opponent:p.opponent,from:String(p.archetype),to:m!.style});return m!.style;};
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
      if(old){edited.push(old.opponent);return {...old,opponent:p.opponent,archetype:style(p),examples:p.examples,threat:p.threat,bring:p.bring,plan:p.plan};}
      const dup=cur.matchups.find((x:any)=>String(x.opponent).toLowerCase()===p.opponent.toLowerCase());need(!dup,`A matchup plan "${dup?.opponent}" already exists (id ${dup?.id}). Send it with that id to edit it.`);
      return {id:id(),opponent:p.opponent,archetype:style(p),examples:p.examples,threat:p.threat,bring:p.bring,plan:p.plan,calcIds:[],versionIds:[],status:'proposed'};});
    await mutateLatest(d=>applyAction(d,{type:'coaching-update',teamId:input.teamId,upsert:{leads,matchups}}));
    const created=(l:any[])=>l.filter(x=>!cur.leads.concat(cur.matchups).some((y:any)=>y.id===x.id));
    return {proposed:{leads:created(leads).length,matchups:created(matchups).length},edited,...mapped.length?{archetypesMapped:mapped}:{},ids:{leads:leads.map((l:any)=>({title:l.title,id:l.id})),matchups:matchups.map((m:any)=>({opponent:m.opponent,id:m.id}))},note:'New plans are proposals in the team\'s Strategy tab for the player to accept; edits keep the plan\'s status.'};}
  if(name==='remove_plans'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const cur:any=db.coaching?.[t.id]??{leads:[],matchups:[]};
    const leadIds:string[]=input.leadIds??[],matchupIds:string[]=input.matchupIds??[];
    const hit=[...cur.leads.filter((x:any)=>leadIds.includes(x.id)),...cur.matchups.filter((x:any)=>matchupIds.includes(x.id))];
    if(hit.length!==leadIds.length+matchupIds.length)throw new Error('Some plan ids were not found; call get_strategy.');
    await mutateLatest(d=>applyAction(d,{type:'coaching-update',teamId:input.teamId,remove:{leads:leadIds,matchups:matchupIds}}));return {removed:hit.length,restorable:hit.map((x:any)=>({...x,id:undefined})),note:'These can be re-added with propose_plans if the player wants them back.'};}
  if(name==='update_team'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    const incoming:any[]=importText(String(input.paste??''));if(incoming.length!==6)throw new Error('Send all six Pokémon in the paste.');
    const now=currentTeam(db,t).sets.map((x:any)=>x.species);const nextSp=incoming.map(x=>x.species);
    const lines=[...nextSp.filter(x=>!now.includes(x)).map(x=>`**In:** ${x}`),...now.filter((x:string)=>!nextSp.includes(x)).map((x:string)=>`**Out:** ${x}`)];
    if(input.apply!==true){const proposal:any=validateTeamProposal({name:t.name,paste:input.paste,strategy:String(input.notes??'')});
      await mutateLatest(d=>applyAction(d,{type:'pending-add',teamId:t.id,summary:`New six: ${String(input.summary).slice(0,120)}`,proposal} as any));
      const shown=lines.length?lines:['Same six; sets differ.'];
      return {proposed:true,changes:shown,message:`**Suggested team change for ${t.name}**\n${shown.map(l=>`- ${l}`).join('\n')}\n\n_${input.summary}_\n\n${where}`};}
    const r=await mutateLatest(d=>{const team=d.teams.find(x=>x.id===input.teamId)!;const view=currentTeam(d,team);const cur=view.sets.map((s:any)=>String(s.species));
      const base=(sp:string)=>sp.toLowerCase().replace(/-mega(-[xyz])?$/,'');const free=new Set(cur.map((_:any,i:number)=>i));const placed:{slot:number;set:any}[]=[];const rest:any[]=[];
      for(const set of incoming){const i=[...free].find(i=>cur[i].toLowerCase()===String(set.species).toLowerCase())??[...free].find(i=>base(cur[i])===base(String(set.species)));if(i===undefined)rest.push(set);else{free.delete(i);placed.push({slot:i,set});}}
      for(const set of rest){const i=[...free][0];free.delete(i);placed.push({slot:i,set});}
      const out=applyAction(d,{type:'team-replace-sets',teamId:team.id,versionId:view.version.id,parentConfigurationId:view.configuration.id,sets:placed.map(p=>({slot:p.slot,set:p.set})),summary:`Updated by your assistant: ${String(input.summary).slice(0,400)}`} as any);
      if(typeof input.notes==='string'&&input.notes.trim())applyAction(d,{type:'version-notes',teamId:team.id,versionId:view.version.id,notes:input.notes} as any);
      return {out,placed:placed.map(p=>`${cur[p.slot]} → ${p.set.species}`).filter(x=>{const [a,b]=x.split(' → ');return a!==b;})};});
    return {updated:true,changed:r.result.placed,note:'Saved as a new step in the team\'s History (Manage tab), so the previous sets can be restored.'};}
  if(name==='update_set'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const ch=input.changes??{};
    if(!Object.keys(ch).length)throw new Error('changes is empty: send moves, item, ability, nature, statPoints and/or strategy.');
    if(ch.strategy!==undefined&&typeof ch.strategy!=='string')throw new Error('strategy is the full write-up as markdown text.');
    const view=currentTeam(db,t);const want=String(input.pokemon).toLowerCase();
    const slot=view.sets.findIndex((x:any)=>String(x.species).toLowerCase()===want);if(slot<0)throw offTeam(db,t,input.pokemon,view.sets);
    const before:any=structuredClone(view.sets[slot]);const set:any=structuredClone(before);
    if(ch.moves!==undefined){if(!Array.isArray(ch.moves)||ch.moves.length!==4)throw new Error('moves is the full list of four move names (keep the ones that stay).');set.moves=ch.moves.map(String);}
    for(const k of ['item','ability','nature'])if(ch[k]!==undefined)set[k]=String(ch[k]);
    if(ch.statPoints!==undefined){if(typeof ch.statPoints!=='object'||Array.isArray(ch.statPoints))throw new Error('statPoints is an object like {"spa":32,"spe":32,"hp":2}.');set.statPoints={...(before.statPoints??{}),...ch.statPoints};}
    const strategy=typeof ch.strategy==='string'?ch.strategy.trim().slice(0,6000):undefined;
    if(ch.strategy!==undefined&&!strategy)throw new Error('strategy cannot be empty: send the full write-up.');
    if(strategy){const bad=checkPokemonStrategy(strategy);if(bad)throw new Error(bad);}
    const rev=db.bank.find(b=>b.id===view.configuration.slots[slot].bankId)?.revisions.find(r=>r.id===view.configuration.slots[slot].revisionId);
    const strategyChanged=strategy!==undefined&&strategy!==setStrategyText(rev?.notes).trim();
    let lines=changeLines(before,set);
    if(strategy!==undefined){lines=lines.filter(l=>!l.startsWith('No change'));
      if(strategyChanged)lines.push(`**Strategy:** rewritten\n\n> ${strategy.slice(0,700).replace(/\n/g,'\n> ')}${strategy.length>700?'…':''}`);
      if(!lines.length)throw new Error(`${before.species} already has exactly this set and strategy: nothing to change.`);}
    if(input.apply!==true){
      // The same checks the in-app suggestions pass (item and species clauses, stat-point total) before the player sees it.
      const proposal:any=validateProposals('assist',{reply:'',proposals:[{kind:'set',slot,set,why:String(input.summary),...strategyChanged?{strategy}:{}}]},view.sets as any,slot,'overview').proposals[0];
      await mutateLatest(d=>applyAction(d,{type:'pending-add',teamId:t.id,summary:`${before.species}: ${lines.length} change${lines.length===1?'':'s'}`,proposal} as any));
      return {proposed:true,pokemon:before.species,changes:lines,message:`**Suggested change to ${before.species}**\n${lines.map(l=>`- ${l}`).join('\n')}\n\n_${input.summary}_\n\n${where}`};}
    const r=await mutateLatest(d=>{const team=d.teams.find(x=>x.id===input.teamId)!;const v=currentTeam(d,team);
      applyAction(d,{type:'team-replace-sets',teamId:team.id,versionId:v.version.id,parentConfigurationId:v.configuration.id,sets:[{slot,set,...strategyChanged?{notes:{role:strategy,benchmarks:''}}:{note:String(input.summary).slice(0,400)}}],summary:`Updated by your assistant: ${String(input.summary).slice(0,400)}`} as any);
      return {pokemon:set.species,moves:set.moves,item:set.item,ability:set.ability,nature:set.nature,statPoints:set.statPoints};});
    return {updated:r.result,changes:lines,message:`**Changed ${before.species}**\n${lines.map(l=>`- ${l}`).join('\n')}`,note:'Saved as a new step in the team\'s History (Manage tab); the previous set can be restored.'};}
  if(name==='update_strategy'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const text=String(input.text??'').trim();if(!text)throw new Error('text is required.');
    if(input.apply!==true){await mutateLatest(d=>applyAction(d,{type:'pending-add',teamId:t.id,summary:'Strategy write-up',proposal:{kind:'strategy',text:text.slice(0,12000)}} as any));
      return {proposed:true,message:`**Suggested strategy write-up for ${t.name}**\n\n${text.slice(0,1500)}${text.length>1500?'…':''}\n\n${where}`};}
    await mutateLatest(d=>{const team=d.teams.find(x=>x.id===t.id)!;applyAction(d,{type:'version-notes',teamId:team.id,versionId:team.activeVersionId,notes:text.slice(0,12000)} as any);});return {updated:true,note:'Saved as the team\'s strategy write-up.'};}
  if(name==='save_benchmark'||name==='list_benchmarks'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');const view=currentTeam(db,t);
    const idx=(sp:string)=>view.sets.findIndex((s:any)=>String(s.species).toLowerCase()===String(sp).toLowerCase());
    const head=(b:any)=>b.kind==='damage'?{range:b.result?.range,percentOfMaxHP:b.result?.percentOfMaxHP,koChanceOnHit:b.result?.koChanceOnHit}:b.kind==='speed'?{first:b.result?.first??b.result?.result,a:b.result?.a?.speed??undefined,b:b.result?.b?.speed??undefined}:{summary:'spread search'};
    if(name==='list_benchmarks'){const slots=view.configuration.slots;const mine=(db.benchmarks??[]).filter((b:any)=>slots.some((s:any)=>s.bankId===b.bankId)&&(!input.pokemon||b.bankId===slots[idx(input.pokemon)]?.bankId));
      return mine.map((b:any)=>({id:b.id,pokemon:view.sets[slots.findIndex((s:any)=>s.bankId===b.bankId)]?.species,kind:b.kind,side:b.side,...benchmarkLabel(b,view.sets[slots.findIndex((s:any)=>s.bankId===b.bankId)]?.species),context:b.context,...head(b)}));}
    const i=idx(input.pokemon);if(i<0)throw offTeam(db,t,input.pokemon,view.sets);
    if(!['damage','speed','spread'].includes(input.kind))throw new Error('kind is damage, speed or spread.');if(!input.input||typeof input.input!=='object')throw new Error('input is required: the same calc input you would give calc_damage / calc_speed / spread_search.');
    const slot=view.configuration.slots[i];
    const r=await mutateLatest(d=>applyAction(d,{type:'benchmark-save',bankId:slot.bankId,revisionId:slot.revisionId,kind:input.kind,input:input.input,context:input.context,sources:input.sources??[]} as any));
    const b:any=r.result;return {saved:{id:b.id,...b.label,kind:b.kind,side:b.side,...head(b)},note:'Shown on that Pokémon\'s page.'};}
  if(name==='delete_benchmark'){const b:any=(db.benchmarks??[]).find((x:any)=>x.id===input.benchmarkId);if(!b)throw new Error('Benchmark not found; call list_benchmarks.');
    await mutateLatest(d=>applyAction(d,{type:'benchmark-delete',benchmarkId:b.id} as any));return {deleted:b.id,restorable:{kind:b.kind,input:b.input,context:b.context}};}
  if(name==='add_replays'){
    const links:string[]=Array.isArray(input.links)?input.links.map(String):[],html:string[]=Array.isArray(input.html)?input.html:[];
    if(!links.length&&!html.length)throw new Error('Send links (replay.pokemonshowdown.com) and/or html from the player.');
    if(links.length+html.length>40)throw new Error('Send at most 40 replays per call.');
    if(html.some(h=>typeof h!=='string'))throw new Error('html entries are the replay HTML as text.');
    for(const l of links)showdownReplayId(l); // refuses anything but a replay.pokemonshowdown.com replay link before any fetch
    if(!(await profile()).player)throw new Error('Not added: the player\'s Showdown name is not set, so replays cannot be read from their side. They set it in Frontier Brain Settings.');
    if(typeof input.teamId==='string'&&input.teamId&&!db.teams.some(t=>t.id===input.teamId))throw new Error('Team not found');
    const teamId=typeof input.teamId==='string'&&input.teamId?input.teamId:undefined;
    const {results,fresh}=await intakeReplays([...links.map(url=>({url})),...html.map((h,i)=>({html:h,name:`pasted replay ${i+1}`}))],{...teamId?{teamId}:{},certainty:'auto'});
    const after=await readStore();const names=(id:string)=>after.teams.find(t=>t.id===after.associations[id]?.teamId)?.name??null;
    const out=results.map(r=>({label:r.label,ok:r.ok,...r.ok?{replayId:r.id,duplicate:r.duplicate,team:names(r.id!),linked:r.certainty==='inbox'?'not linked: its six match no saved team':r.certainty==='exact'?`sets consistent with the game${r.basis==='auto'?' (matched automatically, not confirmed by the player)':''}`:'same six, sets not matched',...r.note?{note:r.note}:{}}:{error:r.error}}));
    // Adding a replay never spends the player's AI key: new games wait (needsSummary) until the player presses Summarise or you do it.
    const added=results.filter(r=>r.ok&&!r.duplicate).length;
    return {added,duplicates:results.filter(r=>r.ok&&r.duplicate).length,failed:results.filter(r=>!r.ok).length,results:out,
      summaries:fresh.length?{waiting:fresh.length,note:'Not summarised automatically (Frontier Brain does not spend the player\'s AI key on its own). They wait: list_replays marks them needsSummary; read each with replay_transcript and save_replay_summary, then save_team_digest.'}:{note:'Nothing new to summarise.'}};}
  if(name==='delete_replay'){const id=String(input.replayId??'');const a:any=db.associations[id];const games=await loadGames();const g=games.find(x=>x.id===id);
    if(!g)throw new Error('Replay not found: use an id from list_replays.');
    if(input.playerAgreed!==true)throw new Error('Not deleted: the player has to ask for this. Confirm with them, then call again with playerAgreed: true.');
    const o=g.ownSide==='p1'?'p2':'p1';const r=await removeReplay(id);
    return {deleted:id,game:`${g.result} vs ${g.players[o]?.name??'?'}${g.date?` (${g.date})`:''}`,team:a?db.teams.find(t=>t.id===a.teamId)?.name??null:null,removed:['link to the team','stored original','parsed copy','summary'],matchesRemoved:r.matchesRemoved,debrief:{none:'The team had no debrief.',unchanged:'The team\'s debrief did not mention it.',updated:'The team\'s debrief (and any edits the player made) was kept for the games that remain, with a note that it is built from fewer games. save_team_digest or a refresh rebuilds it.',removed:'No theme was left after removing it, so the team\'s debrief was removed; save_team_digest makes a new one.'}[r.digest]};}
  if(name==='create_pokepaste'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    if(input.playerAgreed!==true)throw new Error('Not published: this posts the team to pokepast.es, a public site. The player has to ask for this. Confirm with them, then call again with playerAgreed: true.');
    const r=await createPokepaste(db,{teamId:t.id,author:typeof input.author==='string'?input.author:(await config()).player,notes:input.notes});return {published:true,url:r.url,team:r.name,note:'Public: anyone with this link can read it.'};}
  if(name==='backup_info'){const games=await loadGames();let summaries=0;for(const g of games)if(await readSummary(g.id))summaries++;
    return {contains:{teams:db.teams.length,pokemonInLibrary:db.bank.length,replays:games.length,replaySummaries:summaries},available:'export_backup returns a one-time download link (never the file). Or the app: Settings (avatar in the header) → Backup → Download backup. Restoring is in the app only (Settings → Backup → Restore; see restore_backup).',why:'A backup carries every replay\'s full log, which is far larger than a chat tool result can hold, and a restore has to take the whole file back. Restoring merges: anything that already exists is kept, never overwritten.'};}
  if(name==='delete_team'){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Team not found');
    if(input.playerAgreed!==true)throw new Error('Not deleted: the player has to ask for this. Confirm with them, then call again with playerAgreed: true.');
    if(String(input.confirmName??'').trim()!==t.name)throw new Error(`Not deleted: confirmName must equal the team name exactly ("${t.name}").`);
    const r:any=await mutateLatest(d=>applyAction(d,{type:'team-delete',teamId:t.id} as any));
    // Same as the app: a deleted team takes its replays and their analysis with it.
    const gone=await deleteReplays(r.result?.replays??[]);await removeFile(`reports/replay-digests/${t.id}.json`).catch(()=>{});
    return {deleted:t.name,replaysDeleted:gone};}
  if(benchNames.has(name))return benchCall(name,input,db);
  if(inboxNames.has(name))return inboxCall(name,db);
  if(backupNames.has(name))return backupCall(name,input); // export_backup / restore_backup (tools/mcp-backup.ts)
  const focused=await focusCall(name,db,input,()=>runTool(name,input,{},db)); // get_focus, and calcs handed to the app
  if(focused!==undefined)return focused;
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
- Call import_team once the six is settled enough to try (it only creates a new team; nothing existing changes), with the plan you agreed (goal, what it is built around, game plan, what was ruled out) in the notes field: that becomes the team\'s Strategy write-up. Afterwards offer lead and matchup plans (propose_plans).
- When the player tells you a lasting preference (playstyle, Bo1/Bo3, Pokémon they love or hate facing), save it with update_player_profile so no app asks again.
- Lead and matchup plans follow one standard so every team reads the same: each lead has a title, a role (core / situational / niche / avoid; never blank), a one-sentence "when", the lead pair and back pair, and a short plan: "**T1:** …", "**T2:** …" with the calc numbers that justify it and one "**Watch:**" line. "Avoid" leads are one or two sentences naming what to lead instead. Each matchup has an archetype (exactly one team style from the list in propose_plans; near-misses like TR are mapped and reported, anything else is refused, and specifics go in the plan text), 3–6 example Pokémon, a threat level, the four you bring (and who stays home, with the reason), and 2–4 sentences with exact numbers.
- Before proposing, call get_strategy and edit what exists (send its id) rather than adding a near-duplicate. Suggest changes the way the in-app chat does: update_set (including a Pokémon\'s Strategy write-up via changes.strategy), replace_pokemon, update_team and update_strategy send the player a suggestion with the before → after and your reason, which they accept in Frontier Brain; always show them the message the tool returns. Pass apply: true only when they have told you to just apply it (changes are then kept in History and can be restored). Edit or remove lead and matchup plans with propose_plans / remove_plans. Only delete_team is final: do it only when the player explicitly asks, and pass the exact team name.
- Each Pokémon\'s Strategy (changes.strategy, replace_pokemon strategy, import_team setNotes) always has the same three sections, kept short: "## Role" (one line: the job it does for this team), "## How to play" (when it comes in, what it protects or enables, key moves and calc numbers), "## Watch out for" (what beats it or punishes its plan). Example: Role: Intimidate / Fake Out / pivot support. How to play: Protect the win conditions with Fake Out and Intimidate; Parting Shot gives safer entries. Watch out for: opposing Fake Out denial, strong Water or Ground damage, predictable pivots.
- Replays waiting for a summary: when the player has no AI key in Frontier Brain, new replays are kept and wait for you. list_replays marks them needsSummary. For each one call replay_transcript, judge every decision only with the information available at that turn, then save_replay_summary (if a game already has a summary, build on it: the player may have edited it (editedByPlayer), so keep their wording and points where they still hold; play mistakes, team-building weaknesses and variance kept apart; cite real turn numbers; never state an opponent\'s unrevealed item, spread or move as fact; a few games is a small sample). When two or more are summarised, finish with save_team_digest. The player can edit summaries and the debrief themselves, so re-saves should keep their wording where it still holds. Tell the player what you saved.
- Replays the player gives you: add_replays takes the Showdown links or pasted HTML they sent (replay.pokemonshowdown.com only, never guess or search for replays), links each to the team whose six matches and says how certain the link is; an automatic "exact" link is consistent with the game, not confirmation of spreads. Games without an AI key wait for you (above). delete_replay removes ONE replay for good: only when they asked, with playerAgreed: true and the exact id. create_pokepaste PUBLISHES a team to pokepast.es: only when they asked for a public link, with playerAgreed: true; show them the URL. export_backup returns a short-lived, single-use download link for a backup (never the file); restore is only in the app (Settings), see restore_backup; backup_info says what a backup would hold.
- When a calc is what a set is built around (what it must survive, KO or outspeed), save it with save_benchmark so it sits on that Pokémon's page; list_benchmarks shows what is already saved.
${focusInstructions}
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
  const s=new Server(info,{capabilities:{tools:{},prompts:{}},instructions:`${chatInstructions}\n${collaborate}\n${benchGuidance}\n${prefs}`});
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
// "Not on this team" for a name that is a Bench candidate says so: the Bench is where candidates are edited.
const offTeam=(db:any,t:any,name:unknown,sets:any[],tool?:string)=>{const want=String(name).trim().toLowerCase();
  const hit=(t.bench??[]).find((b:any)=>String(db.bank.find((e:any)=>e.id===b.bankId)?.revisions.find((r:any)=>r.id===b.revisionId)?.set.species??'').toLowerCase()===want);
  const six=sets.map((s:any)=>s.species).join(', ');
  return new Error(hit?`"${name}" is a candidate on this team's Bench, not one of the six (${six}). Change it with update_bench (benchId ${hit.id}), or move it into the team with promote_from_bench.`:`"${name}" is not on this team (${six}).${(t.bench??[]).length?' Candidates on the Bench are edited with update_bench; see get_bench.':''}`);};
export async function handleMcp(req:IncomingMessage,res:ServerResponse,body?:unknown){
  if(req.method!=='POST'){res.writeHead(405,{Allow:'POST','Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message:'Method not allowed'},id:null}));return;}
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});const s=server(preferencesText(await readPreferences()));
  res.on('close',()=>{void transport.close();void s.close();});
  await requestOrigin.run(originOf(req)??'',async()=>{await s.connect(transport);await transport.handleRequest(req,res,body);});
}
