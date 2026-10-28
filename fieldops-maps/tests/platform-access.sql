-- Run after workspace-access.sql in the same rolled-back transaction.
reset role;
update storage.objects set metadata='{"size":100}' where name='eeb0cc03-b303-4a01-a101-000000000001/qa/private.png';
update storage.objects set metadata='{"size":200}' where name='eeb0cc03-b303-4a01-a101-000000000001/sync/qa/published.png';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin
 begin perform public.platform_overview();raise exception 'Company owner saw platform data';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('anon','public.platform_overview()','execute');
end $$;
select set_config('request.jwt.claims','{"sub":"c636e8ab-01d4-458e-a455-6f329dae6bf1"}',true);
do $$ declare response jsonb;company jsonb;begin
 response:=public.platform_overview();select value into company from jsonb_array_elements(response->'companies') where value->>'id'='eeb0cc03-b303-4a01-a101-000000000010';
 assert (company->>'file_bytes')::numeric=300,'Original/raster duplicate was counted twice';
 assert (company->>'file_count')::integer=2;
 assert jsonb_array_length(company->'people')>=3;
 assert (response->>'total_file_bytes')::numeric>=300;
end $$;
reset role;
