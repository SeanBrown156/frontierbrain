// The hosted API as one Vercel function: every /api request is a signed-in or guest Supabase user.
import {waitUntil} from '@vercel/functions';
import {ROOT} from './io.ts';
import {createWorkbenchHandler} from './workbench-server.ts';
import {hostedConfig,hostedHandler} from './hosted.ts';
import {setKeepAlive} from './keep-alive.ts';
setKeepAlive(waitUntil);
const config=hostedConfig();
if(!config)throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (and SUPABASE_SECRET_KEY) for the hosted API');
export default hostedHandler(config,createWorkbenchHandler(ROOT,5174,{hostedMode:true}));
