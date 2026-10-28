-- Run inside BEGIN/ROLLBACK. No email is sent; all synthetic data is rolled back.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('b20bd452-781d-48cc-ab3c-000000000001','signup-test@example.invalid',null,'{"maps_role":"admin","platform_admin":true}'),
 ('b20bd452-781d-48cc-ab3c-000000000002','signup-second@example.invalid',now(),'{}'),
 ('b20bd452-781d-48cc-ab3c-000000000003','signup-invited@example.invalid',now(),'{}');
update auth.users set invited_at=now() where id='b20bd452-781d-48cc-ab3c-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b20bd452-781d-48cc-ab3c-000000000001"}',true);
do $$ begin
 assert not (public.workspace_context()->>'can_create_company')::boolean;
 begin perform public.start_company('DrillOps','Owner');raise exception 'Unverified registration allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update auth.users set email_confirmed_at=now() where id='b20bd452-781d-48cc-ab3c-000000000001';
set local role authenticated;
do $$ declare w uuid;begin
 assert (public.workspace_context()->>'can_create_company')::boolean;
 w:=public.start_company('DrillOps','New Owner');
 assert w=public.start_company('Changed name','Changed owner');
 assert not public.maps_admin();
 assert jsonb_array_length(public.workspace_context()->'workspaces')=1;
 assert (select role from public.workspace_members where workspace_id=w and user_id=auth.uid())='owner';
 assert (select count(*) from public.workspaces)=1;
 assert (select count(*) from public.maps)=0;
 insert into public.maps(name,owner_id,workspace_id) values('First project',auth.uid(),w);
 assert (select count(*) from public.maps)=1;
 begin perform public.workspace_mutate(null,'create','{"name":"Unauthorized second company"}');raise exception 'Platform access gained';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"b20bd452-781d-48cc-ab3c-000000000002"}',true);
do $$ declare w uuid;begin
 w:=public.start_company('DrillOps','Another Owner');
 assert (select count(*) from public.maps)=0;
 assert (select count(*) from public.workspaces)=1;
 assert not public.maps_admin();
end $$;
select set_config('request.jwt.claims','{"sub":"b20bd452-781d-48cc-ab3c-000000000003"}',true);
do $$ begin
 assert not (public.workspace_context()->>'can_create_company')::boolean;
 begin perform public.start_company('Unexpected company','Invited user');raise exception 'Invited account created company';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.workspace_members set status='suspended' where user_id='b20bd452-781d-48cc-ab3c-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b20bd452-781d-48cc-ab3c-000000000001"}',true);
do $$ begin
 begin perform public.start_company('Bypass suspension','Owner');raise exception 'Suspension bypassed';exception when insufficient_privilege then null;end;
 assert jsonb_array_length(public.workspace_context()->'workspaces')=0;
end $$;
reset role;
delete from public.workspace_members where user_id='b20bd452-781d-48cc-ab3c-000000000001';
set local role authenticated;
do $$ begin
 assert not (public.workspace_context()->>'can_create_company')::boolean;
 begin perform public.start_company('Bypass removal','Owner');raise exception 'Removal bypassed';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('anon','public.start_company(text,text)','execute');
 assert not has_table_privilege('authenticated','maps_private.company_registrations','insert');
end $$;
reset role;
