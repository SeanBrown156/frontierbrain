import {test} from 'node:test';
import assert from 'node:assert/strict';
import {staleGuests} from '../guest-cleanup.ts';

const DAY=86_400_000,now=Date.parse('2026-11-01T00:00:00Z');
const ago=(d:number)=>new Date(now-d*DAY).toISOString();
test('guest cleanup: only anonymous users with no email or identity who have not been seen for the window',()=>{
  const users=[
    {id:'old-guest',is_anonymous:true,email:null,created_at:ago(60),last_sign_in_at:ago(45)},
    {id:'recent-guest',is_anonymous:true,created_at:ago(60),last_sign_in_at:ago(3)},
    {id:'never-signed-in-old',is_anonymous:true,created_at:ago(40),last_sign_in_at:null},
    {id:'never-signed-in-new',is_anonymous:true,created_at:ago(2),last_sign_in_at:null},
    {id:'account',is_anonymous:false,email:'a@b.c',created_at:ago(90),last_sign_in_at:ago(80)},
    {id:'upgraded',is_anonymous:true,email:'a@b.c',created_at:ago(90),last_sign_in_at:ago(80)},
    {id:'linked',is_anonymous:true,identities:[{}],created_at:ago(90),last_sign_in_at:ago(80)},
  ];
  assert.deepEqual(staleGuests(users,now,30).map(u=>u.id),['old-guest','never-signed-in-old']);
  assert.deepEqual(staleGuests(users,now,50).map(u=>u.id),[]);
});
