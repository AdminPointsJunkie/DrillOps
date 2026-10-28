-- Run after the company-workspaces migration, inside a transaction that is rolled back.
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 ('eeb0cc03-b303-4a01-a101-000000000001','ws-owner-a@example.invalid',now(),'{"maps_role":"admin"}'),
 ('eeb0cc03-b303-4a01-a101-000000000002','ws-editor-a@example.invalid',now(),'{"maps_role":"admin"}'),
 ('eeb0cc03-b303-4a01-a101-000000000003','ws-operator-a@example.invalid',now(),'{"maps_role":"admin"}'),
 ('eeb0cc03-b303-4a01-a101-000000000004','ws-owner-b@example.invalid',now(),'{"maps_role":"admin"}'),
 ('eeb0cc03-b303-4a01-a101-000000000005','ws-outsider@example.invalid',now(),'{"maps_role":"admin"}');
insert into public.workspaces(id,name) values ('eeb0cc03-b303-4a01-a101-000000000010','Workspace A'),('eeb0cc03-b303-4a01-a101-000000000011','Workspace B');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000001','owner'),
 ('eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000002','editor'),
 ('eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000003','operator'),
 ('eeb0cc03-b303-4a01-a101-000000000011','eeb0cc03-b303-4a01-a101-000000000004','owner'),
 ('eeb0cc03-b303-4a01-a101-000000000011','eeb0cc03-b303-4a01-a101-000000000003','editor');
insert into public.maps(id,name,owner_id,workspace_id) values
 ('eeb0cc03-b303-4a01-a101-000000000020','A assigned','eeb0cc03-b303-4a01-a101-000000000002','eeb0cc03-b303-4a01-a101-000000000010'),
 ('eeb0cc03-b303-4a01-a101-000000000021','B private','eeb0cc03-b303-4a01-a101-000000000004','eeb0cc03-b303-4a01-a101-000000000011'),
 ('eeb0cc03-b303-4a01-a101-000000000022','A private','eeb0cc03-b303-4a01-a101-000000000001','eeb0cc03-b303-4a01-a101-000000000010');
insert into public.project_members values('eeb0cc03-b303-4a01-a101-000000000020','eeb0cc03-b303-4a01-a101-000000000003');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001","app_metadata":{"maps_role":"admin"}}',true);
do $$ declare l uuid;rev bigint;begin
 assert not public.maps_admin();assert (select count(*) from public.maps)=2;
 assert jsonb_array_length(public.workspace_context()->'workspaces')=1;
 begin perform public.workspace_settings('eeb0cc03-b303-4a01-a101-000000000011');raise exception 'Cross company admin allowed';exception when insufficient_privilege then null;end;
 begin perform public.maps_accounts();raise exception 'Legacy global account API allowed';exception when insufficient_privilege then null;end;
 begin perform public.workspace_mutate(null,'create','{"name":"Illegal"}');raise exception 'Company owner created platform workspace';exception when insufficient_privilege then null;end;
 begin perform public.workspace_mutate('eeb0cc03-b303-4a01-a101-000000000010','member','{"user_id":"eeb0cc03-b303-4a01-a101-000000000002","role":"editor","status":"active","projects":["eeb0cc03-b303-4a01-a101-000000000021"]}');raise exception 'Foreign project assignment allowed';exception when insufficient_privilege then null;end;
 begin update public.maps set workspace_id='eeb0cc03-b303-4a01-a101-000000000011' where id='eeb0cc03-b303-4a01-a101-000000000020';raise exception 'Project tenant move allowed';exception when insufficient_privilege then null;end;
 l:=public.import_vector('{"map_id":"eeb0cc03-b303-4a01-a101-000000000020","name":"Geometry","source_crs":"EPSG:4326"}','[{"type":"Feature","geometry":{"type":"Point","coordinates":[148,-22]},"properties":{"name":"test"}}]');
 update public.maps set layer_layout=jsonb_build_array(l::text) where id='eeb0cc03-b303-4a01-a101-000000000020';
 select draft_revision into rev from public.maps where id='eeb0cc03-b303-4a01-a101-000000000020';perform public.sync_map('eeb0cc03-b303-4a01-a101-000000000020',gen_random_uuid(),rev,'{}');
 perform public.workspace_mutate('eeb0cc03-b303-4a01-a101-000000000010','invite','{"email":"ws-outsider@example.invalid","name":"Invite test","role":"operator","projects":["eeb0cc03-b303-4a01-a101-000000000020"]}');
end $$;
-- Simulate successful delivery without sending any email.
reset role;
update public.workspace_invitations set delivery='sent',last_sent_at=now() where email='ws-outsider@example.invalid';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000002","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin
 assert (select count(*) from public.maps)=1;
 begin perform public.workspace_settings('eeb0cc03-b303-4a01-a101-000000000010');raise exception 'Editor administrated workspace';exception when insufficient_privilege then null;end;
 begin insert into public.workspace_members(workspace_id,user_id,role) values('eeb0cc03-b303-4a01-a101-000000000011',auth.uid(),'owner');raise exception 'Self escalation allowed';exception when insufficient_privilege then null;end;
 begin perform public.import_vector('{"map_id":"eeb0cc03-b303-4a01-a101-000000000021","name":"Intrusion","source_crs":"EPSG:4326"}','[{"geometry":{"type":"Point","coordinates":[148,-22]}}]');raise exception 'Cross company import allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin
 assert (select count(*) from public.maps)=0;assert (select count(*) from public.layers)=0;
 assert jsonb_array_length(public.maps_published_projects())=1;
 assert (select count(*) from public.map_releases)=1;
 begin perform public.import_vector('{"map_id":"eeb0cc03-b303-4a01-a101-000000000020","name":"Operator write","source_crs":"EPSG:4326"}','[{"geometry":{"type":"Point","coordinates":[148,-22]}}]');raise exception 'Operator wrote drafts';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000005","app_metadata":{"maps_role":"admin"}}',true);
do $$ declare invite uuid;begin
 assert (select count(*) from public.maps)=0;assert (select count(*) from public.map_releases)=0;assert jsonb_array_length(public.workspace_context()->'workspaces')=0;
 select (public.workspace_context()->'invitations'->0->>'id')::uuid into invite;
 assert invite is not null;
 perform public.workspace_mutate(null,'accept',jsonb_build_object('id',invite));
 assert jsonb_array_length(public.maps_published_projects())=1;assert (select count(*) from public.maps)=0;
end $$;
-- Revocation takes effect without refreshing the user's deliberately stale admin JWT.
reset role;
update public.workspace_members set status='suspended' where workspace_id='eeb0cc03-b303-4a01-a101-000000000010' and user_id='eeb0cc03-b303-4a01-a101-000000000005';
set local role authenticated;
do $$ begin assert jsonb_array_length(public.maps_published_projects())=0;assert (select count(*) from public.map_releases)=0;end $$;
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.workspace_context()','execute');
 assert not has_function_privilege('authenticated','public.workspace_invitation_delivery(uuid,uuid,boolean)','execute');
 assert not has_table_privilege('authenticated','public.workspace_members','insert');
 assert not has_table_privilege('authenticated','public.maps','truncate');
end $$;
-- Storage metadata is synthetic and rolled back; no files or emails are created.
reset role;
insert into storage.objects(bucket_id,name) values
 ('gis-files','eeb0cc03-b303-4a01-a101-000000000001/qa/private.png'),
 ('gis-files','eeb0cc03-b303-4a01-a101-000000000001/sync/qa/published.png');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001"}',true);
insert into public.layers(id,map_id,name,kind,source_crs,raster_path,original_paths) values('eeb0cc03-b303-4a01-a101-000000000030','eeb0cc03-b303-4a01-a101-000000000020','Private raster','raster','EPSG:4326','eeb0cc03-b303-4a01-a101-000000000001/qa/private.png','["eeb0cc03-b303-4a01-a101-000000000001/qa/private.png"]');
insert into public.map_releases(id,map_id,version,source_revision,manifest,raster_paths) values(gen_random_uuid(),'eeb0cc03-b303-4a01-a101-000000000020',2,999,'{"project":{"id":"eeb0cc03-b303-4a01-a101-000000000020","name":"Synthetic release"},"layers":[]}',array['eeb0cc03-b303-4a01-a101-000000000001/sync/qa/published.png']);
do $$ begin
 assert maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000001/qa/private.png');
 assert not maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000001/sync/qa/published.png',true);
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000004","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin
 assert (select count(*) from public.maps)=1;
 assert not maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000001/qa/private.png');
 assert (select count(*) from storage.objects where name='eeb0cc03-b303-4a01-a101-000000000001/qa/private.png')=0;
 begin insert into public.layers(map_id,name,kind,source_crs,raster_path) values('eeb0cc03-b303-4a01-a101-000000000021','Stolen image','raster','EPSG:4326','eeb0cc03-b303-4a01-a101-000000000001/qa/private.png');raise exception 'Foreign file attached';exception when insufficient_privilege then null;end;
 begin insert into public.map_releases(id,map_id,version,source_revision,manifest,raster_paths) values(gen_random_uuid(),'eeb0cc03-b303-4a01-a101-000000000021',1,1,'{}',array['eeb0cc03-b303-4a01-a101-000000000001/qa/private.png']);raise exception 'Foreign file published';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003"}',true);
do $$ begin
 assert not maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000001/qa/private.png');
 assert maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000001/sync/qa/published.png');
 assert (select count(*) from storage.objects where name='eeb0cc03-b303-4a01-a101-000000000001/sync/qa/published.png')=1;
end $$;
reset role;
-- Platform administrator seed and protected owner guard.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where lower(email)='oleary.john@icloud.com'))::text,true);
set local role authenticated;
do $$ declare result jsonb;begin
 assert public.maps_admin();assert (public.workspace_context()->>'platform_admin')::boolean;
 result:=public.workspace_mutate(null,'create','{"name":"Temporary platform company"}');assert (result->>'id') is not null;
 assert public.workspace_settings((result->>'id')::uuid)->'people'->0->>'role'='owner';
end $$;
reset role;
-- Invitation dispatch authorization, delivery and revocation (no email transport).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001"}',true);
do $$ declare invitation uuid;attempt jsonb;begin
 invitation:=(public.workspace_mutate('eeb0cc03-b303-4a01-a101-000000000010','invite','{"email":"new-ws-member@example.invalid","name":"New","role":"operator"}')->>'id')::uuid;
 attempt:=public.workspace_invitation_dispatch(invitation);
 assert attempt->>'email'='new-ws-member@example.invalid';assert attempt->>'attempt' is not null;
 begin perform public.workspace_invitation_dispatch(invitation);raise exception 'Rate limit failed' using errcode='23514';exception when raise_exception then null;end;
 perform public.workspace_mutate('eeb0cc03-b303-4a01-a101-000000000010','revoke',jsonb_build_object('id',invitation));
 begin perform public.workspace_invitation_dispatch(invitation);raise exception 'Revoked invitation sent' using errcode='23514';exception when raise_exception then null;end;
end $$;
reset role;
