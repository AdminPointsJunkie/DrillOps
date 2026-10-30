-- Transaction-only tests against the migrated database. Everything rolls back.
begin;
insert into auth.users(id,email) values('eeb0bb01-b101-4a01-a101-000000000001','bandwidth-operator@example.invalid');
select set_config('request.jwt.claim.sub',(select user_id::text from maps_private.analytics_owner),true);
set local role authenticated;
insert into public.maps(id,name,workspace_id,layer_layout) values('eeb0bb01-b101-4a01-a101-000000000004','Bandwidth QA',(select id from public.workspaces order by created_at limit 1),'["eeb0bb01-b101-4a01-a101-000000000005"]');
select public.import_vector('{"id":"eeb0bb01-b101-4a01-a101-000000000005","map_id":"eeb0bb01-b101-4a01-a101-000000000004","name":"Vector","source_crs":"EPSG:4326","metadata":{}}',
 '[{"geometry":{"type":"LineString","coordinates":[[153,-27],[153.0001,-27],[153.0002,-27],[153.0003,-27]]},"properties":{"name":"A","unused":"large text","_fieldmaps_files":[]}}]');
do $$declare revision bigint;release jsonb;manifest jsonb;body jsonb;previous text;begin
 for i in 1..4 loop
  update public.maps set name='Bandwidth QA '||i where id='eeb0bb01-b101-4a01-a101-000000000004';
  select draft_revision into revision from public.maps where id='eeb0bb01-b101-4a01-a101-000000000004';
  release:=public.sync_map('eeb0bb01-b101-4a01-a101-000000000004',gen_random_uuid(),revision);
  manifest:=public.maps_release_manifest('eeb0bb01-b101-4a01-a101-000000000004');
  assert not (manifest->'layers'->0 ? 'fc'),'Manifest includes full geometry';
  if previous is not null then assert previous=manifest->'layers'->0->>'hash','Unchanged layer hash changed';end if;
  previous:=manifest->'layers'->0->>'hash';
 end loop;
 assert (select count(*)=3 from public.map_releases where map_id='eeb0bb01-b101-4a01-a101-000000000004'),'Release retention failed';
 body:=public.maps_release_layer((release->>'id')::uuid,'eeb0bb01-b101-4a01-a101-000000000005');
 assert jsonb_array_length(body->'fc'->'features'->0->'geometry'->'coordinates')=4,'Exact geometry changed';
 body:=public.maps_release_layer((release->>'id')::uuid,'eeb0bb01-b101-4a01-a101-000000000005',10,array['name']);
 assert jsonb_array_length(body->'fc'->'features'->0->'geometry'->'coordinates')=2,'Display geometry not simplified';
 assert not (body->'fc'->'features'->0->'properties' ? 'unused'),'Unused attribute retained';
 assert body->'fc'->'features'->0->'properties' ? '_fieldmaps_files','Attachment metadata lost';
 begin
  insert into public.layers(map_id,name,kind,source_crs,metadata) values('eeb0bb01-b101-4a01-a101-000000000004','Blocked TIFF','raster','EPSG:4326','{"format":"GTiff"}');
  raise exception 'TIFF insert unexpectedly succeeded';
 exception when others then if sqlerrm not like '%local-only%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','eeb0bb01-b101-4a01-a101-000000000001',true);
do $$begin
 begin perform public.maps_release_manifest('eeb0bb01-b101-4a01-a101-000000000004');raise exception 'Unassigned access allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
