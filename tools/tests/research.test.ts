import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseUsage,parseMovesets,pool} from '../research.ts';
import {json} from '../io.ts';
test('Usage parsing retains population, exact species/form and weighted percentage',()=>{
  const p=parseUsage('Total battles: 42\n| 1 | Salamence-Mega | 24.84263% | 100 | 20% |');assert.equal(p.battles,42);assert.equal(p.rows[0].species,'Salamence-Mega');assert.equal(p.rows[0].usagePercent,24.84263);assert.throws(()=>parseUsage('<html>blocked</html>'));
});
test('Moveset percentages remain published prevalence rather than renormalized slot shares',()=>{
  const data=parseMovesets('| Rillaboom |\n| Raw count: 42 |\n| Moves |\n| Fake Out 97.505% |\n| Wood Hammer 84.604% |\n| Other 17.891% |\n| Spreads |\n| Adamant:32/32/0/0/0/2 4.556% |');
  assert.equal(data.Rillaboom.rawCount,42);assert.equal(data.Rillaboom.categories.Moves[0].percent,97.505);assert.equal(data.Rillaboom.categories.Spreads[0].name,'Adamant:32/32/0/0/0/2');
});
test('Bounded parallel fetching preserves source order and inspects each result',async()=>{
  const result=await pool([1,2,3,4,5],async x=>x*2,2);assert.deepEqual(result,[2,4,6,8,10]);
});
test('Every screenshot resource has a distinct catalogue entry',async()=>{
  const catalogue=await json('knowledge/sources/catalogue.json');assert.equal(new Set(catalogue.map((s:any)=>s.id)).size,catalogue.length);
  for(const id of ['pokemon-zone','pokebase','pikalytics','pokepaste','showdown','limitless','suckerpunch','victory-road','vgcpastes','reddit-vgc','vgc-guide','top-cut','pikalytics-builder','pikalytics-speed','pikalytics-calc','liberty-note','liquipedia','reddit-champions','just-move-first','smogon','showdown-calc','labmaus','vgc-champions-calc','ncp-calc','statcrusher','munchstats'])assert.ok(catalogue.some((s:any)=>s.id===id),id);
});
