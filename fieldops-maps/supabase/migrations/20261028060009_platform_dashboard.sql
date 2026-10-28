create function maps_private.platform_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not maps_private.ws_platform() then raise exception 'DrillOps platform admin access required' using errcode='42501';end if;
 with paths as (
  select m.workspace_id,l.raster_path path from public.layers l join public.maps m on m.id=l.map_id where l.raster_path is not null
  union select m.workspace_id,jsonb_array_elements_text(l.original_paths) from public.layers l join public.maps m on m.id=l.map_id
  union select m.workspace_id,unnest(r.raster_paths) from public.map_releases r join public.maps m on m.id=r.map_id
 ), files as (
  select name,case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end bytes from storage.objects where bucket_id='gis-files'
 ), usage as (
  select p.workspace_id,count(*) file_count,sum(f.bytes) file_bytes from paths p join files f on f.name=p.path group by p.workspace_id
 ), members as (
  select m.workspace_id,count(*) users,count(*) filter(where m.status='active') active_users,
   jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'name',m.display_name,'role',m.role,'status',m.status,'joined_at',m.created_at,'last_sign_in',u.last_sign_in_at,'verified',u.email_confirmed_at is not null) order by m.role,u.email) people
  from public.workspace_members m join auth.users u on u.id=m.user_id group by m.workspace_id
 ), projects as (select workspace_id,count(*) projects from public.maps group by workspace_id),
 vectors as (select m.workspace_id,count(*) features,coalesce(sum(pg_column_size(f)),0) vector_bytes from public.features f join public.layers l on l.id=f.layer_id join public.maps m on m.id=l.map_id group by m.workspace_id)
 select jsonb_build_object('generated_at',now(),'companies',coalesce(jsonb_agg(jsonb_build_object(
  'id',w.id,'name',w.name,'status',w.status,'created_at',w.created_at,'users',coalesce(a.users,0),'active_users',coalesce(a.active_users,0),'people',coalesce(a.people,'[]'::jsonb),
  'projects',coalesce(p.projects,0),'file_bytes',coalesce(s.file_bytes,0),'file_count',coalesce(s.file_count,0),'vector_bytes',coalesce(v.vector_bytes,0),'features',coalesce(v.features,0),
  'pending_invitations',(select count(*) from public.workspace_invitations i where i.workspace_id=w.id and i.status='pending' and i.expires_at>now()),
  'signup_source',case when exists(select 1 from maps_private.company_registrations r where r.workspace_id=w.id) then 'Self-service' else 'Administrator' end
 ) order by w.created_at desc),'[]'::jsonb),
 'total_file_bytes',(select coalesce(sum(bytes),0) from files),
 'unassigned_file_bytes',(select coalesce(sum(bytes),0) from files f where not exists(select 1 from paths p where p.path=f.name)),
 'total_users',(select count(distinct user_id) from public.workspace_members)) into result
 from public.workspaces w left join usage s on s.workspace_id=w.id left join members a on a.workspace_id=w.id left join projects p on p.workspace_id=w.id left join vectors v on v.workspace_id=w.id;
 return result;
end $$;
create function public.platform_overview() returns jsonb language sql security invoker set search_path='' as $$ select maps_private.platform_overview(); $$;
revoke all on function maps_private.platform_overview(),public.platform_overview() from public,anon,authenticated;
grant execute on function maps_private.platform_overview(),public.platform_overview() to authenticated;
