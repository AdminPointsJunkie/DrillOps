-- Run after workspace-access.sql + platform-access.sql. Synthetic metadata only; ROLLBACK all changes.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001"}',true);
select public.register_file_upload('eeb0cc03-b303-4a01-a101-000000000022','eeb0cc03-b303-4a01-a101-000000000001/meter/source.csv');
select public.register_file_upload('eeb0cc03-b303-4a01-a101-000000000022','eeb0cc03-b303-4a01-a101-000000000001/meter/copy.csv');
select set_config('storage.operation','storage.object.upload',true);
insert into storage.objects(id,bucket_id,name,version,metadata) values('eeb0cc03-b303-4a01-a101-000000000080','gis-files','eeb0cc03-b303-4a01-a101-000000000001/meter/source.csv','v1','{"size":100}');
do $$ declare r jsonb;begin
 r:=public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010');
 assert (r->>'upload_bytes')::numeric=100,'Completed upload not metered';
 assert (r->>'file_bytes')::numeric=400,'Unlinked uploaded file omitted from current storage';
 assert r->>'timezone'='Australia/Brisbane';assert (r->>'partial_month')::boolean;
end $$;
-- Metadata updates and repeated completion of the same version are not new uploads.
update storage.objects set metadata='{"size":100,"mimetype":"text/csv"}' where id='eeb0cc03-b303-4a01-a101-000000000080';
-- Re-uploading identical bytes is a new completed version and counts again.
update storage.objects set version='v2' where id='eeb0cc03-b303-4a01-a101-000000000080';
select set_config('storage.operation','storage.object.copy',true);
insert into storage.objects(id,bucket_id,name,version,metadata) values('eeb0cc03-b303-4a01-a101-000000000081','gis-files','eeb0cc03-b303-4a01-a101-000000000001/meter/copy.csv','copy1','{"size":100}');
do $$ declare r jsonb;begin
 r:=public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010');assert (r->>'upload_bytes')::numeric=200,'Copy or metadata change billed';assert (r->>'file_bytes')::numeric=500;
 assert not has_table_privilege('authenticated','maps_private.upload_events','delete');
 assert not has_table_privilege('authenticated','maps_private.upload_events','insert');
end $$;
select set_config('storage.operation','storage.object.delete',true);
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where id in ('eeb0cc03-b303-4a01-a101-000000000080','eeb0cc03-b303-4a01-a101-000000000081');
do $$ declare r jsonb;p jsonb;begin
 r:=public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010');assert (r->>'upload_bytes')::numeric=200,'Deletion refunded uploads';assert (r->>'file_bytes')::numeric=300,'Deletion failed to lower current storage';
 select value into p from jsonb_array_elements(public.workspace_member_report('eeb0cc03-b303-4a01-a101-000000000010')->'people') where value->>'id'='eeb0cc03-b303-4a01-a101-000000000001';assert (p->>'upload_bytes')::numeric=200,'Member upload usage missing';
 begin perform public.register_file_upload('eeb0cc03-b303-4a01-a101-000000000021','eeb0cc03-b303-4a01-a101-000000000001/foreign.csv');raise exception 'Foreign company upload accepted';exception when insufficient_privilege then null;end;
end $$;
-- A failed transaction must never be billed.
select set_config('storage.operation','storage.object.upload',true);
do $$ begin
 begin
  insert into storage.objects(id,bucket_id,name,version,metadata) values('eeb0cc03-b303-4a01-a101-000000000082','gis-files','eeb0cc03-b303-4a01-a101-000000000001/meter/source.csv','failed','{"size":999}');
  raise exception 'Simulated failure';
 exception when raise_exception then null;end;
 assert (public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010')->>'upload_bytes')::numeric=200;
end $$;
reset role;
-- Previous-month events stay in history but do not affect this month's total.
insert into maps_private.upload_events(object_id,version,workspace_id,user_id,path,bytes,uploaded_at) values(gen_random_uuid(),'old','eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000001','old',1000,(date_trunc('month',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane')-interval '1 second');
set local role authenticated;
do $$ begin assert (public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010')->>'upload_bytes')::numeric=200;end $$;
select set_config('request.jwt.claims','{"sub":"c636e8ab-01d4-458e-a455-6f329dae6bf1"}',true);
do $$ declare c jsonb;begin select value into c from jsonb_array_elements(public.platform_overview()->'companies') where value->>'id'='eeb0cc03-b303-4a01-a101-000000000010';assert (c->>'upload_bytes')::numeric=200;end $$;
reset role;

-- Editing another company must not let an operator write this company's orphan files.
insert into maps_private.file_accounts values('eeb0cc03-b303-4a01-a101-000000000003/old-orphan.csv','eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000003');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003"}',true);
do $$ begin assert not maps_private.ws_file('eeb0cc03-b303-4a01-a101-000000000003/old-orphan.csv',true);end $$;
reset role;
