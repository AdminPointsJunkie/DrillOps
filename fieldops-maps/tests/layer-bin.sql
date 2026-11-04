-- Transaction-only integration test. Run after the layer_recycle_bin migration.
begin;
insert into auth.users(id) values ('df000000-0000-4000-8000-000000000001'),('df000000-0000-4000-8000-000000000002');
insert into public.workspaces(id,name) values ('df000000-0000-4000-8000-000000000010','Bin QA'),('df000000-0000-4000-8000-000000000011','Other QA');
insert into public.workspace_members(workspace_id,user_id,role) values ('df000000-0000-4000-8000-000000000010','df000000-0000-4000-8000-000000000001','owner'),('df000000-0000-4000-8000-000000000011','df000000-0000-4000-8000-000000000002','owner');
select set_config('request.jwt.claim.sub','df000000-0000-4000-8000-000000000001',true);
insert into public.maps(id,workspace_id,owner_id,name,layer_layout) values
 ('df000000-0000-4000-8000-000000000020','df000000-0000-4000-8000-000000000010','df000000-0000-4000-8000-000000000001','Source','[{"id":"group","name":"Survey","children":["df000000-0000-4000-8000-000000000030","df000000-0000-4000-8000-000000000031"]}]'),
 ('df000000-0000-4000-8000-000000000021','df000000-0000-4000-8000-000000000010','df000000-0000-4000-8000-000000000001','Destination','[]'),
 ('df000000-0000-4000-8000-000000000022','df000000-0000-4000-8000-000000000011','df000000-0000-4000-8000-000000000002','Other','[]');
insert into public.layers(id,map_id,name,kind,source_crs,vertical_datum,metadata,color,opacity,visible) values
 ('df000000-0000-4000-8000-000000000030','df000000-0000-4000-8000-000000000020','Remove me','vector','EPSG:4326','Unknown','{"style":{"color":"red"}}','#ff0000',0.8,true),
 ('df000000-0000-4000-8000-000000000031','df000000-0000-4000-8000-000000000020','Keep me','vector','EPSG:4326','Unknown','{}','#00ff00',0.8,true);
insert into public.features(layer_id,geometry,properties) values ('df000000-0000-4000-8000-000000000030','0101000020E610000000000000002063400000000000003BC0','{"name":"A","_fieldmaps_files":[]}');
set local role authenticated;
select public.maps_layer_bin('df000000-0000-4000-8000-000000000010','trash','df000000-0000-4000-8000-000000000030');
reset role;
do $$declare result jsonb;begin
 assert not exists(select 1 from public.layers where id='df000000-0000-4000-8000-000000000030');
 assert not exists(select 1 from public.features where layer_id='df000000-0000-4000-8000-000000000030');
 assert (select layer_layout->0->'children' from public.maps where id='df000000-0000-4000-8000-000000000020')='["df000000-0000-4000-8000-000000000031"]'::jsonb;
 assert jsonb_array_length(public.maps_layer_bin('df000000-0000-4000-8000-000000000010','list'))=1;
 assert (select expires_at-deleted_at from maps_private.layer_trash where id='df000000-0000-4000-8000-000000000030')=interval '30 days';
 select public.sync_map(id,'df000000-0000-4000-8000-000000000040',draft_revision,'{}') into result from public.maps where id='df000000-0000-4000-8000-000000000020';
 assert (select jsonb_array_length(manifest->'layers') from public.map_releases where id='df000000-0000-4000-8000-000000000040')=1;
 assert (select manifest->'layers'->0->>'name' from public.map_releases where id='df000000-0000-4000-8000-000000000040')='Keep me';
 begin perform public.maps_layer_bin('df000000-0000-4000-8000-000000000010','restore','df000000-0000-4000-8000-000000000030','df000000-0000-4000-8000-000000000022');raise exception 'Cross-workspace restore was allowed';exception when insufficient_privilege then null;end;
end $$;
select public.maps_layer_bin('df000000-0000-4000-8000-000000000010','restore','df000000-0000-4000-8000-000000000030','df000000-0000-4000-8000-000000000021');
do $$begin
 assert (select map_id from public.layers where id='df000000-0000-4000-8000-000000000030')='df000000-0000-4000-8000-000000000021'::uuid;
 assert (select properties->>'name' from public.features where layer_id='df000000-0000-4000-8000-000000000030')='A';
 assert (select metadata->'style'->>'color' from public.layers where id='df000000-0000-4000-8000-000000000030')='red';
 assert (select layer_layout from public.maps where id='df000000-0000-4000-8000-000000000021')='["df000000-0000-4000-8000-000000000030"]'::jsonb;
 assert not exists(select 1 from maps_private.layer_trash where id='df000000-0000-4000-8000-000000000030');
end $$;
set local role authenticated;
select public.maps_layer_bin('df000000-0000-4000-8000-000000000010','trash','df000000-0000-4000-8000-000000000030');
reset role;
select set_config('request.jwt.claim.sub','df000000-0000-4000-8000-000000000002',true);
do $$begin
 begin perform public.maps_layer_bin('df000000-0000-4000-8000-000000000010','list');raise exception 'Cross-workspace access allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','df000000-0000-4000-8000-000000000001',true);
update maps_private.layer_trash set expires_at=now()-interval '1 second' where id='df000000-0000-4000-8000-000000000030';
do $$begin
 begin perform public.maps_layer_bin('df000000-0000-4000-8000-000000000010','restore','df000000-0000-4000-8000-000000000030');raise exception 'Expired item restored';exception when raise_exception then if sqlerrm<>'The 30-day restore period has expired' then raise;end if;end;
 assert maps_private.purge_expired_layers()>=1;
 assert not exists(select 1 from maps_private.layer_trash where id='df000000-0000-4000-8000-000000000030');
 assert exists(select 1 from public.layers where id='df000000-0000-4000-8000-000000000031');
 assert not has_table_privilege('authenticated','maps_private.layer_trash','select');
 assert not has_function_privilege('anon','public.maps_layer_bin(uuid,text,uuid,uuid)','execute');
 assert not has_function_privilege('authenticated','maps_private.purge_expired_layers()','execute');
end $$;
rollback;
