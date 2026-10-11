import {useEffect,useState} from 'react';
import {supabase,useAccount,requireAccount} from './auth.tsx';

// /oauth/consent: Claude, ChatGPT or a CLI asks to connect to your Frontier Brain account (Supabase OAuth server).
// You sign in if needed, see which app is asking, and approve or deny. Approving sends you back to that app.
export default function Consent(){
  const account=useAccount();const id=new URLSearchParams(location.search).get('authorization_id');
  const [details,setDetails]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!id||account.kind!=='account')return;
    supabase!.auth.oauth.getAuthorizationDetails(id).then(({data,error})=>{if(error)return setError(error.message);
      const d:any=data;if(d&&!('authorization_id'in d)&&d.redirect_url)return void location.assign(d.redirect_url); // already approved before
      setDetails(d);});},[id,account.kind]);
  const decide=async(approve:boolean)=>{setBusy(true);const r:any=approve?await supabase!.auth.oauth.approveAuthorization(id!):await supabase!.auth.oauth.denyAuthorization(id!);
    if(r.error){setError(r.error.message);setBusy(false);return;}if(r.data?.redirect_url)location.assign(r.data.redirect_url);else setBusy(false);};
  const name=details?.client?.name??details?.client?.client_name??'An app';
  return <main className="welcome"><div className="welcome-card consent">
    <img src="/favicon.svg" alt="" width={48} height={48}/>
    {!id?<><h1>Nothing to approve</h1><p>This page opens when Claude, ChatGPT or another app asks to connect to Frontier Brain.</p><a className="button" href="/">Open Frontier Brain</a></>
    :account.kind!=='account'?<><h1>Connect to Frontier Brain</h1><p>Sign in to your Frontier Brain account to let this app use your teams and tools. Connectors need a free account.</p><button className="primary" onClick={()=>requireAccount('Sign in to connect Claude, ChatGPT or another app.')}>Sign in</button></>
    :error?<><h1>Couldn't connect</h1><p className="error">{error}</p><a className="button" href="/">Open Frontier Brain</a></>
    :!details?<p className="muted">Checking the request…</p>
    :<><h1>Allow {name} to use Frontier Brain?</h1>
      <p>Signed in as <b>{account.email}</b>. {name} will be able to:</p>
      <ul className="privacy-points">
        <li>see your teams, sets, strategy and replays</li>
        <li>run calcs and look up the data pool</li>
        <li>create new teams and propose plans, which wait in the app for you to accept</li>
      </ul>
      <p className="footnote">It runs on your {name} subscription; Frontier Brain never sees your password or payment details. You can disconnect any time from {name}.</p>
      <div className="button-row"><button className="primary" disabled={busy} onClick={()=>void decide(true)}>Allow</button><button disabled={busy} onClick={()=>void decide(false)}>Deny</button></div></>}
  </div></main>;
}
