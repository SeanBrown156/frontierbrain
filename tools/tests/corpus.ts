import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseReplay} from '../replays.ts';
// Frozen test corpus: nine public Champions M-C ladder replays (Sep–Oct 2026), anonymised: the reviewed side is "Player",
// opponents "OpponentNN", chat removed, battle ids replaced. Games 01–08 are one player across three rosters; 09 has an Illusion.
export const CORPUS=resolve(import.meta.dirname,'fixtures/corpus');
export async function corpusFiles(){return (await readdir(CORPUS)).filter(f=>f.endsWith('.html')).sort();}
export async function corpusGames(){return Promise.all((await corpusFiles()).map(async f=>parseReplay(await readFile(resolve(CORPUS,f),'utf8'),`tools/tests/fixtures/corpus/${f}`,'Player')));}
