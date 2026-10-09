// Serverless hosts stop a function once its response is sent. Work a request starts in the background (AI jobs,
// replay summaries) registers here; the Vercel entry wires this to waitUntil. Locally it is a no-op.
let register:((p:Promise<unknown>)=>void)|null=null;
export function setKeepAlive(fn:(p:Promise<unknown>)=>void){register=fn;}
export function keepAlive(p:Promise<unknown>){register?.(p.catch(()=>{}));}
