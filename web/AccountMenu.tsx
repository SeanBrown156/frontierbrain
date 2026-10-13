import {User} from './icons.tsx';
import {useAccount} from './auth.tsx';
import {InboxLink} from './Inbox.tsx';

// The avatar in the header opens Settings (#account): account, Showdown name, AI key and backups.
export default function AccountMenu({inbox=0}:{profile?:any;reload?:()=>Promise<void>;notify?:(text:string,error?:boolean)=>void;inbox?:number}){
  const account=useAccount();const label=account.kind==='account'?account.email:account.kind==='guest'?'Guest':'Settings';
  return <div className="account-menu"><InboxLink count={inbox}/><a className="account-button" href="#account" aria-label={`Account and settings (${label})`}>
    <span className={'avatar'+(account.kind==='account'?'':' guest')} aria-hidden="true">{account.kind==='account'?(account.email[0]??'?').toUpperCase():<User width={14} height={14} strokeWidth={2}/>}</span>
    <span>{account.kind==='guest'?'Guest':'Account'}</span></a></div>;
}
