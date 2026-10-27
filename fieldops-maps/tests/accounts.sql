begin;
insert into auth.users(id,email,raw_app_meta_data) values
 ('eeb0bb02-a101-4a01-a101-000000000001','admin-qa@example.invalid','{"maps_role":"admin"}'),
 ('eeb0bb02-a101-4a01-a101-000000000002','editor-qa@example.invalid','{"maps_role":"editor"}'),
 ('eeb0bb02-a101-4a01-a101-000000000003','pending-qa@example.invalid','{}');
insert into public.maps(id,owner_id,name) values ('eeb0bb02-a101-4a01-a101-000000000004','eeb0bb02-a101-4a01-a101-000000000002','Accounts QA');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeb0bb02-a101-4a01-a101-000000000001","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin
 assert public.maps_admin();
 assert jsonb_array_length(public.maps_accounts()->'people')>=3;
 begin
  perform public.maps_update_account(auth.uid(),'Self','operator','{}');
  raise exception 'Self demotion allowed';
 exception when raise_exception then assert sqlerrm='Your own admin account cannot be changed here'; end;
 perform public.maps_update_account('eeb0bb02-a101-4a01-a101-000000000002','Operator QA','operator',array['eeb0bb02-a101-4a01-a101-000000000004'::uuid]);
end $$;
-- Stale JWT claims must not preserve edit/admin access.
select set_config('request.jwt.claims','{"sub":"eeb0bb02-a101-4a01-a101-000000000002","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin
 assert not public.maps_admin();
 assert public.maps_account_role()='operator';
 assert (select count(*) from public.maps)=0;
 assert (select count(*) from public.map_operators)=1;
 begin perform public.maps_accounts();raise exception 'Account list exposed';exception when insufficient_privilege then null;end;
 begin perform public.maps_update_account(auth.uid(),'Escalate','admin','{}');raise exception 'Escalation allowed';exception when insufficient_privilege then null;end;
 begin insert into public.maps(name) values('Forbidden');raise exception 'Operator write allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eeb0bb02-a101-4a01-a101-000000000001"}',true);
select public.maps_update_account('eeb0bb02-a101-4a01-a101-000000000002','Suspended QA','suspended','{}');
select set_config('request.jwt.claims','{"sub":"eeb0bb02-a101-4a01-a101-000000000002","app_metadata":{"maps_role":"admin"}}',true);
do $$ begin assert public.maps_account_role()='suspended';assert (select count(*) from public.map_operators)=0;assert (select count(*) from public.map_releases)=0;end $$;
select set_config('request.jwt.claims','{"sub":"eeb0bb02-a101-4a01-a101-000000000003","user_metadata":{"maps_role":"admin"}}',true);
do $$ begin assert public.maps_account_role()='pending';assert not public.maps_admin();assert (select count(*) from public.maps)=0;end $$;
reset role;
do $$ begin assert not has_function_privilege('anon','public.maps_accounts()','execute');assert not has_function_privilege('anon','public.maps_update_account(uuid,text,text,uuid[])','execute');end $$;
rollback;
