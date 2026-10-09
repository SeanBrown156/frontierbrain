import {test} from 'node:test';
import assert from 'node:assert/strict';
import {corpusGames} from './corpus.ts';
import {observeGame,clusterGames,buildObservedSet,siblingObservations} from '../observed.ts';
test('Replay observation records only what the player\'s side revealed',async()=>{
  const games=await corpusGames();const g=games.find(g=>g.id.endsWith('1000000005'))!;const o=observeGame(g);
  assert.ok(o.Garchomp.moves.includes('Power Gem'));assert.equal(o.Garchomp.item,'Garchompite Z');assert.equal(o.Kingambit,undefined);assert.ok(!Object.values(o).some(x=>x.moves.includes('Struggle')));
  for(const c of clusterGames(games.filter(x=>x.rosterGroup===g.rosterGroup)))for(const obs of Object.values(c.observed))assert.ok(obs.moves.length<=4);
});
test('Observed sets keep battle-seen moves known and label everything else inferred',async()=>{
  const games=await corpusGames();const group=games.filter(g=>g.rosterGroup===games.find(x=>x.id.endsWith('1000000005'))!.rosterGroup);
  const built=buildObservedSet('Archaludon',{moves:['Electro Shot']},[],null,new Set(),siblingObservations(group)['Archaludon']);
  assert.deepEqual(built.knownMoves,['Electro Shot']);assert.equal(built.fields.moves,'inferred');assert.match(built.basis,/^Observed in replays/);
});
