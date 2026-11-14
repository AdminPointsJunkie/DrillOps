begin;
do $$ declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();s uuid:=gen_random_uuid();w uuid;other uuid;begin
 insert into auth.users(id,email,email_confirmed_at) values(a,a::text||'@example.invalid',now()),(b,b::text||'@example.invalid',now());
 insert into auth.sessions(id,user_id,user_agent) values(s,a,'Windows desktop');
 insert into maps_private.drillops_access(user_id,apps,active) values(a,array['fieldmaps'],true) on conflict(user_id) do update set apps=excluded.apps,active=true;
 perform set_config('request.jwt.claim.sub',a::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',s)::text,true);
 w:=public.create_personal_project('Account usage fixture');
 insert into public.workspaces(name,owner_id) values('Shared, owned by someone else',b) returning id into other;
 insert into public.workspace_members(workspace_id,user_id,role) values(other,b,'owner'),(other,a,'admin'),(w,b,'editor');
 insert into public.maps(owner_id,workspace_id,name) values(b,w,'Created by a member, billed to project owner'),(b,other,'Must not be billed to invited admin');
 perform set_config('test.owned',w::text,true);perform set_config('test.other',other::text,true);perform set_config('test.other_user',b::text,true);
end $$;
set constraints all immediate;
set local role authenticated;
do $$ declare result jsonb;w uuid:=current_setting('test.owned')::uuid;begin
 result:=public.account_usage();
 assert jsonb_array_length(result->'projects')=1,'shared project leaked into account usage';
 assert result->'projects'->0->>'id'=w::text;
 assert (result->>'map_count')::integer=1,'member-created map not counted against owner';
 assert maps_private.ws_role(w)='owner' and maps_private.ws_manage(w),'owner lacks full control';
 begin
  perform public.workspace_mutate(w,'invite',jsonb_build_object('email','another@example.invalid','role','owner','name','Another'));
  raise exception 'Second owner invitation allowed';
 exception when check_violation then null;end;
 assert not has_function_privilege('anon','public.account_usage()','execute');
end $$;
reset role;
do $$ declare w uuid:=current_setting('test.owned')::uuid;begin
 begin update public.workspaces set owner_id=null where id=w;raise exception 'Null owner allowed';exception when not_null_violation then null;end;
 begin update public.workspace_members set status='suspended' where workspace_id=w and role='owner';raise exception 'Owner suspended';exception when check_violation then null;end;
 begin delete from public.workspace_members where workspace_id=w and role='owner';raise exception 'Owner removed';exception when check_violation then null;end;
 begin update public.workspace_members set role='admin' where workspace_id=w and role='owner';raise exception 'Owner demoted';exception when check_violation then null;end;
 begin update public.workspaces set owner_id=current_setting('test.other_user')::uuid where id=w;raise exception 'Unmatched owner accepted';exception when check_violation then null;end;
 begin update public.workspace_members set role='owner' where workspace_id=w and user_id=current_setting('test.other_user')::uuid;raise exception 'Second owner accepted';exception when unique_violation then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.other_user'),true);
do $$ begin begin perform public.account_usage();raise exception 'Inactive session reported usage';exception when insufficient_privilege then null;end;end $$;
select 'PASS: project owner invariant, full access, member-created map attribution, shared-project exclusion, unauthorised access' as result;
rollback;
