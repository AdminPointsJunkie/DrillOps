-- Live account checks prevent old JWT role claims retaining revoked privileges.
create schema if not exists maps_private;
revoke all on schema maps_private from public,anon;
grant usage on schema maps_private to authenticated;
create function maps_private.current_role() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select case when banned_until>now() then 'suspended' else raw_app_meta_data->>'maps_role' end from auth.users where id=auth.uid()),'pending');
$$;
revoke all on function maps_private.current_role() from public,anon;
grant execute on function maps_private.current_role() to authenticated;
create or replace function public.maps_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select maps_private.current_role()='admin';
$$;
create function public.maps_account_role() returns text language sql stable security invoker set search_path='' as $$ select maps_private.current_role(); $$;
revoke all on function public.maps_account_role() from public,anon;
grant execute on function public.maps_account_role() to authenticated;

alter policy operator_no_drafts on public.maps using((select maps_private.current_role()) in ('admin','editor')) with check((select maps_private.current_role()) in ('admin','editor'));
alter policy operator_no_drafts on public.layers using((select maps_private.current_role()) in ('admin','editor')) with check((select maps_private.current_role()) in ('admin','editor'));
alter policy operator_no_drafts on public.features using((select maps_private.current_role()) in ('admin','editor')) with check((select maps_private.current_role()) in ('admin','editor'));
alter policy operator_no_upload on storage.objects with check(bucket_id<>'gis-files' or (select maps_private.current_role()) in ('admin','editor'));
alter policy operator_no_file_update on storage.objects using(bucket_id<>'gis-files' or (select maps_private.current_role()) in ('admin','editor')) with check(bucket_id<>'gis-files' or (select maps_private.current_role()) in ('admin','editor'));
alter policy operator_no_file_delete on storage.objects using(bucket_id<>'gis-files' or (select maps_private.current_role()) in ('admin','editor'));
create policy active_account on public.map_operators as restrictive for all to authenticated using((select maps_private.current_role()) in ('admin','editor','operator')) with check((select maps_private.current_role()) in ('admin','editor','operator'));
create policy active_account on public.map_releases as restrictive for all to authenticated using((select maps_private.current_role()) in ('admin','editor','operator')) with check((select maps_private.current_role()) in ('admin','editor','operator'));
create policy active_account_files on storage.objects as restrictive for select to authenticated using(bucket_id<>'gis-files' or (select maps_private.current_role()) in ('admin','editor','operator'));
-- Operators can only read published previews, including when demoted from editor.
alter policy gis_owner on storage.objects using(bucket_id='gis-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select maps_private.current_role()) in ('admin','editor')) with check(bucket_id='gis-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select maps_private.current_role()) in ('admin','editor'));

create function maps_private.accounts() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.maps_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 return jsonb_build_object('people',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'name',coalesce(u.raw_user_meta_data->>'full_name',''),'role',coalesce(u.raw_app_meta_data->>'maps_role','pending'),'confirmed',u.email_confirmed_at is not null,'last_sign_in',u.last_sign_in_at,'projects',coalesce((select jsonb_agg(o.map_id) from public.map_operators o where o.user_id=u.id),'[]'::jsonb)) order by u.email) from auth.users u),'[]'::jsonb),'projects',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.maps m),'[]'::jsonb));
end $$;
create function maps_private.update_account(p_user uuid,p_name text,p_role text,p_projects uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(76283941);
 if auth.uid() is null or not public.maps_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_role is null or p_role not in ('admin','editor','operator','suspended') then raise exception 'Choose a valid role'; end if;
 if p_user=auth.uid() then raise exception 'Your own admin account cannot be changed here'; end if;
 if length(coalesce(p_name,''))>160 then raise exception 'Name is too long'; end if;
 if p_role<>'operator' and cardinality(coalesce(p_projects,'{}'))>0 then raise exception 'Project assignments apply to operators'; end if;
 if exists(select 1 from unnest(coalesce(p_projects,'{}')) x where not exists(select 1 from public.maps m where m.id=x)) then raise exception 'Unknown project'; end if;
 update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('maps_role',p_role),raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('full_name',trim(coalesce(p_name,''))),updated_at=now() where id=p_user;
 if not found then raise exception 'Account not found'; end if;
 delete from public.map_operators where user_id=p_user;
 insert into public.map_operators(user_id,map_id) select p_user,x from (select distinct unnest(coalesce(p_projects,'{}')) x) p;
end $$;
revoke all on function maps_private.accounts(),maps_private.update_account(uuid,text,text,uuid[]) from public,anon;
grant execute on function maps_private.accounts(),maps_private.update_account(uuid,text,text,uuid[]) to authenticated;
create function public.maps_accounts() returns jsonb language sql security invoker set search_path='' as $$ select maps_private.accounts(); $$;
create function public.maps_update_account(p_user uuid,p_name text,p_role text,p_projects uuid[] default '{}') returns void language sql security invoker set search_path='' as $$ select maps_private.update_account(p_user,p_name,p_role,p_projects); $$;
revoke all on function public.maps_accounts(),public.maps_update_account(uuid,text,text,uuid[]) from public,anon;
grant execute on function public.maps_accounts(),public.maps_update_account(uuid,text,text,uuid[]) to authenticated;
