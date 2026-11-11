-- Run after personal-project-access.sql fixtures in a transaction; always roll back.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000001"}',true);
do $$ declare p uuid:=current_setting('test.map')::uuid;path text;f jsonb;items jsonb;rev bigint;begin
 path:=auth.uid()::text||'/'||p::text||'/supporting/group-test/plan.pdf';
 perform public.register_file_upload(p,path);
 insert into storage.objects(bucket_id,name,metadata) values('gis-files',path,'{"size":12}');
 f:=jsonb_build_object('path',path,'name','plan.pdf','size',12,'type','application/pdf');
 perform public.maps_supporting_file(p,'add',f);
 items:=public.maps_supporting_file(p,'group',jsonb_build_object('path',path,'group',' Plans '));assert items->0->>'group'='Plans';assert items->0->>'path'=path;
 items:=public.maps_supporting_file(p,'rename_group','{"previous":"Plans","group":"Site plans"}');assert items->0->>'group'='Site plans';
 select draft_revision into rev from public.maps where id=p;perform public.sync_map(p,gen_random_uuid(),rev,'{}');
 assert public.maps_release_manifest(p)->'supporting_files'->0->>'group'='Site plans';
 perform public.maps_supporting_file(p,'group',jsonb_build_object('path',path,'group',''));
 assert public.maps_release_manifest(p)->'supporting_files'->0->>'group'='Site plans','Draft changed published heading';
 begin perform public.maps_supporting_file(p,'group',jsonb_build_object('path',path,'group',repeat('x',81)));raise exception 'Long heading accepted' using errcode='23514';exception when raise_exception then assert sqlerrm like 'Keep headings%';end;
end $$;
select set_config('request.jwt.claims','{"sub":"eef41111-1111-4111-a111-000000000002"}',true);
do $$ begin
 begin perform public.maps_supporting_file(current_setting('test.map')::uuid,'rename_group','{"previous":"Plans","group":"Changed"}');raise exception 'Viewer edited groups' using errcode='23514';exception when insufficient_privilege then null;end;
end $$;
reset role;
