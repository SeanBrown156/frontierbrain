import {spawn} from 'node:child_process';
// `npm run dev` is local mode. `npm run dev:hosted` loads .env.hosted (Supabase) so the app behaves like the hosted
// site: sign-in, guests and per-user rows. Both children inherit the environment.
if(process.argv.includes('--hosted'))process.loadEnvFile('.env.hosted');
const children=[spawn(process.execPath,['--watch','tools/workbench-server.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let stopping=false;function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');process.exitCode=code;}
for(const child of children){child.on('error',error=>{console.error(error);stop(1);});child.on('exit',code=>stop(code??0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
