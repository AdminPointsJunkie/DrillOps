-- Run in a rolled-back transaction after the fixture setup in workspace-access.sql
-- (only the setup before its first SET LOCAL ROLE is needed).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000002"}',true);
select public.register_file_upload('eeb0cc03-b303-4a01-a101-000000000020','eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf');
insert into storage.objects(bucket_id,name,metadata) values('gis-files','eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf','{"size":12}');
do $$ declare l uuid;rev bigint;p jsonb;fc jsonb;begin
 p:='{"map_id":"eeb0cc03-b303-4a01-a101-000000000020","name":"Locations","source_crs":"EPSG:4326","original_paths":[]}';
 fc:='[{"type":"Feature","geometry":{"type":"Point","coordinates":[148,-22]},"properties":{"name":"Hole A"}}]';
 l:=public.import_vector(p,fc);
 p:=p||'{"original_paths":["eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf"]}';
 fc:=jsonb_set(fc,'{0,properties,_fieldmaps_files}','[{"path":"eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf","name":"Plan.pdf","size":12}]');
 perform public.replace_vector(l,p,fc);
 assert (select original_paths ? 'eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf' from public.layers where id=l);
 assert public.layer_geojson(l)->'features'->0->'properties'->'_fieldmaps_files'->0->>'name'='Plan.pdf';
 update public.maps set layer_layout=jsonb_build_array(l::text) where id='eeb0cc03-b303-4a01-a101-000000000020';
 select draft_revision into rev from public.maps where id='eeb0cc03-b303-4a01-a101-000000000020';
 perform public.sync_map('eeb0cc03-b303-4a01-a101-000000000020',gen_random_uuid(),rev);
 assert not maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf',true),'Published bytes must be immutable';
 -- Removing from the draft must not change the published feature or its bytes.
 fc:=jsonb_set(fc,'{0,properties,_fieldmaps_files}','[]');perform public.replace_vector(l,p,fc);
 assert (select manifest->'layers'->0->'fc'->'features'->0->'properties'->'_fieldmaps_files'->0->>'name'='Plan.pdf' from public.map_releases where map_id='eeb0cc03-b303-4a01-a101-000000000020');
 -- A reference without a valid, owned storage object cannot publish.
 fc:=jsonb_set(fc,'{0,properties,_fieldmaps_files}','[{"path":"foreign/private.pdf","name":"Stolen.pdf"}]');perform public.replace_vector(l,p,fc);
 select draft_revision into rev from public.maps where id='eeb0cc03-b303-4a01-a101-000000000020';
 begin
  perform public.sync_map('eeb0cc03-b303-4a01-a101-000000000020',gen_random_uuid(),rev);
  raise exception 'Invalid attachment published' using errcode='23514';
 exception when raise_exception then assert sqlerrm like 'A location attachment is missing%';end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003"}',true);
do $$ begin
 assert (select count(*) from storage.objects where name='eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf')=1,'Assigned operator cannot download';
 assert (select count(*) from public.layers)=0,'Operator can read draft';
 begin
  perform public.register_file_upload('eeb0cc03-b303-4a01-a101-000000000020','eeb0cc03-b303-4a01-a101-000000000003/attachments/illegal.pdf');
  raise exception 'Operator uploaded' using errcode='23514';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000004"}',true);
do $$ begin
 assert (select count(*) from storage.objects where name='eeb0cc03-b303-4a01-a101-000000000002/attachments/plan.pdf')=0,'Other company can download';
 assert (select count(*) from public.map_releases where map_id='eeb0cc03-b303-4a01-a101-000000000020')=0;
end $$;
reset role;
