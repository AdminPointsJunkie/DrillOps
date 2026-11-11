-- Run inside a transaction with the migration; always roll back fixtures.
insert into auth.users(id,email,email_confirmed_at) values
 ('eef41111-1111-4111-a111-000000000001','hierarchy-owner@example.invalid',now()),
 ('eef41111-1111-4111-a111-000000000002','hierarchy-viewer@example.invalid',now()),
 ('eef41111-1111-4111-a111-000000000003','hierarchy-editor@example.invalid',now());
insert into maps_private.drillops_access(user_id,apps,active) values
 ('eef41111-1111-4111-a111-000000000001',array['fieldmaps'],true),
 ('eef41111-1111-4111-a111-000000000002',array['fieldmaps'],true),
 ('eef41111-1111-4111-a111-000000000003',array['fieldmaps'],true)
on conflict(user_id) do update set apps=excluded.apps,active=true;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000001"}',true);
select set_config('test.project',public.create_personal_project('Hierarchy test')::text,true);
do $$ declare a uuid;b uuid;rev bigint;begin
 assert (select count(*) from public.personal_workspaces)=1,'Personal workspace leaked';
 insert into public.maps(name,owner_id,workspace_id) values('Shared map',auth.uid(),current_setting('test.project')::uuid) returning id into a;
 insert into public.maps(name,owner_id,workspace_id) values('Private sibling',auth.uid(),current_setting('test.project')::uuid) returning id into b;
 perform set_config('test.map',a::text,true);perform set_config('test.sibling',b::text,true);
 select draft_revision into rev from public.maps where id=a;perform public.sync_map(a,gen_random_uuid(),rev,'{}');
 select draft_revision into rev from public.maps where id=b;perform public.sync_map(b,gen_random_uuid(),rev,'{}');
 perform public.share_access('map',a,'grant','hierarchy-viewer@example.invalid');
 perform public.share_access('project',current_setting('test.project')::uuid,'grant','hierarchy-editor@example.invalid',null,'editor');
 perform public.share_access('map',a,'grant','hierarchy-editor@example.invalid');
 assert (public.workspace_context()->'workspaces'->0->>'share_count')::integer=2,'Sharing count duplicated recipient';
end $$;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000002"}',true);
do $$ declare ctx jsonb;begin
 assert (select count(*) from public.personal_workspaces)=1;
 ctx:=public.workspace_context();assert jsonb_array_length(ctx->'workspaces')=1;
 assert ctx->'workspaces'->0->>'access'='map';
 assert ctx->'workspaces'->0->>'share_count' is null,'Recipient saw private membership count';
 assert ctx->'workspaces'->0->>'preview_map_id' is null,'Viewer received draft thumbnail';
 assert (select count(*) from public.maps)=0,'Map viewer received draft access';
 assert (select count(*) from public.layers)=0;
 assert jsonb_array_length(public.maps_published_projects())=1,'Sibling map leaked';
 assert (select count(*) from public.map_releases)=1,'Sibling release leaked';
 assert not maps_private.ws_project(current_setting('test.map')::uuid);
 assert not maps_private.ws_project(current_setting('test.sibling')::uuid,true);
 begin perform public.share_access('project',current_setting('test.project')::uuid,'list');raise exception 'Viewer listed project members';exception when insufficient_privilege then null;end;
 begin perform public.share_access('map',current_setting('test.map')::uuid,'grant','hierarchy-editor@example.invalid');raise exception 'Viewer reshared map';exception when insufficient_privilege then null;end;
 begin insert into public.map_view_links(map_id) values(current_setting('test.map')::uuid);raise exception 'Viewer created public link';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000003"}',true);
do $$ begin
 assert (select count(*) from public.maps)=2,'Project editor missing sibling';
 assert jsonb_array_length(public.maps_published_projects())=2;
 perform public.import_vector(jsonb_build_object('map_id',current_setting('test.sibling'),'name','Editor layer','source_crs','EPSG:4326'),'[{"type":"Feature","geometry":{"type":"Point","coordinates":[148,-22]},"properties":{}}]');
end $$;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000001"}',true);
select public.share_access('map',current_setting('test.map')::uuid,'revoke',null,'eef41111-1111-4111-a111-000000000002');
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000002"}',true);
do $$ begin
 assert jsonb_array_length(public.maps_published_projects())=0,'Revoked viewer retained access';
 assert jsonb_array_length(public.workspace_context()->'workspaces')=0,'Revoked parent remained visible';
end $$;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000001"}',true);
select public.share_access('project',current_setting('test.project')::uuid,'grant','hierarchy-viewer@example.invalid');
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000002"}',true);
do $$ begin assert jsonb_array_length(public.maps_published_projects())=2,'Project viewer cannot see all maps';assert (select count(*) from public.maps)=0;end $$;
reset role;
update public.workspace_members set status='suspended' where workspace_id=current_setting('test.project')::uuid and user_id='eef41111-1111-4111-a111-000000000002';
set local role authenticated;
do $$ begin assert jsonb_array_length(public.maps_published_projects())=0,'Suspended member retained access';end $$;
reset role;
do $$ begin
 assert not has_function_privilege('anon','public.share_access(text,uuid,text,text,uuid,text)','execute');
 assert not has_function_privilege('anon','public.create_personal_project(text)','execute');
 assert not has_table_privilege('authenticated','public.map_shares','insert');
end $$;
