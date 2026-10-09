import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT} from '../io.ts';
import {validateProposals,guidance} from '../assist.ts';
import {importText} from '../teams.ts';
const team=async()=>importText(JSON.parse(await readFile(resolve(import.meta.dirname,'fixtures/teams.json'),'utf8'))[2].paste) as any[];
const set=(species:string,item:string)=>({species,ability:'Torrent',item,nature:'Adamant',moves:['Waterfall','Protect','Earthquake','Ice Punch'],statPoints:{hp:2,atk:32,spe:32}});
test('Set proposals obey the item clause and species clause, and slot assistants are pinned to their slot',async()=>{
  const six=await team();const free=six.map(s=>s.item);const other=['Mystic Water','Life Orb','Choice Band'].find(i=>!free.includes(i))!;
  const ok=validateProposals('slot',{reply:'r',proposals:[{kind:'set',slot:4,set:set('Feraligatr',other)}]},six,1);assert.equal(ok.proposals[0].slot,1,'slot comes from the focused slot');
  assert.throws(()=>validateProposals('team',{proposals:[{kind:'set',slot:0,set:set('Feraligatr',six[1].item)}]},six),/already held/);
  assert.throws(()=>validateProposals('team',{proposals:[{kind:'set',slot:0,set:{...set('Feraligatr',other),statPoints:{hp:32,atk:32,spe:32}}}]},six),/66/);
});
test('Coaching proposals may only use team members; a build must contain a team',async()=>{
  const six=await team();const a=six[0].species,b=six[1].species;
  const r=validateProposals('coaching',{reply:'',proposals:[{kind:'lead',lead:[a,b],back:[six[2].species,six[3].species],plan:'x'}]},six);assert.deepEqual(r.proposals[0].lead.length,2);
  assert.throws(()=>validateProposals('coaching',{proposals:[{kind:'lead',lead:[a,'Pikachu'],back:[],plan:''}]},six),/not on the team/);
  assert.throws(()=>validateProposals('build',{reply:'',proposals:[]},null),/one team proposal/);
  for(const area of Object.keys(guidance).filter(a=>a!=='assist'))assert.match((guidance as any)[area],/get_team|brief|66/);
});
test('The docked assistant leads with the page guidance, accepts any proposal kind, and pins only slot-less set proposals on a Pokémon page',async()=>{
  const {assistGuidance}=await import('../assist.ts');const six=await team();const free=six.map(s=>s.item);const other=['Mystic Water','Life Orb','Choice Band'].find(i=>!free.includes(i))!;
  assert.ok(assistGuidance('coaching').startsWith('The player is planning'));assert.match(assistGuidance('slot'),/narrow side panel/);
  const r=validateProposals('assist',{reply:'',proposals:[{kind:'set',set:set('Feraligatr',other)},{kind:'lead',lead:[six[0].species,six[1].species],back:[],plan:'x'},{kind:'strategy',text:'x'}]},six,2,'slot');
  assert.equal(r.proposals[0].slot,2);assert.equal(r.proposals[0].forSpecies,six[2].species);assert.deepEqual(r.proposals.map(p=>p.kind),['set','lead','strategy']);
  const named=validateProposals('assist',{proposals:[{kind:'set',slot:4,set:set('Feraligatr',other)}]},six,2,'slot');assert.equal(named.proposals[0].slot,4,'an explicit other slot is kept');
  assert.doesNotThrow(()=>validateProposals('assist',{proposals:[]},six,undefined,'overview'));
});
