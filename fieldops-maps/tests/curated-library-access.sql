-- Synthetic rows only. Run inside a transaction and roll back.
insert into auth.users(id,email,email_confirmed_at) values
 ('eef42222-1111-4111-a111-000000000001','library-owner@example.invalid',now()),
 ('eef42222-1111-4111-a111-000000000002','library-editor@example.invalid',now()),
 ('eef42222-1111-4111-a111-000000000003','library-recipient@example.invalid',now());
insert into maps_private.drillops_access(user_id,apps,active) select id,array['fieldmaps'],true from auth.users where email in ('library-owner@example.invalid','library-editor@example.invalid','library-recipient@example.invalid') on conflict(user_id) do update set apps=excluded.apps,active=true;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000001"}',true);
select set_config('test.library_project',public.create_personal_project('Library access test')::text,true);
select public.share_access('project',current_setting('test.library_project')::uuid,'grant','library-editor@example.invalid',null,'editor');
select public.set_library_default(current_setting('test.library_project')::uuid,'private');
do $$ begin assert (public.workspace_settings(current_setting('test.library_project')::uuid)->'workspace'->>'library_default_visibility')='private';end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000002"}',true);
insert into public.workspace_layer_library(id,workspace_id,name,kind,created_by,visibility) values
 ('eef42222-1111-4111-a111-000000000010',current_setting('test.library_project')::uuid,'Private tile','tiles',auth.uid(),'private'),
 ('eef42222-1111-4111-a111-000000000011',current_setting('test.library_project')::uuid,'Project tile','tiles',auth.uid(),'project');
select public.library_share_access('eef42222-1111-4111-a111-000000000010','grant','library-recipient@example.invalid');
do $$ begin
 begin perform public.set_library_default(current_setting('test.library_project')::uuid,'project');raise exception 'Editor changed admin setting';exception when insufficient_privilege then null;end;
 begin update public.workspace_layer_library set visibility='project' where id='eef42222-1111-4111-a111-000000000010';raise exception 'Visibility bypass';exception when insufficient_privilege then null;end;
end $$;
-- Project admin sees shared entry but not another user's private entry.
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000001"}',true);
do $$ begin
 assert (select count(*) from public.workspace_layer_library where workspace_id=current_setting('test.library_project')::uuid)=1,'Private layer leaked to project admin';
 begin perform public.library_share_access('eef42222-1111-4111-a111-000000000010','list');raise exception 'Admin read private shares';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000003"}',true);
do $$ begin
 assert (select count(*) from public.workspace_layer_library where workspace_id=current_setting('test.library_project')::uuid)=1,'Individual share incorrect';
 assert exists(select 1 from public.workspace_layer_library where name='Private tile');
 begin perform public.library_share_access('eef42222-1111-4111-a111-000000000010','grant','library-owner@example.invalid');raise exception 'Recipient reshared';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000002"}',true);
update public.workspace_layer_library set archived=true where id='eef42222-1111-4111-a111-000000000010';
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000003"}',true);
do $$ begin assert not exists(select 1 from public.workspace_layer_library where id='eef42222-1111-4111-a111-000000000010'),'Archive still accessible to recipient';end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000002"}',true);
update public.workspace_layer_library set archived=false where id='eef42222-1111-4111-a111-000000000010';
select public.library_share_access('eef42222-1111-4111-a111-000000000010','revoke',null,'eef42222-1111-4111-a111-000000000003');
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000003"}',true);
do $$ begin assert not exists(select 1 from public.workspace_layer_library where workspace_id=current_setting('test.library_project')::uuid),'Revoked layer accessible';end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000002"}',true);
insert into storage.objects(bucket_id,name,owner_id) values('layer-library',current_setting('test.library_project')||'/eef42222-1111-4111-a111-000000000012/data',auth.uid()::text);
insert into public.workspace_layer_library(id,workspace_id,name,kind,created_by,visibility,asset_path) values('eef42222-1111-4111-a111-000000000012',current_setting('test.library_project')::uuid,'Private data','vector',auth.uid(),'private',current_setting('test.library_project')||'/eef42222-1111-4111-a111-000000000012/data');
do $$ begin assert exists(select 1 from storage.objects where bucket_id='layer-library' and name like '%eef42222-1111-4111-a111-000000000012/data'),'Owner cannot read own asset';end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000001"}',true);
do $$ begin assert not exists(select 1 from storage.objects where bucket_id='layer-library' and name like '%eef42222-1111-4111-a111-000000000012/data'),'Admin can read private asset';end $$;
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000002"}',true);
select public.library_share_access('eef42222-1111-4111-a111-000000000012','grant','library-recipient@example.invalid');
select set_config('request.jwt.claims','{"sub":"eef42222-1111-4111-a111-000000000003"}',true);
do $$ begin assert exists(select 1 from storage.objects where bucket_id='layer-library' and name like '%eef42222-1111-4111-a111-000000000012/data'),'Recipient cannot read shared asset';end $$;
