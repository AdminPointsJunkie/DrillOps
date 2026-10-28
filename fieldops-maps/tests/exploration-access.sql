-- Run in a transaction and roll back: no real accounts or projects are changed.
begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('eeb0bb02-b202-4a01-a101-000000000001','annotation-admin@example.invalid','{"maps_role":"admin"}'),
 ('eeb0bb02-b202-4a01-a101-000000000002','annotation-editor@example.invalid','{"maps_role":"editor"}'),
 ('eeb0bb02-b202-4a01-a101-000000000003','annotation-operator@example.invalid','{"maps_role":"operator"}'),
 ('eeb0bb02-b202-4a01-a101-000000000004','annotation-unassigned@example.invalid','{"maps_role":"operator"}');
insert into public.maps(id,owner_id,name) values ('eeb0bb02-b202-4a01-a101-000000000005','eeb0bb02-b202-4a01-a101-000000000002','Exploration QA');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0bb02-b202-4a01-a101-000000000001"}',true);
do $$ declare layer_id uuid; begin
 layer_id:=public.import_vector('{"map_id":"eeb0bb02-b202-4a01-a101-000000000005","name":"Access note","kind":"vector","source_crs":"EPSG:4326","color":"#ce6359","metadata":{"annotation":{"type":"note"},"style":{"view":{"filter":{"match":"all","conditions":[]}},"popup":{"titleField":"note"}}}}', '[{"type":"Feature","geometry":{"type":"Point","coordinates":[148,-22]},"properties":{"note":"South gate"}}]');
 update public.maps set layer_layout=jsonb_build_array(layer_id::text) where id='eeb0bb02-b202-4a01-a101-000000000005';
 insert into public.map_operators(map_id,user_id) values('eeb0bb02-b202-4a01-a101-000000000005','eeb0bb02-b202-4a01-a101-000000000003');
end $$;
-- Editor owns this map, but cannot edit admin annotations, even using stale admin JWT claims.
select set_config('request.jwt.claims','{"sub":"eeb0bb02-b202-4a01-a101-000000000002","app_metadata":{"maps_role":"admin"}}',true);
do $$ declare l uuid; revision bigint; result jsonb; begin
 select id into l from public.layers where map_id='eeb0bb02-b202-4a01-a101-000000000005';
 begin update public.layers set metadata='{}' where id=l;raise exception 'Editor removed annotation protection';exception when insufficient_privilege then null;end;
 begin update public.features set properties='{"note":"Changed"}' where layer_id=l;raise exception 'Editor changed annotation';exception when insufficient_privilege then null;end;
 begin delete from public.layers where id=l;raise exception 'Editor deleted annotation';exception when insufficient_privilege then null;end;
 begin perform public.import_vector('{"map_id":"eeb0bb02-b202-4a01-a101-000000000005","name":"Bad note","kind":"vector","source_crs":"EPSG:4326","metadata":{"annotation":{"type":"note"}}}', '[{"type":"Feature","geometry":{"type":"Point","coordinates":[148,-22]},"properties":{}}]');raise exception 'Editor created annotation';exception when insufficient_privilege then null;end;
 select draft_revision into revision from public.maps where id='eeb0bb02-b202-4a01-a101-000000000005';
 result:=public.sync_map('eeb0bb02-b202-4a01-a101-000000000005',gen_random_uuid(),revision,'{}');
 assert (select manifest->'layers'->0->'metadata'->'annotation'->>'type' from public.map_releases where id=(result->>'id')::uuid)='note';
 assert (select manifest->'layers'->0->'metadata'->'style'->'popup'->>'titleField' from public.map_releases where id=(result->>'id')::uuid)='note';
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0bb02-b202-4a01-a101-000000000003"}',true);
do $$ begin
 assert jsonb_array_length(public.maps_published_projects())=1;
 assert (select count(*) from public.layers)=0;
 assert (select manifest->'layers'->0->'fc'->'features'->0->'properties'->>'note' from public.map_releases)='South gate';
 begin insert into public.layers(map_id,name,kind,source_crs) values('eeb0bb02-b202-4a01-a101-000000000005','Forbidden','vector','EPSG:4326');raise exception 'Operator write allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0bb02-b202-4a01-a101-000000000004"}',true);
do $$ begin assert jsonb_array_length(public.maps_published_projects())=0;assert (select count(*) from public.map_releases)=0;end $$;
reset role;
do $$ begin assert not has_function_privilege('anon','public.maps_published_projects()','execute');end $$;
rollback;
