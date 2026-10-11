// MCP connector: Claude, ChatGPT and CLI agents use Frontier Brain's tools with the player's own subscription.
// Hosted, every request carries a Supabase OAuth access token (the hosted handler checks it and scopes storage to
// that user); locally it serves the one workspace on this machine. Stateless: a fresh server per request.
// Same rules as the in-app assistant: numbers come from these tools, sources stay labelled, and anything that
// changes a team arrives as a proposal the player accepts in the app.
import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {tools as chatTools,runTool,instructions as chatInstructions} from './chat.ts';
import {readStore,mutateStore,applyAction,currentTeam} from './workbench-store.ts';
import {loadGames} from './replays.ts';
import {transcript,readGame,readSummary} from './replay-summary.ts';

const teamId={teamId:{type:'string',description:'Team id from list_teams'}};
const plan={type:'object',properties:{lead:{type:'array',items:{type:'string'}},back:{type:'array',items:{type:'string'}},when:{type:'string'},plan:{type:'string'}},required:['lead','plan']};
const matchup={type:'object',properties:{opponent:{type:'string'},threat:{type:'string',enum:['low','medium','high']},bring:{type:'array',items:{type:'string'}},plan:{type:'string'}},required:['opponent','bring','plan']};
// get_team takes a teamId here (the app passes the open team instead).
const shared=chatTools.map(t=>t.name==='get_team'?{...t,parameters:{type:'object',properties:teamId,required:['teamId']}}:t);
const own=[
  {name:'list_teams',description:'The player\'s teams: id, name, format, the six Pokémon and the record from linked replays. Call this first.',parameters:{type:'object',properties:{}}},
  {name:'list_replays',description:'Replays linked to a team: id, date, result, opponent, both previews and the AI summary if there is one.',parameters:{type:'object',properties:teamId,required:['teamId']}},
  {name:'replay_transcript',description:'Turn-by-turn log of one replay. Judge decisions with the information available at that turn.',parameters:{type:'object',properties:{replayId:{type:'string'}},required:['replayId']}},
  {name:'import_team',description:'Create a new team from a Showdown paste (Champions stat points on the "EVs:" line: 0–32 per stat, 66 total). Never changes an existing team.',parameters:{type:'object',properties:{name:{type:'string'},paste:{type:'string'},notes:{type:'string',description:'Optional game plan (markdown)'}},required:['name','paste']}},
  {name:'propose_plans',description:'Add lead and matchup plans to a team as proposals. They appear in the team\'s Strategy tab for the player to accept or reject; nothing becomes active on its own.',parameters:{type:'object',properties:{...teamId,leads:{type:'array',items:plan},matchups:{type:'array',items:matchup}},required:['teamId']}},
];
const all=[...own,...shared];
const record=(games:any[])=>{const w=games.filter(g=>g.result==='win').length,l=games.filter(g=>g.result==='loss').length;return games.length?`${w}–${l}`:'no games';};

async function call(name:string,input:any){
  const db=await readStore();
  if(name==='list_teams'){const games=await loadGames();return db.teams.map(t=>({id:t.id,name:t.name,format:t.format,pokemon:currentTeam(db,t).sets.map(s=>s.species),record:record(games.filter(g=>db.associations[g.id]?.teamId===t.id))}));}
  if(name==='list_replays'){const games=(await loadGames()).filter(g=>db.associations[g.id]?.teamId===input.teamId);
    return Promise.all(games.map(async g=>{const o=g.ownSide==='p1'?'p2':'p1';const s:any=await readSummary(g.id);return {id:g.id,date:g.date,result:g.result,opponent:g.players[o]?.name,yours:g.preview[g.ownSide],theirs:g.preview[o],summary:s?.summary??null};}));}
  if(name==='replay_transcript'){const g=await readGame(input.replayId);if(!db.associations[g.id])throw new Error('Replay not found');return {transcript:transcript(g)};}
  if(name==='import_team'){const r=await mutateStore(db.revision,d=>applyAction(d,{type:'import',name:String(input.name).slice(0,120),paste:input.paste,notes:input.notes} as any));const t:any=r.result;return {created:t.id,name:t.name,note:'New team created. Open it in Frontier Brain to review.'};}
  if(name==='propose_plans'){const team=db.teams.find(t=>t.id===input.teamId);if(!team)throw new Error('Team not found');const id=()=>randomUUID().slice(0,10);
    const c=db.coaching?.[team.id]??{teamId:team.id,version:0,updatedAt:'',leads:[],matchups:[],objectives:[]};
    const leads=[...c.leads,...(input.leads??[]).slice(0,8).map((p:any)=>({id:id(),lead:p.lead,back:p.back??[],when:p.when??'',plan:p.plan,calcIds:[],versionIds:[],status:'proposed'}))];
    const matchups=[...c.matchups,...(input.matchups??[]).slice(0,12).map((p:any)=>({id:id(),opponent:p.opponent,threat:p.threat??'medium',bring:p.bring,plan:p.plan,calcIds:[],versionIds:[],status:'proposed'}))];
    await mutateStore(db.revision,d=>applyAction(d,{type:'coaching-save',teamId:team.id,parentVersion:c.version,coaching:{...c,leads,matchups}} as any));
    return {proposed:{leads:leads.length-c.leads.length,matchups:matchups.length-c.matchups.length},note:'Saved as proposals in the team\'s Strategy tab for the player to accept.'};}
  return runTool(name,input,name==='get_team'?{teamId:input.teamId}:{},db);
}

function server(){
  const s=new Server({name:'frontier-brain',version:'1.0.0'},{capabilities:{tools:{}},instructions:`${chatInstructions}\nYou are connected to the player's Frontier Brain workspace. Start with list_teams. Changes to teams are proposals the player accepts in the app.`});
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
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});const s=server();
  res.on('close',()=>{void transport.close();void s.close();});
  await s.connect(transport);await transport.handleRequest(req,res,body);
}
