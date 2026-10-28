-- Permanent completed-upload ledger. Object deletion never deletes billing history.
create table maps_private.file_accounts(path text primary key,workspace_id uuid not null,user_id uuid not null);
create table maps_private.upload_events(
 object_id uuid not null,version text not null,workspace_id uuid,user_id uuid,
 path text not null,bytes numeric not null check(bytes>=0),uploaded_at timestamptz not null default clock_timestamp(),
 primary key(object_id,version)
);
create index upload_events_company_month on maps_private.upload_events(workspace_id,uploaded_at) include(user_id,bytes);
create table maps_private.upload_meter_config(singleton boolean primary key default true check(singleton),started_at timestamptz not null default clock_timestamp());
insert into maps_private.upload_meter_config default values;
alter table maps_private.file_accounts enable row level security;
alter table maps_private.upload_events enable row level security;
alter table maps_private.upload_meter_config enable row level security;
revoke all on maps_private.file_accounts,maps_private.upload_events,maps_private.upload_meter_config from public,anon,authenticated;

-- Seed attribution, not historical billing. Historical deleted uploads cannot be reconstructed.
insert into maps_private.file_accounts(path,workspace_id,user_id)
select path,min(workspace_id::text)::uuid,split_part(path,'/',1)::uuid from (
 select m.workspace_id,l.raster_path path from public.layers l join public.maps m on m.id=l.map_id where l.raster_path is not null
 union select m.workspace_id,jsonb_array_elements_text(l.original_paths) from public.layers l join public.maps m on m.id=l.map_id
 union select m.workspace_id,unnest(r.raster_paths) from public.map_releases r join public.maps m on m.id=r.map_id
) p where split_part(path,'/',1) ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' group by path having count(distinct workspace_id)=1;

create function maps_private.register_file_upload(p_map uuid,p_path text) returns void language plpgsql security definer set search_path='' as $$
declare w uuid;existing maps_private.file_accounts;begin
 if not maps_private.ws_project(p_map) or split_part(p_path,'/',1) is distinct from auth.uid()::text or length(p_path)>1024 then raise exception 'Project upload access required' using errcode='42501';end if;
 select workspace_id into w from public.maps where id=p_map;
 insert into maps_private.file_accounts values(p_path,w,auth.uid()) on conflict do nothing;
 select * into existing from maps_private.file_accounts where path=p_path;
 if existing.workspace_id<>w or existing.user_id<>auth.uid() or not maps_private.ws_path_allowed(p_path,w) then raise exception 'File belongs to a different company' using errcode='42501';end if;
end $$;
create function public.register_file_upload(p_map uuid,p_path text) returns void language sql security invoker set search_path='' as $$select maps_private.register_file_upload(p_map,p_path);$$;
revoke all on function maps_private.register_file_upload(uuid,text),public.register_file_upload(uuid,text) from public,anon,authenticated;
grant execute on function maps_private.register_file_upload(uuid,text),public.register_file_upload(uuid,text) to authenticated;

create function maps_private.capture_completed_upload() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;u uuid;v text;op text:=storage.operation();begin
 if new.bucket_id<>'gis-files' or coalesce(new.is_delete_marker,false) or coalesce(new.is_versioned,false) or not coalesce(new.metadata->>'size' ~ '^[0-9]+$',false) then return new;end if;
 select workspace_id,user_id into w,u from maps_private.file_accounts where path=new.name;
 if op is not null and auth.uid() is not null and w is null then raise exception 'Refresh FieldMaps before uploading: company registration required';end if;
 -- Copies consume storage but are not incoming uploads. Client moves are unsupported.
 if op='storage.object.move' then raise exception 'Moving stored files is not supported';end if;
 if op in ('storage.object.copy','storage.s3.object.copy','storage.object.move') then return new;end if;
 v:=coalesce(new.version,new.metadata->>'eTag');if v is null then return new;end if;
 if tg_op='UPDATE' and old.version is not distinct from new.version and old.metadata->>'size' is not null then return new;end if;
 u:=coalesce(auth.uid(),u,new.owner);
 -- Compatibility for old clients: only infer a company when unambiguous.
 if w is null and u is not null then
  select min(workspace_id::text)::uuid into w from public.workspace_members where user_id=u and status='active' and role in ('owner','admin','editor') having count(*)=1;
  if w is not null then insert into maps_private.file_accounts values(new.name,w,u) on conflict do nothing;end if;
 end if;
 insert into maps_private.upload_events(object_id,version,workspace_id,user_id,path,bytes)
 values(new.id,v,w,u,new.name,(new.metadata->>'size')::numeric) on conflict do nothing;
 return new;
end $$;
revoke all on function maps_private.capture_completed_upload() from public,anon,authenticated;
create trigger drillops_upload_meter after insert or update of version,metadata on storage.objects for each row execute function maps_private.capture_completed_upload();

-- A registered orphan file keeps its company scope before/after a layer references it.
alter function maps_private.ws_file(text,boolean) rename to ws_file_before_meter;
create function maps_private.ws_file(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare w uuid;begin
 select workspace_id into w from maps_private.file_accounts where file_accounts.path=ws_file.path;
 if w is not null and maps_private.ws_role(w) is null then return false;end if;
 return maps_private.ws_file_before_meter(path,writing);
end $$;
revoke all on function maps_private.ws_file(text,boolean),maps_private.ws_file_before_meter(text,boolean) from public,anon,authenticated;
grant execute on function maps_private.ws_file(text,boolean) to authenticated;
-- Policies bind functions by OID: rebuild so they call the new company guard.
alter policy gis_file_read on storage.objects using(bucket_id='gis-files' and maps_private.ws_file(name));
alter policy gis_file_insert on storage.objects with check(bucket_id='gis-files' and split_part(name,'/',1)=auth.uid()::text and maps_private.ws_file(name,true));
alter policy gis_file_update on storage.objects using(bucket_id='gis-files' and maps_private.ws_file(name,true)) with check(bucket_id='gis-files' and maps_private.ws_file(name,true));
alter policy gis_file_delete on storage.objects using(bucket_id='gis-files' and maps_private.ws_file(name,true));

create function maps_private.current_company_files(w uuid) returns table(path text,uploader text,bytes numeric) language sql stable security definer set search_path='' as $$
 with paths as (
 select a.path from maps_private.file_accounts a where workspace_id=w
 union select l.raster_path from public.layers l join public.maps m on m.id=l.map_id where m.workspace_id=w and l.raster_path is not null
 union select jsonb_array_elements_text(l.original_paths) from public.layers l join public.maps m on m.id=l.map_id where m.workspace_id=w
 union select unnest(r.raster_paths) from public.map_releases r join public.maps m on m.id=r.map_id where m.workspace_id=w
 ) select p.path,split_part(p.path,'/',1),case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else 0 end
 from paths p join storage.objects o on o.name=p.path and o.bucket_id='gis-files' where not coalesce(o.is_delete_marker,false) and not coalesce(o.is_versioned,false);
$$;
create function maps_private.upload_month(w uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with period as(select date_trunc('month',now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane' start_at),
 bounds as(select start_at,((start_at at time zone 'Australia/Brisbane')+interval '1 month') at time zone 'Australia/Brisbane' end_at from period)
 select jsonb_build_object('upload_bytes',coalesce((select sum(bytes) from maps_private.upload_events where workspace_id=w and uploaded_at>=start_at and uploaded_at<end_at),0),
 'month_start',start_at,'month_end',end_at,'meter_started_at',c.started_at,'partial_month',c.started_at>start_at,'timezone','Australia/Brisbane')
 from bounds cross join maps_private.upload_meter_config c;
$$;
revoke all on function maps_private.current_company_files(uuid),maps_private.upload_month(uuid) from public,anon,authenticated;

alter function maps_private.workspace_usage(uuid) rename to workspace_usage_before_meter;
create function maps_private.workspace_usage(w uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=maps_private.workspace_usage_before_meter(w); -- Existing live membership check.
 return result || maps_private.upload_month(w) || (select jsonb_build_object('file_count',count(*),'file_bytes',coalesce(sum(bytes),0)) from maps_private.current_company_files(w));
end $$;
revoke all on function maps_private.workspace_usage(uuid),maps_private.workspace_usage_before_meter(uuid) from public,anon,authenticated;
grant execute on function maps_private.workspace_usage(uuid) to authenticated;

alter function maps_private.workspace_member_report(uuid) rename to workspace_member_report_before_meter;
create function maps_private.workspace_member_report(p_workspace uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;period jsonb;begin
 result:=maps_private.workspace_member_report_before_meter(p_workspace); -- Existing admin check.
 period:=maps_private.upload_month(p_workspace);
 return result || period || jsonb_build_object('people',coalesce((select jsonb_agg(p || jsonb_build_object(
  'upload_bytes',coalesce((select sum(e.bytes) from maps_private.upload_events e where e.workspace_id=p_workspace and e.user_id::text=p->>'id' and e.uploaded_at>=(period->>'month_start')::timestamptz and e.uploaded_at<(period->>'month_end')::timestamptz),0),
  'file_bytes',coalesce((select sum(f.bytes) from maps_private.current_company_files(p_workspace) f where f.uploader=p->>'id'),0),
  'file_count',(select count(*) from maps_private.current_company_files(p_workspace) f where f.uploader=p->>'id')
 )) from jsonb_array_elements(result->'people') p),'[]'::jsonb),
 'unattributed_file_bytes',coalesce((select sum(f.bytes) from maps_private.current_company_files(p_workspace) f where not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id::text=f.uploader)),0),
 'former_member_upload_bytes',coalesce((select sum(e.bytes) from maps_private.upload_events e where e.workspace_id=p_workspace and e.uploaded_at>=(period->>'month_start')::timestamptz and e.uploaded_at<(period->>'month_end')::timestamptz and not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=e.user_id)),0));
end $$;
revoke all on function maps_private.workspace_member_report(uuid),maps_private.workspace_member_report_before_meter(uuid) from public,anon,authenticated;
grant execute on function maps_private.workspace_member_report(uuid) to authenticated;

alter function maps_private.platform_overview() rename to platform_overview_before_meter;
create function maps_private.platform_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 result:=maps_private.platform_overview_before_meter(); -- Platform check before any aggregates.
 return result || jsonb_build_object('companies',coalesce((select jsonb_agg(c || maps_private.workspace_usage((c->>'id')::uuid)) from jsonb_array_elements(result->'companies') c),'[]'::jsonb),
 'unassigned_file_bytes',coalesce((select sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::numeric else 0 end) from storage.objects o where o.bucket_id='gis-files' and not exists(select 1 from maps_private.file_accounts a where a.path=o.name)),0),
 'unassigned_upload_bytes',coalesce((select sum(bytes) from maps_private.upload_events where workspace_id is null),0));
end $$;
revoke all on function maps_private.platform_overview(),maps_private.platform_overview_before_meter() from public,anon,authenticated;
grant execute on function maps_private.platform_overview() to authenticated;

create or replace function maps_private.ws_path_allowed(path text,w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_file(path)
 and not exists(select 1 from maps_private.file_accounts a where a.path=ws_path_allowed.path and a.workspace_id<>w)
 and not exists(select 1 from public.layers l join public.maps m on m.id=l.map_id where (l.raster_path=path or l.original_paths ? path) and m.workspace_id<>w)
 and not exists(select 1 from public.map_releases r join public.maps m on m.id=r.map_id where r.raster_paths @> array[path] and m.workspace_id<>w);
$$;
