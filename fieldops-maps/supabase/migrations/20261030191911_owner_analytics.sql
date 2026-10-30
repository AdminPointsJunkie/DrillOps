-- Owner-only reporting. Browser diagnostics are not a billing ledger.
create table maps_private.analytics_owner (
 singleton boolean primary key default true check(singleton),
 user_id uuid not null references auth.users(id),started_at timestamptz not null default now()
);
insert into maps_private.analytics_owner(user_id)
select id from auth.users where lower(email)='oleary.john@icloud.com';
do $$begin if not exists(select 1 from maps_private.analytics_owner) then raise exception 'Analytics owner account missing';end if;end$$;
create table maps_private.analytics_events (
 id bigint generated always as identity primary key,
 received_at timestamptz not null default clock_timestamp(),
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid references public.workspaces(id) on delete set null,
 route text not null check(route ~ '^(storage|database|rpc:[a-z_]{1,64})$'),
 status integer not null check(status between 0 and 599),
 bytes bigint check(bytes between 0 and 1073741824),
 ms integer not null check(ms between 0 and 300000)
);
create index analytics_events_time on maps_private.analytics_events(received_at);
create index analytics_events_user_time on maps_private.analytics_events(user_id,received_at);
alter table maps_private.analytics_owner enable row level security;
alter table maps_private.analytics_events enable row level security;
revoke all on maps_private.analytics_owner,maps_private.analytics_events from public,anon,authenticated;

create function maps_private.owner_analytics_access() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_platform() and exists(select 1 from maps_private.analytics_owner where user_id=auth.uid());
$$;
create function public.owner_analytics_access() returns boolean language sql security invoker set search_path='' as $$select maps_private.owner_analytics_access();$$;

create function maps_private.record_analytics(p_events jsonb) returns void language plpgsql security definer set search_path='' as $$
declare e jsonb;w uuid;u uuid:=auth.uid();begin
 if u is null or not exists(select 1 from auth.users where id=u and (banned_until is null or banned_until<=now())) then raise exception 'Authentication required' using errcode='42501';end if;
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>50 or octet_length(p_events::text)>32768 then raise exception 'Invalid analytics batch';end if;
 -- Bound diagnostic storage, including concurrent submissions by the same user.
 perform pg_advisory_xact_lock(hashtextextended(u::text,726));
 if (select count(*) from maps_private.analytics_events where user_id=u and received_at>=now()-interval '1 day')+jsonb_array_length(p_events)>10000 then return;end if;
 delete from maps_private.analytics_events where received_at<now()-interval '30 days';
 for e in select value from jsonb_array_elements(p_events) loop
  w:=nullif(e->>'workspace','')::uuid;
  if w is not null and maps_private.ws_role(w) is null then raise exception 'Workspace access required' using errcode='42501';end if;
  insert into maps_private.analytics_events(user_id,workspace_id,route,status,bytes,ms)
  values(u,w,e->>'route',(e->>'status')::integer,(e->>'bytes')::bigint,(e->>'ms')::integer);
 end loop;
end $$;
create function public.record_analytics(p_events jsonb) returns void language sql security invoker set search_path='' as $$select maps_private.record_analytics(p_events);$$;

create function maps_private.owner_analytics(p_days integer default 7) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not maps_private.owner_analytics_access() then raise exception 'Owner analytics access required' using errcode='42501';end if;
 if p_days is null or p_days not in (1,7,30) then raise exception 'Choose 1, 7 or 30 days';end if;
 with samples as materialized (select * from maps_private.analytics_events where received_at>=now()-make_interval(days=>p_days)),
 totals as(select count(*) requests,count(distinct user_id) active_users,coalesce(sum(bytes),0) bytes,count(*) filter(where bytes is null) unknown_bytes,count(*) filter(where status=0 or status>=400) errors,percentile_cont(0.5) within group(order by ms) p50_ms,percentile_cont(0.95) within group(order by ms) p95_ms from samples),
 daily as(select (received_at at time zone 'Australia/Brisbane')::date as day,count(*) requests,count(distinct user_id) users,coalesce(sum(bytes),0) bytes,count(*) filter(where status=0 or status>=400) errors,percentile_cont(0.95) within group(order by ms) p95_ms from samples group by 1),
 routes as(select route,count(*) requests,coalesce(sum(bytes),0) bytes,count(*) filter(where status=0 or status>=400) errors,percentile_cont(0.5) within group(order by ms) p50_ms,percentile_cont(0.95) within group(order by ms) p95_ms from samples group by route)
 select jsonb_build_object('days',p_days,'generated_at',now(),'started_at',(select started_at from maps_private.analytics_owner),'summary',(select to_jsonb(t) from totals t),'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day desc) from daily d),'[]'::jsonb),'routes',coalesce((select jsonb_agg(to_jsonb(r) order by requests desc) from routes r),'[]'::jsonb),
 'database_bytes',pg_database_size(current_database()),'file_bytes',(select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0) from storage.objects),'file_count',(select count(*) from storage.objects),
 'maps',(select count(*) from public.maps),'layers',(select count(*) from public.layers),'features',(select count(*) from public.features),'published_maps',(select count(distinct map_id) from public.map_releases)) into result;
 return result;
end $$;
create function public.owner_analytics(p_days integer default 7) returns jsonb language sql security invoker set search_path='' as $$select maps_private.owner_analytics(p_days);$$;
revoke all on function maps_private.owner_analytics_access(),public.owner_analytics_access(),maps_private.record_analytics(jsonb),public.record_analytics(jsonb),maps_private.owner_analytics(integer),public.owner_analytics(integer) from public,anon,authenticated;
grant execute on function maps_private.owner_analytics_access(),public.owner_analytics_access(),maps_private.record_analytics(jsonb),public.record_analytics(jsonb),maps_private.owner_analytics(integer),public.owner_analytics(integer) to authenticated;
