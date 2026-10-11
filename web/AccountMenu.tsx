import {User} from 'pixelarticons/react';
import {useAccount} from './auth.tsx';

// The avatar in the header opens Settings (#account): account, Showdown name, AI key and backups.
export default function AccountMenu(_:{profile?:any;reload?:()=>Promise<void>;notify?:(text:string,error?:boolean)=>void}){
  const account=useAccount();const label=account.kind==='account'?account.email:account.kind==='guest'?'Guest':'Settings';
  return <div className="account-menu"><a className="account-button" href="#account" aria-label={`Settings (${label})`}>
    <span className={'avatar'+(account.kind==='account'?'':' guest')} aria-hidden="true">{account.kind==='account'?(account.email[0]??'?').toUpperCase():<User width={16} height={16}/>}</span>
    <span>{account.kind==='account'?'Settings':account.kind==='guest'?'Guest':'Settings'}</span></a></div>;
}
