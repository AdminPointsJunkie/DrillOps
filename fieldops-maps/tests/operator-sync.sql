-- Transaction-only integration test. No test accounts, projects or releases remain.
begin;
insert into auth.users(id,email) values
 ('eeb0bb01-a101-4a01-a101-000000000001','sync-owner@example.invalid'),
 ('eeb0bb01-a101-4a01-a101-000000000002','sync-operator@example.invalid'),
 ('eeb0bb01-a101-4a01-a101-000000000003','sync-unassigned@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0bb01-a101-4a01-a101-000000000001","role":"authenticated","app_metadata":{}}',true);
insert into public.maps(id,name,layer_layout) values
 ('eeb0bb01-a101-4a01-a101-000000000004','SYNC QA','[{"id":"group","name":"Survey","children":["eeb0bb01-a101-4a01-a101-000000000005"]}]');
select public.import_vector('{"id":"eeb0bb01-a101-4a01-a101-000000000005","map_id":"eeb0bb01-a101-4a01-a101-000000000004","name":"Original","source_crs":"EPSG:4326","metadata":{"style":{"labelField":"name"}}}',
 '[{"geometry":{"type":"Point","coordinates":[153,-27,10]},"properties":{"name":"A"}}]');
insert into public.map_operators values('eeb0bb01-a101-4a01-a101-000000000004','eeb0bb01-a101-4a01-a101-000000000002');
do $$ declare revision bigint; result jsonb; begin
 select draft_revision into revision from public.maps where id='eeb0bb01-a101-4a01-a101-000000000004';
 result:=public.sync_map('eeb0bb01-a101-4a01-a101-000000000004','eeb0bb01-a101-4a01-a101-000000000006',revision);
 assert result->>'version'='1','First sync version wrong';
 assert (select manifest->'layers'->0->'fc'->'features'->0->'geometry'->'coordinates'='[153,-27,10]'::jsonb from public.map_releases where id='eeb0bb01-a101-4a01-a101-000000000006'),'Snapshot geometry missing';
 result:=public.sync_map('eeb0bb01-a101-4a01-a101-000000000004',gen_random_uuid(),revision);
 assert result->>'version'='1','Retry duplicated release';
 update public.layers set name='Draft change' where id='eeb0bb01-a101-4a01-a101-000000000005';
 assert (select manifest->'layers'->0->>'name'='Original' from public.map_releases where id='eeb0bb01-a101-4a01-a101-000000000006'),'Draft edit leaked into release';
 begin
  perform public.sync_map('eeb0bb01-a101-4a01-a101-000000000004',gen_random_uuid(),revision);
  raise exception 'Expected revision conflict';
 exception when others then if sqlerrm='Expected revision conflict' then raise; end if; end;
 select draft_revision into revision from public.maps where id='eeb0bb01-a101-4a01-a101-000000000004';
 result:=public.sync_map('eeb0bb01-a101-4a01-a101-000000000004',gen_random_uuid(),revision);
 assert result->>'version'='2','Second sync did not publish';
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0bb01-a101-4a01-a101-000000000002","role":"authenticated","app_metadata":{"maps_role":"operator"}}',true);
do $$ begin
 assert (select count(*)=2 from public.map_releases where map_id='eeb0bb01-a101-4a01-a101-000000000004'),'Assigned operator cannot read releases';
 assert (select count(*)=0 from public.maps),'Operator can read drafts';
 assert (select count(*)=0 from public.features),'Operator can read draft features';
 begin
  insert into public.maps(name) values('Forbidden operator upload');
  raise exception 'Expected operator write denial';
 exception when insufficient_privilege then null; end;
 begin
  perform public.sync_map('eeb0bb01-a101-4a01-a101-000000000004',gen_random_uuid(),0);
  raise exception 'Expected operator sync denial';
 exception when others then if sqlerrm='Expected operator sync denial' then raise; end if; end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0bb01-a101-4a01-a101-000000000003","role":"authenticated","app_metadata":{"maps_role":"operator"}}',true);
do $$ begin
 assert (select count(*)=0 from public.map_releases where map_id='eeb0bb01-a101-4a01-a101-000000000004'),'Unassigned operator can read releases';
 assert not has_function_privilege('anon','public.sync_map(uuid,uuid,bigint,jsonb)','execute'),'Anonymous sync allowed';
end $$;
rollback;
