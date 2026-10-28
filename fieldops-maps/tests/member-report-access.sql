-- Run after workspace-access.sql and platform-access.sql, then ROLLBACK.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003"}',true);
do $$ declare r uuid;begin
 select id into r from public.map_releases where map_id='eeb0cc03-b303-4a01-a101-000000000020' order by version desc limit 1;
 perform public.report_map_device('eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000099','{"client":"ios","model":"iPhone","app_version":"1.1"}',r,'offline');
 perform public.report_map_device('eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000099','{"client":"ios","model":"iPhone","app_version":"1.1"}',r,'offline');
 begin perform public.workspace_member_report('eeb0cc03-b303-4a01-a101-000000000010');raise exception 'Operator read member report';exception when insufficient_privilege then null;end;
 begin perform public.report_map_device('eeb0cc03-b303-4a01-a101-000000000011','eeb0cc03-b303-4a01-a101-000000000099','{"client":"ios"}',r,'offline');raise exception 'Foreign release accepted';exception when insufficient_privilege then null;end;
 begin perform public.report_map_device('eeb0cc03-b303-4a01-a101-000000000010','eeb0cc03-b303-4a01-a101-000000000098','{"client":"web"}',r,'offline');raise exception 'Web offline report accepted' using errcode='23514';exception when raise_exception then null;end;
 assert not has_table_privilege('authenticated','maps_private.member_devices','select');
 assert not has_function_privilege('anon','public.workspace_member_report(uuid)','execute');
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001"}',true);
do $$ declare result jsonb;p jsonb;begin
 result:=public.workspace_member_report('eeb0cc03-b303-4a01-a101-000000000010');
 select value into p from jsonb_array_elements(result->'people') where value->>'id'='eeb0cc03-b303-4a01-a101-000000000003';
 assert jsonb_array_length(p->'devices')=1;
 assert jsonb_array_length(p->'devices'->0->'maps')=1,'Retry duplicated a receipt';
 assert p->'devices'->0->'maps'->0->>'mode'='offline';
 select value into p from jsonb_array_elements(result->'people') where value->>'id'='eeb0cc03-b303-4a01-a101-000000000001';
 assert (p->>'file_bytes')::numeric=300,'Member file attribution or deduplication failed';
 begin perform public.workspace_member_report('eeb0cc03-b303-4a01-a101-000000000011');raise exception 'Cross-company reporting allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"c636e8ab-01d4-458e-a455-6f329dae6bf1"}',true);
do $$ begin assert jsonb_array_length(public.workspace_member_report('eeb0cc03-b303-4a01-a101-000000000010')->'people')>0;end $$;
reset role;
