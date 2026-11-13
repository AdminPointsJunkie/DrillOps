begin;
do $$ declare w uuid;u uuid;sid uuid;m uuid:=gen_random_uuid();p text;r jsonb;denied boolean:=false;begin
 select wm.workspace_id,wm.user_id,a.session_id into w,u,sid from public.workspace_members wm join maps_private.fieldmaps_active_sessions a on a.user_id=wm.user_id join maps_private.drillops_access d on d.user_id=wm.user_id where wm.role='owner' and wm.status='active' and d.active and 'fieldmaps'=any(d.apps) limit 1;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
 insert into public.maps(id,owner_id,workspace_id,name) values(m,u,w,'Supporting action verification');
 for n in 1..3 loop
 p:=u::text||'/'||m::text||'/supporting/'||n||'.pdf';
 insert into maps_private.file_accounts values(p,w,u);
 insert into storage.objects(bucket_id,name,metadata) values('gis-files',p,'{"size":3}');
 r:=public.maps_supporting_file(m,'add',jsonb_build_object('path',p,'name',n||'.pdf','size',3,'group','Plans'));
 end loop;
 p:=r->0->>'path';r:=public.maps_supporting_file(m,'rename',jsonb_build_object('path',p,'name','Renamed.pdf'));
 if r->0->>'name'<>'Renamed.pdf' or r->0->>'path'<>p then raise exception 'Rename failed';end if;
 r:=public.maps_supporting_file(m,'move',jsonb_build_object('path',p,'group','Other','before',r->2->>'path'));
 if r->1->>'path'<>p or r->1->>'group'<>'Other' then raise exception 'Move failed';end if;
 r:=public.maps_supporting_file(m,'rename_group','{"previous":"Other","group":""}');
 if r->1->>'group'<>'' then raise exception 'Ungroup failed';end if;
 r:=public.maps_supporting_file(m,'remove_group','{"previous":"Plans"}');
 if jsonb_array_length(r)<>1 or r->0->>'path'<>p then raise exception 'Group removal failed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.maps_supporting_file(m,'rename',jsonb_build_object('path',p,'name','Denied.pdf'));exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unauthorized edit allowed';end if;
end $$;
select 'PASS: rename, order, group move, ungroup, group removal, authorization' as result;
rollback;
