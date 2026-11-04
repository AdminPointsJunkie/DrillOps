set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000002"}',true);
select public.register_file_upload('eeb0cc03-b303-4a01-a101-000000000020','eeb0cc03-b303-4a01-a101-000000000002/eeb0cc03-b303-4a01-a101-000000000020/supporting/check/plan.pdf');
insert into storage.objects(bucket_id,name,metadata) values('gis-files','eeb0cc03-b303-4a01-a101-000000000002/eeb0cc03-b303-4a01-a101-000000000020/supporting/check/plan.pdf','{"size":12}');
do $$ declare p uuid:='eeb0cc03-b303-4a01-a101-000000000020';f jsonb:='{"path":"eeb0cc03-b303-4a01-a101-000000000002/eeb0cc03-b303-4a01-a101-000000000020/supporting/check/plan.pdf","name":"plan.pdf","size":12,"type":"application/pdf"}';rev bigint;begin
 select draft_revision into rev from public.maps where id=p;
 assert jsonb_array_length(public.maps_supporting_file(p,'add',f))=1;
 assert (select draft_revision from public.maps where id=p)>rev;
 assert jsonb_array_length(public.maps_supporting_file(p,'add',f))=1,'Retry duplicated file';
 assert not maps_private.ws_file(f->>'path',true),'Supporting bytes must be immutable';
 select draft_revision into rev from public.maps where id=p;
 perform public.sync_map(p,gen_random_uuid(),rev,'{}');
 assert public.maps_release_manifest(p)->'supporting_files'->0->>'name'='plan.pdf';
 perform public.maps_supporting_file(p,'remove',f);
 assert jsonb_array_length((select supporting_files from public.maps where id=p))=0;
 assert jsonb_array_length(public.maps_release_manifest(p)->'supporting_files')=1,'Draft removal changed publication';
 begin perform public.maps_supporting_file('eeb0cc03-b303-4a01-a101-000000000022','add',f);raise exception 'Foreign project accepted' using errcode='23514';exception when insufficient_privilege then null;end;
 begin perform public.maps_supporting_file(p,'add',f||'{"name":"data.geojson"}');raise exception 'GIS file accepted' using errcode='23514';exception when raise_exception then assert sqlerrm='Invalid supporting file';end;
 begin perform public.maps_supporting_file(p,'add',f||'{"size":52428801}');raise exception 'Oversize accepted' using errcode='23514';exception when raise_exception then assert sqlerrm like 'Supporting files must%';end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003"}',true);
do $$ begin
 assert jsonb_array_length(public.maps_release_manifest('eeb0cc03-b303-4a01-a101-000000000020')->'supporting_files')=1;
 assert (select count(*) from storage.objects where name like '%/supporting/check/plan.pdf')=1,'Assigned operator cannot download';
 begin perform public.maps_supporting_file('eeb0cc03-b303-4a01-a101-000000000020','remove','{}');raise exception 'Operator edited documents' using errcode='23514';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000004"}',true);
do $$ begin
 assert (select count(*) from storage.objects where name like '%/supporting/check/plan.pdf')=0,'Cross company download';
 begin perform public.maps_release_manifest('eeb0cc03-b303-4a01-a101-000000000020');raise exception 'Cross company manifest' using errcode='23514';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'supporting file access checks passed' as result;
