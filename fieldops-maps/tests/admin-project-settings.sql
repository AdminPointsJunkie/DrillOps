-- Run after workspace-access.sql, within BEGIN / ROLLBACK.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000002"}',true);
do $$ begin
 begin update public.maps set name='Editor rename' where id='eeb0cc03-b303-4a01-a101-000000000020';raise exception 'Editor renamed project';exception when insufficient_privilege then null;end;
 begin update public.maps set default_crs='EPSG:4326' where id='eeb0cc03-b303-4a01-a101-000000000020';raise exception 'Editor changed project CRS';exception when insufficient_privilege then null;end;
 update public.maps set layer_layout=layer_layout where id='eeb0cc03-b303-4a01-a101-000000000020';
 begin perform public.workspace_settings('eeb0cc03-b303-4a01-a101-000000000010');raise exception 'Editor opened workspace settings';exception when insufficient_privilege then null;end;
 begin perform public.platform_overview();raise exception 'Editor opened platform';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0cc03-b303-4a01-a101-000000000001"}',true);
do $$ begin
 update public.maps set name='Admin rename',default_crs='EPSG:4326' where id='eeb0cc03-b303-4a01-a101-000000000020';
 assert (select name from public.maps where id='eeb0cc03-b303-4a01-a101-000000000020')='Admin rename';
 perform public.workspace_settings('eeb0cc03-b303-4a01-a101-000000000010');
 begin perform public.platform_overview();raise exception 'Company admin opened platform';exception when insufficient_privilege then null;end;
end $$;
reset role;
