import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parsePokebase,parsePikalytics,standardSet,pokebaseSlug,metaSets} from '../meta-sets.ts';
const fixture=(name:string)=>readFile(resolve(import.meta.dirname,'fixtures/meta',name),'utf8');
test('PokéBase ladder parser reads the doubles season block, its season label and Champions stat points',async()=>{
  const m=parsePokebase(await fixture('pokebase-incineroar.html'),'Incineroar','https://pokebase.app/x','2026-10-08T00:00:00Z').ladder!;
  assert.equal(m.source,'pokebase-ladder');assert.match(m.period,/^Season M-5 \(Aug 5/);assert.equal(m.population,'Pokémon Champions in-game ranked doubles');
  assert.deepEqual(m.spreads[0],{statPoints:{hp:32,atk:0,def:14,spa:0,spd:20,spe:0},percent:8.2});assert.equal(m.natures[0].name,'Careful');assert.equal(m.moves[0].name,'Fake Out');
  const s=standardSet(m);assert.equal(s.nature,'Careful');assert.equal(s.ability,'Intimidate');assert.match(s.label,/spread 8\.2%, nature 31\.7%/);
});
test('Pikalytics parser keeps its own percentages and never invents spreads',async()=>{
  const m=parsePikalytics(await fixture('pikalytics-incineroar.html'),'Incineroar','https://pikalytics.com/x');
  assert.equal(m.moves[0].name,'Fake Out');assert.equal(m.items[0].name,'Sitrus Berry');assert.equal(m.teammates[0].name,'Rillaboom');assert.deepEqual(m.spreads,[]);
  assert.throws(()=>standardSet(m),/no spreads/);
});
test('Slugs follow PokéBase URLs and unknown species are rejected before any fetch',async()=>{
  assert.equal(pokebaseSlug('Kommo-o'),'kommo-o');assert.equal(pokebaseSlug('Rotom-Wash'),'rotom-wash');assert.equal(pokebaseSlug('Mr. Mime'),'mr-mime');
  await assert.rejects(metaSets('Notamon'),/Unknown species/);
});
test('PokéBase tournament block is the default source, labelled with its regulation and kept apart from the ladder',async()=>{
  const {tournament,ladder}=parsePokebase(await fixture('pokebase-incineroar.html'),'Incineroar','https://pokebase.app/x','2026-10-08T00:00:00Z');
  assert.equal(tournament!.source,'pokebase');assert.equal(tournament!.population,'Tournament team lists, Regulation M-C');assert.notEqual(tournament!.spreads[0].percent,ladder!.spreads[0].percent);
  assert.equal(tournament!.abilities[0].name,'Intimidate');assert.ok(tournament!.teammates[0].count! > 0);assert.match(standardSet(tournament!).label,/^PokéBase M-C tournaments/);
});
