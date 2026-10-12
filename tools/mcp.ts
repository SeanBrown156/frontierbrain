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
import {loadGames} from './replays.ts';
import {transcript,readGame,readSummary} from './replay-summary.ts';
import {readPreferences,preferencesText} from './player.ts';

const teamId={teamId:{type:'string',description:'Team id from list_teams'}};
const plan={type:'object',properties:{title:{type:'string',description:'Short name for the lead, e.g. "Rain blitz"'},lead:{type:'array',items:{type:'string'}},back:{type:'array',items:{type:'string'}},role:{type:'string',enum:['core','situational','niche','avoid'],description:'core = default lead; situational = into specific teams; niche = pocket option; avoid = a pairing not to lead'},when:{type:'string'},plan:{type:'string'}},required:['lead','plan']};
const matchup={type:'object',properties:{opponent:{type:'string',description:'Short name of the matchup, e.g. "Tailwind offense"'},archetype:{type:'string',description:'Team style, e.g. Tailwind offense, Trick Room, Rain, Sun, Balance'},examples:{type:'array',items:{type:'string'},description:'Example opposing Pokémon (species names)'},threat:{type:'string',enum:['low','medium','high']},bring:{type:'array',items:{type:'string'}},plan:{type:'string'}},required:['opponent','bring','plan']};
// get_team takes a teamId here (the app passes the open team instead).
const shared=chatTools.map(t=>t.name==='get_team'?{...t,parameters:{type:'object',properties:teamId,required:['teamId']}}:t);
const own=[
  {name:'list_teams',description:'The player\'s teams: id, name, format, the six Pokémon and the record from linked replays. Call this first, and call format_rules once per chat before advising on building (Champions doubles: register 6, bring 4; several Mega Stone holders allowed, one Mega Evolution per battle chosen game by game).',parameters:{type:'object',properties:{}}},
  {name:'list_replays',description:'Replays linked to a team: id, date, result, opponent, both previews and the AI summary if there is one.',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'replay_transcript',description:'Turn-by-turn log of one replay. Judge decisions with the information available at that turn.',parameters:{type:'object',properties:{replayId:{type:'string'}},required:['replayId']}},
  {name:'save_team_brief',description:'Save or update a team\'s brief (goal, core, game plan, what was ruled out). It shows in the team\'s Strategy tab and every assistant reads it.',parameters:{type:'object',properties:{...teamId,brief:{type:'object',description:'The team brief you agreed with the player',properties:{goal:{type:'string',description:'Why this team exists, in the player\'s terms'},core:{type:'array',items:{type:'string'},description:'The Pokémon it is built around'},gamePlan:{type:'string',description:'How it wins: modes, leads, win conditions'},ruledOut:{type:'string',description:'What you considered and the player turned down, and why'},playerAgreed:{type:'boolean',description:'True only if the player said yes to this six and plan'}},required:['goal','core','gamePlan','playerAgreed']}},required:['teamId','brief']}},
  {name:'import_team',description:'Create a new team from a Showdown paste (Champions stat points on the "EVs:" line: 0–32 per stat, 66 total). Never changes an existing team. Call it only once the player has agreed on all six (legal under format_rules: species and item clauses; several Mega Stones are fine); put the game plan and the reasoning behind key spreads in notes.',parameters:{type:'object',properties:{name:{type:'string'},paste:{type:'string'},notes:{type:'string',description:'Optional game plan (markdown)'},brief:{type:'object',description:'The team brief you agreed with the player',properties:{goal:{type:'string',description:'Why this team exists, in the player\'s terms'},core:{type:'array',items:{type:'string'},description:'The Pokémon it is built around'},gamePlan:{type:'string',description:'How it wins: modes, leads, win conditions'},ruledOut:{type:'string',description:'What you considered and the player turned down, and why'},playerAgreed:{type:'boolean',description:'True only if the player said yes to this six and plan'}},required:['goal','core','gamePlan','playerAgreed']}},required:['name','paste','brief']}},
  {name:'propose_plans',description:'Add lead and matchup plans to a team as proposals. They appear in the team\'s Strategy tab for the player to accept or reject; nothing becomes active on its own.',parameters:{type:'object',properties:{...teamId,leads:{type:'array',items:plan},matchups:{type:'array',items:matchup}},required:['teamId']}},
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
  if(name==='propose_plans'){if(!db.teams.some(t=>t.id===input.teamId))throw new Error('Team not found');const id=()=>randomUUID().slice(0,10);
    const leads=(input.leads??[]).slice(0,8).map((p:any)=>({id:id(),title:p.title,lead:p.lead,back:p.back??[],role:p.role,when:p.when??'',plan:p.plan,calcIds:[],versionIds:[],status:'proposed'}));
    const matchups=(input.matchups??[]).slice(0,12).map((p:any)=>({id:id(),opponent:p.opponent,archetype:p.archetype,examples:p.examples,threat:p.threat??'medium',bring:p.bring,plan:p.plan,calcIds:[],versionIds:[],status:'proposed'}));
    await mutateLatest(d=>applyAction(d,{type:'coaching-update',teamId:input.teamId,upsert:{leads,matchups}}));
    return {proposed:{leads:leads.length,matchups:matchups.length},note:'Saved as proposals in the team\'s Strategy tab for the player to accept.'};}
  return runTool(name,input,name==='get_team'?{teamId:input.teamId}:{},db);
}

// How to work with the player: a teambuilding partner, not a team vending machine.
const collaborate=`You are connected to the player's Frontier Brain workspace. Start with get_player_profile (what they've told Frontier Brain about themselves, across every app) and list_teams when their teams matter. Changes to teams are proposals the player accepts in the app.
Work as a collaborator, in short turns, and hand choices back to the player:
- When they name Pokémon to try or build around, first find out what makes each one distinctive: call pokemon_profile (and team_pool_sets if the pool has it). Say what is genuinely unusual — the Mega's typing, stats and ability, rare support or speed-control moves, which popular threats it hits or walls, how it fares under Trick Room — and what is awkward about it. A low pool share is a feature (opponents won't have a plan for it); say so.
- Then offer two or three distinct directions built around their picks (core, game plan, main risk) and ask which they like. Ask about their preferences (playstyle, Bo1 or Bo3, what they hate facing) if you don't know them.
- Build up from the core one or two slots at a time. Explain every pick by the job it does for this core: which threat it answers and why it beats the alternatives. Don't reach for meta staples (Incineroar, Rillaboom, Sneasler…) by reflex; when one fits, say why it fits this team specifically and name a less obvious option.
- Respect the format (format_rules): plan the fours you'd bring into common teams, and treat multiple Mega options as modes picked at team preview, not a mistake.
- Test the plan with numbers before settling it: key calcs (calc_damage) and speed tiers (calc_speed) against labelled standard_set opponents, and spread_search for the spreads.
- Only call import_team once the player has agreed on all six, with the brief you agreed (goal, core, game plan, what was ruled out). Afterwards offer lead and matchup plans (propose_plans).
- When the player tells you a lasting preference (playstyle, Bo1/Bo3, Pokémon they love or hate facing), save it with update_player_profile so no app asks again.
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
  const s=new Server({name:'frontier-brain',version:'1.0.0'},{capabilities:{tools:{},prompts:{}},instructions:`${chatInstructions}\n${collaborate}\n${prefs}`});
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
