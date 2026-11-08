-- Execute after the migration in one transaction; ROLLBACK removes all fixtures.
insert into auth.users(id,email,email_confirmed_at) values
('ee762026-1108-4000-8000-000000000001','fieldops-owner@example.invalid',now()),
('ee762026-1108-4000-8000-000000000002','fieldops-operator@example.invalid',now()),
('ee762026-1108-4000-8000-000000000003','fieldops-outsider@example.invalid',now());
insert into public.workspaces(id,name) values('ee762026-1108-4000-8000-000000000010','FieldOps test');
insert into public.workspace_members(workspace_id,user_id,role) values
('ee762026-1108-4000-8000-000000000010','ee762026-1108-4000-8000-000000000001','owner'),
('ee762026-1108-4000-8000-000000000010','ee762026-1108-4000-8000-000000000002','operator');
insert into public.maps(id,name,owner_id,workspace_id) values('ee762026-1108-4000-8000-000000000020','Sync fixture','ee762026-1108-4000-8000-000000000001','ee762026-1108-4000-8000-000000000010');
insert into public.project_members values('ee762026-1108-4000-8000-000000000020','ee762026-1108-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000001"}',true);
do $$ declare lid uuid; rev bigint; begin
 lid:=public.import_vector('{"map_id":"ee762026-1108-4000-8000-000000000020","name":"Points","source_crs":"EPSG:4326"}','[{"type":"Feature","geometry":{"type":"Point","coordinates":[153,-27]},"properties":{"name":"A","notes":"old"}}]');
 perform set_config('test.layer',lid::text,true);
 perform set_config('test.base',(public.layer_geojson(lid)->'features'->0)::text,true);
 perform set_config('test.old_layer',(select to_jsonb(l) from public.layers l where id=lid)::text,true);
 update public.maps set layer_layout=jsonb_build_array(lid::text) where id='ee762026-1108-4000-8000-000000000020';
 select draft_revision into rev from public.maps where id='ee762026-1108-4000-8000-000000000020';
 perform public.sync_map('ee762026-1108-4000-8000-000000000020',gen_random_uuid(),rev,'{}');
end $$;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000002"}',true);
do $$ begin
 assert public.fieldops_capabilities()='[]'::jsonb,'operator is read only by default';
 begin perform public.workspace_fieldops_access('ee762026-1108-4000-8000-000000000010',auth.uid(),true);raise exception 'self escalation';exception when insufficient_privilege then null;end;
 begin perform public.fieldops_apply_edit(gen_random_uuid(),'ee762026-1108-4000-8000-000000000020',current_setting('test.layer')::uuid,null,'{}');raise exception 'unauthorized upload';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000001"}',true);
select public.workspace_fieldops_access('ee762026-1108-4000-8000-000000000010','ee762026-1108-4000-8000-000000000002',true);
-- A web edit lands before the mobile upload, in a different attribute.
update public.features set properties=properties||'{"notes":"web"}' where layer_id=current_setting('test.layer')::uuid;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000002"}',true);
do $$ declare b jsonb:=current_setting('test.base')::jsonb;r jsonb;r2 jsonb;op uuid:=gen_random_uuid();begin
 assert jsonb_array_length(public.fieldops_capabilities())=1,'assigned enabled project';
 r:=public.fieldops_apply_edit(op,'ee762026-1108-4000-8000-000000000020',current_setting('test.layer')::uuid,b,jsonb_set(b,'{properties,name}','"Mobile"'));
 assert r->>'status'='uploaded' and r->'feature'->'properties'='{"name":"Mobile","notes":"web"}'::jsonb,'three way merge';
 assert (r->>'release_version')::int=1,'acknowledgement identifies the current publication version';
 r2:=public.fieldops_apply_edit(op,'ee762026-1108-4000-8000-000000000020',current_setting('test.layer')::uuid,b,jsonb_set(b,'{properties,name}','"Mobile"'));
 assert r=r2,'lost response retry is idempotent';
 r:=public.fieldops_apply_edit(gen_random_uuid(),'ee762026-1108-4000-8000-000000000020',current_setting('test.layer')::uuid,b,jsonb_set(b,'{properties,name}','"Clash"'));
 assert r->>'status'='conflict','same field conflict';
 r:=public.fieldops_apply_edit(gen_random_uuid(),'ee762026-1108-4000-8000-000000000020',current_setting('test.layer')::uuid,b,null);
 assert r->>'status'='conflict','delete versus edit conflict';
 begin perform public.fieldops_apply_edit(gen_random_uuid(),'ee762026-1108-4000-8000-000000000020',current_setting('test.layer')::uuid,b,jsonb_set(b,'{properties,_fieldmaps_files}','[]'));raise exception 'forged attachment';exception when others then assert sqlerrm like 'Protected%';end;
end $$;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000001"}',true);
do $$ declare lid uuid:=current_setting('test.layer')::uuid;b jsonb:=current_setting('test.base')::jsonb;l jsonb;r jsonb;payload jsonb;token text;begin
 -- Stale legacy replacement cannot overwrite mobile data.
 l:=current_setting('test.old_layer')::jsonb;
 begin perform public.replace_vector(lid,l,jsonb_build_array(b));raise exception 'stale replacement';exception when serialization_failure then null;end;
 -- A stale style update cannot roll the revision token back.
 select metadata->>'data_revision' into token from public.layers where id=lid;
 update public.layers set metadata=l->'metadata' where id=lid;
 assert (select metadata->>'data_revision' from public.layers where id=lid)=token,'revision survives style save';
 -- Browser saves merge unchanged remote fields and independent local geometry.
 payload:=jsonb_build_object('name',l->'name','source_crs',l->'source_crs','vertical_datum',l->'vertical_datum','metadata',l->'metadata','original_paths',l->'original_paths');
 r:=public.merge_vector_edits(lid,payload,payload,jsonb_build_array(b),jsonb_build_array(jsonb_set(b,'{geometry,coordinates}','[154,-28]')));
 assert r->'fc'->'features'->0->'properties'='{"name":"Mobile","notes":"web"}'::jsonb,'web preserves mobile fields';
 assert r->'fc'->'features'->0->'geometry'->'coordinates'='[154,-28]'::jsonb,'web geometry applied';
 assert r->'fc'->'features'->0->'id'=b->'id','stable feature identifier';
 begin perform public.merge_vector_edits(lid,payload,payload,jsonb_build_array(b),jsonb_build_array(jsonb_set(b,'{properties,name}','"Web clash"')));raise exception 'web conflict allowed';exception when serialization_failure then null;end;
 perform public.workspace_fieldops_access('ee762026-1108-4000-8000-000000000010','ee762026-1108-4000-8000-000000000002',false);
end $$;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000002"}',true);
do $$ begin assert public.fieldops_capabilities()='[]'::jsonb,'revocation effective immediately';end $$;
select set_config('request.jwt.claims','{"sub":"ee762026-1108-4000-8000-000000000003"}',true);
do $$ begin assert public.fieldops_capabilities()='[]'::jsonb,'cross account isolation';end $$;
reset role;
select 'PASS: permissions, idempotency, independent merges, same-field conflicts, deletes, protected attachments, stable IDs, stale web saves and revocation' as result;
