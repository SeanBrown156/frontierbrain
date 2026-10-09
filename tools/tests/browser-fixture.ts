// Isolated bank/formula storage for real browser acceptance checks. Replays/evidence remain read-only.
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createWorkbenchHandler} from '../workbench-server.ts';
import {readStore,mutateStore} from '../workbench-store.ts';
const fixtureRoot=await mkdtemp(resolve(tmpdir(),'vgc-browser-'));
const original=await readStore();await mutateStore(0,db=>Object.assign(db,structuredClone(original),{revision:0}),fixtureRoot);
const server=createServer(createWorkbenchHandler(fixtureRoot,5184));server.listen(5184,'127.0.0.1',()=>console.log('Isolated browser fixture API: http://127.0.0.1:5184'));
async function stop(){server.close();await rm(fixtureRoot,{recursive:true});process.exit(0);}process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
