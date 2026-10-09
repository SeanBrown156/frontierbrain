import {fetchText} from './research.ts';
// Showdown replay links → the same HTML shape the Download button produces, so one parser handles both.
// Private replays keep their "-<token>pw" suffix. Only replay.pokemonshowdown.com is fetched.
export function showdownReplayId(link:string){
  const url=new URL(link.trim());if(url.hostname!=='replay.pokemonshowdown.com')throw new Error('Use a replay.pokemonshowdown.com link');
  const replayId=url.pathname.replace(/^\/|\.(json|log)$/g,'');if(!/^[a-z0-9]+-\d+(-[a-z0-9]+pw)?$/.test(replayId))throw new Error('That does not look like a Showdown replay link');return replayId;
}
export function replayHTML(replayId:string,log:string,sourceURL:string){
  const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `<!DOCTYPE html>\n<!-- Imported by Frontier Brain from ${escape(sourceURL)} -->\n<input type="hidden" name="replayid" value="${escape(replayId)}" />\n<script type="text/plain" class="battle-log-data">${log.replace(/<\//g,'<\\/')}</script>\n`;
}
export async function showdownReplayHTML(link:string){
  const replayId=showdownReplayId(link);const source=`https://replay.pokemonshowdown.com/${replayId}`;const {text}=await fetchText(`${source}.json`,6_000_000);
  const data=JSON.parse(text);if(typeof data.log!=='string'||!data.log.includes('|player|'))throw new Error('Showdown returned no battle log for that replay');return replayHTML(replayId,data.log,source);
}
