-- Run after workspace-access.sql and platform-access.sql in a rolled-back transaction.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000003"}',true);
do $$ declare result jsonb;begin
 result:=public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010');
 assert (result->>'file_bytes')::numeric=300;
 assert (result->>'file_count')::integer=2;
 assert not has_function_privilege('anon','public.workspace_usage(uuid)','execute');
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000004"}',true);
do $$ begin
 begin perform public.workspace_usage('eeb0cc03-b303-4a01-a101-000000000010');raise exception 'Cross-company usage disclosed';exception when insufficient_privilege then null;end;
end $$;
reset role;
