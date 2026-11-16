import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';import {openProjectSharing} from '../src/project-sharing.js';
const migration=readFileSync(new URL('../supabase/migrations/20261116214355_automatic_project_invitations.sql',import.meta.url),'utf8');
test('sharing opens above project home without any loaded map',async()=>{const dom=new JSDOM('<body class="project-home-open"><section class="project-home"></section></body>');global.document=dom.window.document;let modal=0;dom.window.HTMLDialogElement.prototype.showModal=function(){modal++;this.open=true;};dom.window.HTMLDialogElement.prototype.show=function(){assert.fail('Non-modal sharing');};try{const calls=[];const d=await openProjectSharing({db:{rpc:async(n,a)=>{calls.push(a);return {data:[]};}},project:{id:'w',name:'Argo NR'}});assert.equal(modal,1);assert.equal(d.open,true);assert.equal(calls[0].p_target,'w');}finally{delete global.document;dom.window.close();}});
test('automatic invitations require verified recipients and preserve existing access',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create schema maps_private;
 create table auth.users(id uuid primary key default gen_random_uuid(),email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
 create table workspaces(id uuid primary key default gen_random_uuid(),status text default 'active');
 create table workspace_members(workspace_id uuid,user_id uuid,role text,status text default 'active',display_name text,primary key(workspace_id,user_id));
 create table maps(id uuid primary key default gen_random_uuid(),workspace_id uuid);create table project_members(map_id uuid,user_id uuid,primary key(map_id,user_id));
 create table workspace_invitations(id uuid primary key default gen_random_uuid(),workspace_id uuid,email text,name text default '',role text default 'operator',projects uuid[] default '{}',status text default 'pending',delivery text default 'not_sent',expires_at timestamptz default now()+interval '7 days',accepted_by uuid,created_by uuid);
 create table workspace_events(workspace_id uuid,actor_id uuid,action text,detail jsonb);`);await db.exec(migration);
 const w=(await db.query('insert into workspaces default values returning id')).rows[0].id;
 const user=async(email,v=true)=>(await db.query('insert into auth.users(email,email_confirmed_at) values($1,case when $2 then now() end) returning id',[email,v])).rows[0].id;
 const invite=async(email,delivery='sent',role='operator')=>(await db.query('insert into workspace_invitations(workspace_id,email,delivery,role) values($1,$2,$3,$4) returning id',[w,email,delivery,role])).rows[0].id;
 const member=async id=>(await db.query('select * from workspace_members where user_id=$1',[id])).rows;
 const existing=await user('existing@test');await invite('existing@test');assert.equal((await member(existing))[0].role,'operator');
 const fresh=await user('new@test',false),pending=await invite('new@test');assert.equal((await member(fresh)).length,0);await db.query('update auth.users set email_confirmed_at=now() where id=$1',[fresh]);assert.equal((await member(fresh)).length,1);assert.equal((await db.query('select status from workspace_invitations where id=$1',[pending])).rows[0].status,'accepted');
 const other=await user('other@test');await invite('different@test');await db.query('update auth.users set last_sign_in_at=now() where id=$1',[other]);assert.equal((await member(other)).length,0);
 for(const mode of ['failed','not_sent','revoked','expired','banned','deleted','anonymous','inactive','owner']){
 const id=await user(mode+'@test',false),inv=await invite(mode+'@test','not_sent',mode==='owner'?'owner':'editor');
 if(mode==='revoked')await db.query("update workspace_invitations set status='revoked' where id=$1",[inv]);
 if(mode==='expired')await db.query("update workspace_invitations set expires_at=now()-interval '1 second' where id=$1",[inv]);
 if(mode==='banned')await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[id]);
 if(mode==='deleted')await db.query('update auth.users set deleted_at=now() where id=$1',[id]);
 if(mode==='anonymous')await db.query('update auth.users set is_anonymous=true where id=$1',[id]);
 if(mode==='inactive')await db.query("update workspaces set status='suspended' where id=$1",[w]);
 await db.query('update workspace_invitations set delivery=$1 where id=$2',[['failed','not_sent'].includes(mode)?mode:'sent',inv]);await db.query('update auth.users set email_confirmed_at=now(),last_sign_in_at=now() where id=$1',[id]);assert.equal((await member(id)).length,0,mode);
 if(mode==='inactive'){await db.query("update workspace_invitations set status='revoked' where id=$1",[inv]);await db.query("update workspaces set status='active' where id=$1",[w]);}}
 const suspended=await user('suspended@test');await db.query("insert into workspace_members values($1,$2,'operator','suspended','')",[w,suspended]);await invite('suspended@test','sent','admin');assert.equal((await member(suspended))[0].status,'suspended');assert.equal((await member(suspended))[0].role,'operator');
 await invite('existing@test','sent','admin');assert.equal((await member(existing))[0].role,'operator');
 const count=async()=>(await db.query('select count(*)::int as n from workspace_events')).rows[0].n,events=await count();await db.query('update auth.users set last_sign_in_at=now() where id=$1',[existing]);assert.equal(await count(),events);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'maps_private.enroll_project_invitation(uuid)','EXECUTE') as ok",[role])).rows[0].ok,false);
 await db.close();});
