// Deletes stale guest sessions from the hosted site: anonymous users (no email, no linked identity) who have not been
// seen for DAYS days. Deleting the auth user cascades to their workspace and files. Signed-in accounts are never touched.
//   node tools/guest-cleanup.ts [--env .env.hosted] [--days 30] [--dry-run] [--max 500] [--force]
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY. Safety: dry runs list counts only (never ids or content); a run that would
// remove more than half of all accounts (once there are more than 20) stops unless --force.
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';

export interface AuthUser {id:string;is_anonymous?:boolean;email?:string|null;created_at?:string;last_sign_in_at?:string|null;identities?:unknown[]|null;}
const DAY=86_400_000;
// Pure: who is a stale guest. "Last seen" is the last sign-in, or creation when there never was one.
export function staleGuests(users:AuthUser[],now:number,days:number):AuthUser[]{
  return users.filter(u=>u.is_anonymous===true&&!u.email&&!(u.identities?.length)
    &&now-Date.parse(u.last_sign_in_at??u.created_at??'')>days*DAY);
}

async function main(){
  const args=process.argv.slice(2);const flag=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
  const env=flag('--env');if(env)process.loadEnvFile(resolve(env));
  const days=Number(flag('--days')??30),max=Number(flag('--max')??500),dry=args.includes('--dry-run'),force=args.includes('--force');
  if(!(days>=7))throw new Error('--days must be at least 7');
  const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const users:AuthUser[]=[];
  for(let page=1;;page++){const {data,error}=await db.auth.admin.listUsers({page,perPage:1000});if(error)throw error;
    users.push(...(data.users as AuthUser[]));if(data.users.length<1000)break;}
  const stale=staleGuests(users,Date.now(),days);
  const guests=users.filter(u=>u.is_anonymous).length;
  console.log(`${users.length} accounts: ${users.length-guests} signed in, ${guests} guests, ${stale.length} guests not seen for ${days}+ days.`);
  if(users.length>20&&stale.length>users.length/2&&!force)throw new Error(`Refusing to remove ${stale.length} of ${users.length} accounts in one run; check the numbers, then use --force.`);
  const batch=stale.slice(0,max);
  if(dry){console.log(`Dry run: would remove ${batch.length}.`);return;}
  let removed=0,failed=0;
  for(const u of batch){const {error}=await db.auth.admin.deleteUser(u.id);if(error)failed++;else removed++;}
  console.log(`Removed ${removed} stale guests${failed?`, ${failed} failed`:''}${stale.length>batch.length?`; ${stale.length-batch.length} left for the next run`:''}.`);
  if(failed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)main().catch(e=>{console.error((e as Error).message);process.exit(1);});
