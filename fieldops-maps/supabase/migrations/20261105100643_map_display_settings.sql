alter table public.maps add column map_settings jsonb not null default '{}'::jsonb
 check (jsonb_typeof(map_settings)='object' and octet_length(map_settings::text)<=20000);
create function maps_private.map_settings_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin if new.map_settings is distinct from old.map_settings then new.draft_revision:=old.draft_revision+1;end if;return new;end $$;
create trigger map_settings_revision before update of map_settings on public.maps for each row execute function maps_private.map_settings_revision();
revoke all on function maps_private.map_settings_revision() from public,anon,authenticated;
create function maps_private.publish_map_settings() returns trigger language plpgsql security invoker set search_path='' as $$
declare settings jsonb;begin select map_settings into settings from public.maps where id=new.map_id;new.manifest:=jsonb_set(new.manifest,'{project,map_settings}',coalesce(settings,'{}'));return new;end $$;
create trigger map_settings_publish before insert on public.map_releases for each row execute function maps_private.publish_map_settings();
revoke all on function maps_private.publish_map_settings() from public,anon,authenticated;

create table maps_private.map_presence(map_id uuid not null references public.maps(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,seen_at timestamptz not null default now(),primary key(map_id,user_id));
alter table maps_private.map_presence enable row level security;
revoke all on maps_private.map_presence from public,anon,authenticated;
create function maps_private.map_presence_tick(p_map uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid;enabled boolean;begin
 if auth.uid() is null or not maps_private.ws_project(p_map,true) then raise exception 'Project access required' using errcode='42501';end if;
 select workspace_id,coalesce((map_settings->>'showPresence')::boolean,true) into w,enabled from public.maps where id=p_map;
 if not enabled then return '[]'::jsonb;end if;
 insert into maps_private.map_presence(map_id,user_id) values(p_map,auth.uid()) on conflict(map_id,user_id) do update set seen_at=now();
 delete from maps_private.map_presence where map_id=p_map and seen_at<now()-interval '1 day';
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(m.display_name,''),'Member'))) from maps_private.map_presence p join public.workspace_members m on m.user_id=p.user_id and m.workspace_id=w where p.map_id=p_map and p.seen_at>now()-interval '90 seconds' and m.status='active'),'[]'::jsonb);
end $$;
revoke all on function maps_private.map_presence_tick(uuid) from public,anon;
grant execute on function maps_private.map_presence_tick(uuid) to authenticated;
create function public.maps_presence(p_map uuid) returns jsonb language sql security invoker set search_path='' as $$ select maps_private.map_presence_tick(p_map); $$;
revoke all on function public.maps_presence(uuid) from public,anon;
grant execute on function public.maps_presence(uuid) to authenticated;
