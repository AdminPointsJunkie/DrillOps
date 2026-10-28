-- Client reports are operational evidence, not a billing meter or hardware attestation.
create table maps_private.member_devices (
 workspace_id uuid not null references public.workspaces on delete cascade,
 user_id uuid not null references auth.users on delete cascade,
 device_id uuid not null,
 client text not null check(client in ('web','ios','android')),
 details jsonb not null default '{}',
 first_seen timestamptz not null default now(),
 last_seen timestamptz not null default now(),
 primary key(workspace_id,user_id,device_id)
);
create table maps_private.device_map_receipts (
 workspace_id uuid not null,
 user_id uuid not null,
 device_id uuid not null,
 map_id uuid not null references public.maps on delete cascade,
 release_id uuid not null references public.map_releases on delete cascade,
 mode text not null check(mode in ('viewed','offline')),
 completed_at timestamptz not null,
 received_at timestamptz not null default now(),
 primary key(workspace_id,user_id,device_id,map_id,mode),
 foreign key(workspace_id,user_id,device_id) references maps_private.member_devices on delete cascade
);
alter table maps_private.member_devices enable row level security;
alter table maps_private.device_map_receipts enable row level security;
revoke all on maps_private.member_devices,maps_private.device_map_receipts from public,anon,authenticated;
create index device_receipts_release on maps_private.device_map_receipts(release_id);
create index device_receipts_map on maps_private.device_map_receipts(map_id);
create index member_devices_user on maps_private.member_devices(user_id);

create function maps_private.report_map_device(p_workspace uuid,p_device uuid,p_details jsonb,p_release uuid default null,p_mode text default 'viewed',p_completed_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.map_releases; client text; completed timestamptz:=coalesce(p_completed_at,now());begin
 if auth.uid() is null or maps_private.ws_role(p_workspace) is null then raise exception 'Company access required' using errcode='42501';end if;
 client:=p_details->>'client';
 if p_device is null or client is null or client not in ('web','ios','android') or p_mode is null or p_mode not in ('viewed','offline') or (client='web' and p_mode='offline') then raise exception 'Invalid device report';end if;
 if p_release is not null then
  select * into r from public.map_releases where id=p_release;
  if r.id is null or not maps_private.ws_project(r.map_id,true) or not exists(select 1 from public.maps where id=r.map_id and workspace_id=p_workspace) then raise exception 'Published project access required' using errcode='42501';end if;
  if completed>now()+interval '5 minutes' or completed<r.published_at then raise exception 'Invalid completion time';end if;
 end if;
 insert into maps_private.member_devices(workspace_id,user_id,device_id,client,details)
 values(p_workspace,auth.uid(),p_device,client,jsonb_build_object('model',left(p_details->>'model',160),'os',left(p_details->>'os',160),'app_version',left(p_details->>'app_version',80),'user_agent',left(p_details->>'user_agent',512)))
 on conflict(workspace_id,user_id,device_id) do update set client=excluded.client,details=excluded.details,last_seen=now();
 if r.id is not null then
  insert into maps_private.device_map_receipts(workspace_id,user_id,device_id,map_id,release_id,mode,completed_at)
  values(p_workspace,auth.uid(),p_device,r.map_id,r.id,p_mode,completed)
  on conflict(workspace_id,user_id,device_id,map_id,mode) do update set release_id=excluded.release_id,completed_at=excluded.completed_at,received_at=now()
  where excluded.completed_at>device_map_receipts.completed_at;
 end if;
end $$;
create function public.report_map_device(p_workspace uuid,p_device uuid,p_details jsonb,p_release uuid default null,p_mode text default 'viewed',p_completed_at timestamptz default null)
returns void language sql security invoker set search_path='' as $$ select maps_private.report_map_device(p_workspace,p_device,p_details,p_release,p_mode,p_completed_at); $$;

create function maps_private.workspace_member_report(p_workspace uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not maps_private.ws_manage(p_workspace) then raise exception 'Company admin access required' using errcode='42501';end if;
 with paths as (
  select l.raster_path path from public.layers l join public.maps m on m.id=l.map_id where m.workspace_id=p_workspace and l.raster_path is not null
  union select jsonb_array_elements_text(l.original_paths) from public.layers l join public.maps m on m.id=l.map_id where m.workspace_id=p_workspace
  union select unnest(r.raster_paths) from public.map_releases r join public.maps m on m.id=r.map_id where m.workspace_id=p_workspace
 ), files as (
  select split_part(o.name,'/',1) uploader,count(*) file_count,sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else 0 end) bytes
  from paths p join storage.objects o on o.name=p.path and o.bucket_id='gis-files' group by 1
 )
 select jsonb_build_object('generated_at',now(),'people',coalesce(jsonb_agg(jsonb_build_object(
  'id',u.id,'name',a.display_name,'email',u.email,'role',a.role,'status',a.status,'last_login',u.last_sign_in_at,
  'file_bytes',coalesce(f.bytes,0),'file_count',coalesce(f.file_count,0),
  'projects',(select count(*) from public.maps m where m.workspace_id=p_workspace and m.owner_id=u.id),
  'devices',coalesce((select jsonb_agg(jsonb_build_object('id',d.device_id,'client',d.client,'details',d.details,'last_seen',d.last_seen,'first_seen',d.first_seen,
   'maps',coalesce((select jsonb_agg(jsonb_build_object('name',m.name,'version',r.version,'latest_version',(select max(x.version) from public.map_releases x where x.map_id=m.id),'mode',s.mode,'completed_at',s.completed_at,'received_at',s.received_at) order by m.name,s.mode)
    from maps_private.device_map_receipts s join public.map_releases r on r.id=s.release_id join public.maps m on m.id=s.map_id
    where s.workspace_id=d.workspace_id and s.user_id=d.user_id and s.device_id=d.device_id),'[]'::jsonb)) order by d.last_seen desc)
   from maps_private.member_devices d where d.workspace_id=p_workspace and d.user_id=u.id),'[]'::jsonb)
 ) order by a.display_name,u.email),'[]'::jsonb),
 'unattributed_file_bytes',coalesce((select sum(bytes) from files f where not exists(select 1 from public.workspace_members a where a.workspace_id=p_workspace and a.user_id::text=f.uploader)),0)) into result
 from public.workspace_members a join auth.users u on u.id=a.user_id left join files f on f.uploader=u.id::text where a.workspace_id=p_workspace;
 return result;
end $$;
create function public.workspace_member_report(p_workspace uuid) returns jsonb language sql security invoker set search_path='' as $$ select maps_private.workspace_member_report(p_workspace); $$;
revoke all on function maps_private.report_map_device(uuid,uuid,jsonb,uuid,text,timestamptz),public.report_map_device(uuid,uuid,jsonb,uuid,text,timestamptz),maps_private.workspace_member_report(uuid),public.workspace_member_report(uuid) from public,anon,authenticated;
grant execute on function maps_private.report_map_device(uuid,uuid,jsonb,uuid,text,timestamptz),public.report_map_device(uuid,uuid,jsonb,uuid,text,timestamptz),maps_private.workspace_member_report(uuid),public.workspace_member_report(uuid) to authenticated;
