import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,writeFile,rm,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT,json,hash} from '../io.ts';
import {parseReplay,extractLog,aggregate,type Game} from '../replays.ts';
import {corpusFiles,CORPUS} from './corpus.ts';

const html=(log:string)=>`<input name="replayid" value="test-1"><script type="text/plain" class="battle-log-data">${log}</script>`;
test('Malformed files reject; case-insensitive p2 identity and incomplete back selections survive',()=>{
  assert.throws(()=>extractLog('<script>alert(1)</script>'),/battle-log-data/);
  const game=parseReplay(html('|player|p1|Foe|1|1000\n|player|p2|PLAYER|1|1100\n|tier|Test\n|poke|p1|Pikachu, L50|\n|poke|p2|Rillaboom, L50|\n|teamsize|p1|4\n|teamsize|p2|4\n|start\n|switch|p1a: Pikachu|Pikachu, L50|100\\/100\n|switch|p2a: Rillaboom|Rillaboom, L50|207\\/207\n|turn|1\n|move|p2a: Rillaboom|Wood Hammer|p1a: Pikachu\n|win|PLAYER'),'test.html','Player');
  assert.equal(game.ownSide,'p2');assert.equal(game.result,'win');assert.equal(game.unknownBackSlots.p1,3);assert.equal(game.finalState.mons['p1:Pikachu'].hp.precision,'percent');assert.equal(game.finalState.mons['p2:Rillaboom'].hp.precision,'exact');assert.deepEqual(game.turns[0].knowledgeBefore.mons['p2:Rillaboom'].moves,[]);assert.equal(game.teamSheets,'not-recorded');
});

test('Real corpus: 9 logs, four rosters, 3 wins and Illusion handled without hindsight',async()=>{
  const files=await corpusFiles();assert.equal(files.length,9);
  const games=await Promise.all(files.map(async f=>parseReplay(await readFile(join(CORPUS,f),'utf8'),f,'Player')));
  assert.equal(new Set(games.map(g=>g.id)).size,9);assert.equal(new Set(games.map(g=>g.logHash)).size,9);assert.equal(new Set(games.map(g=>g.rosterGroup)).size,4);assert.equal(games.filter(g=>g.result==='win').length,3);
  const stats=aggregate(games);assert.equal(Object.values(stats.groups).reduce((n,g)=>n+g.games,0),9);
  const illusion=games.find(g=>g.players.p2?.name==='Opponent09')!;assert.ok(illusion.warnings.some(w=>w.includes('Illusion')));assert.equal(illusion.leads.p2[1],'Zoroark-Hisui');assert.equal(illusion.turns[0].knowledgeBefore.mons['p2:Majestic vocals'].species,'Tsareena');
});
