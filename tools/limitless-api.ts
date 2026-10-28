// A single paced client per refresh. A 429 pauses the whole client before retrying the same event,
// rather than hammering the remaining events and losing an entire online lane.
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export function retryAfterMs(value:string|null,now=Date.now()):number{
  if(!value)return 0;
  const seconds=Number(value);
  return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-now)||0;
}
export function limitlessAPI({request=fetch,sleep=wait,now=Date.now,log=console.log}: {
  request?:typeof fetch;sleep?:(ms:number)=>Promise<void>;now?:()=>number;log?:(message:string)=>void;
}={}){
  let nextRequest=0;
  return async function get(path:string,maxBytes=10_000_000):Promise<any[]> {
    const url=`https://play.limitlesstcg.com/api${path}`;
    for(let attempt=0;attempt<5;attempt++){
      const pause=nextRequest-now();if(pause>0)await sleep(pause);
      nextRequest=now()+2000;
      let response:Response;
      try{response=await request(url,{headers:{'User-Agent':'PokemonVGCWorkspace/1.0 (personal research; bounded requests)'},signal:AbortSignal.timeout(30_000)});}
      catch(error){if(attempt===4)throw error;await sleep(2000*2**attempt);continue;}
      if(response.status===429||response.status>=500){
        await response.body?.cancel();
        if(attempt===4)throw new Error(`HTTP ${response.status} from ${url} after 5 attempts`);
        const delay=Math.max(retryAfterMs(response.headers.get('retry-after'),now()),(response.status===429?60_000:2000)*2**attempt);
        log(`Online · HTTP ${response.status}; waiting ${Math.ceil(delay/1000)}s before retrying ${path}`);
        nextRequest=Math.max(nextRequest,now()+delay);continue;
      }
      if(!response.ok){await response.body?.cancel();throw new Error(`HTTP ${response.status} from ${url}`);}
      const reader=response.body?.getReader();if(!reader)throw new Error(`No response body from ${url}`);
      let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new Error(`Response exceeds ${maxBytes} bytes from ${url}`);}chunks.push(value);}}
      finally{reader.releaseLock();}
      const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(rows))throw new Error(`Expected an array from ${url}`);
      return rows;
    }
    throw new Error(`Could not read ${url}`);
  };
}
