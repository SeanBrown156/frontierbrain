// Builds knowledge/samples/samples.json: the starter teams every new hosted workspace gets.
//   node tools/build-samples.ts
// Tournament teams come from the team pool: top-8 lists whose players shared exact spreads on VGCPastes. Each gets the
// hand-authored strategy in knowledge/samples/strategy.json (game plan as version notes, active lead/matchup plans).
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CODE} from './io.ts';
import {poolTeams} from './pool.ts';
import {exportText} from './teams.ts';

const PICKS=[{player:'Eric Rios',placing:1},{player:'Kiran Singh',placing:1},{player:'Aditya Subramanian',placing:2},{player:'Brady Smith',placing:3}];
const ordinal=(n:number)=>n+(['th','st','nd','rd'][n%100>10&&n%100<14?0:n%10]??'th');
const day=(d:string)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
const pool=await poolTeams();const teams:any[]=[];const strategy=JSON.parse(await readFile(resolve(CODE,'knowledge/samples/strategy.json'),'utf8'));
for(const pick of PICKS){
  const t=pool.find(x=>x.lane==='official'&&x.player===pick.player&&x.placing===pick.placing);if(!t)throw new Error(`Not in the pool: ${pick.player}`);
  const event=t.event.replace(/^Regional (.+)$/,'$1 Regional');
  const list=t.sources?.find((s:any)=>s.name==='Limitless')?.url,paste=t.spreadsFrom?.url;const plan=strategy.teams[t.id];if(!plan)throw new Error(`No strategy for ${t.id} in knowledge/samples/strategy.json`);
  teams.push({key:t.id,name:`Sample · ${t.player}, ${ordinal(t.placing!)} ${event}`,paste:exportText(t.sets as any,'gen9championsvgc2026regmc'),
    coaching:{leads:plan.leads,matchups:plan.matchups},
    notes:`${plan.strategy}\n\n---\n\n${strategy.evidence}\n\nSample team: ${t.player}'s ${ordinal(t.placing!)}-place team from ${t.event} (${day(t.date!)}${t.players?`, ${t.players.toLocaleString('en')} players`:''}).\n\nTeam list: ${list??'Limitless'}. Spreads, items and moves: the player's own shared paste on VGCPastes (${paste??'VGCPastes'}).\n\nThis is a starter example; edit it, copy ideas from it, or delete it.`});
}
await writeFile(resolve(CODE,'knowledge/samples/samples.json'),JSON.stringify({version:1,builtAt:new Date().toISOString(),teams},null,2)+'\n');
console.log(teams.map(t=>`${t.name}${t.replays?` (+${t.replays.length} replays)`:''}`).join('\n'));
