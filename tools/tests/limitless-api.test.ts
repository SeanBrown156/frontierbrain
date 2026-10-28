import {test} from 'node:test';
import assert from 'node:assert/strict';
import {limitlessAPI,retryAfterMs} from '../limitless-api.ts';

test('Limitless pauses on 429, honours Retry-After, retries the same event, then paces the next request',async()=>{
  let time=0;const calls:{url:string;time:number}[]=[],delays:number[]=[];
  const get=limitlessAPI({now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms;},log:()=>{},request:async(input)=>{
    calls.push({url:String(input),time});return calls.length===1?new Response('',{status:429,headers:{'Retry-After':'90'}}):Response.json([{id:'ok'}]);
  }});
  assert.deepEqual(await get('/tournaments/a/standings'),[{id:'ok'}]);
  await get('/tournaments/b/standings');
  assert.deepEqual(calls.map(c=>c.time),[0,90_000,92_000]);
  assert.equal(calls[0].url,calls[1].url);
  assert.deepEqual(delays,[90_000,2000]);
});
test('Persistent rate limiting is bounded and backs off across attempts',async()=>{
  let time=0,calls=0;const delays:number[]=[];
  const get=limitlessAPI({now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms;},log:()=>{},request:async()=>{calls++;return new Response('',{status:429});}});
  await assert.rejects(get('/tournaments/a/standings'),/HTTP 429 .* after 5 attempts/);
  assert.equal(calls,5);assert.deepEqual(delays,[60_000,120_000,240_000,480_000]);
});
test('Retry-After supports HTTP dates, invalid headers and past dates',()=>{
  const now=Date.parse('2026-10-29T00:00:00Z');
  assert.equal(retryAfterMs('Thu, 29 Oct 2026 00:02:00 GMT',now),120_000);
  assert.equal(retryAfterMs('Wed, 28 Oct 2026 00:00:00 GMT',now),0);
  assert.equal(retryAfterMs('not-a-date',now),0);assert.equal(retryAfterMs(null,now),0);
});
test('Permanent HTTP errors, malformed responses and oversized bodies are rejected',async()=>{
  let calls=0;
  const get=limitlessAPI({request:async()=>{calls++;return new Response('',{status:403});}});
  await assert.rejects(get('/denied'),/HTTP 403/);assert.equal(calls,1);
  await assert.rejects(limitlessAPI({request:async()=>Response.json({error:'unexpected'})})('/bad'),/Expected an array/);
  await assert.rejects(limitlessAPI({request:async()=>Response.json(['too large'])})('/big',2),/Response exceeds 2 bytes/);
});
