-- Keep one winning login per account. Never fall back to an older login after logout.
create table maps_private.fieldmaps_active_sessions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 session_id uuid not null,
 signed_in_at timestamptz not null
);
alter table maps_private.fieldmaps_active_sessions enable row level security;
revoke all on maps_private.fieldmaps_active_sessions from public,anon,authenticated;
create function maps_private.record_fieldmaps_session() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into maps_private.fieldmaps_active_sessions(user_id,session_id,signed_in_at)
 values(new.user_id,new.id,coalesce(new.created_at,clock_timestamp()))
 on conflict(user_id) do update set session_id=excluded.session_id,signed_in_at=excluded.signed_in_at
 where excluded.signed_in_at>=fieldmaps_active_sessions.signed_in_at;
 return new;
end $$;
revoke all on function maps_private.record_fieldmaps_session() from public,anon,authenticated;
create trigger record_fieldmaps_session after insert on auth.sessions for each row execute function maps_private.record_fieldmaps_session();
insert into maps_private.fieldmaps_active_sessions(user_id,session_id,signed_in_at)
 select distinct on(user_id) user_id,id,coalesce(created_at,'epoch'::timestamptz)
 from auth.sessions order by user_id,created_at desc nulls last,id desc
 on conflict(user_id) do nothing;
create function maps_private.fieldmaps_session_current() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from maps_private.fieldmaps_active_sessions a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
 where a.user_id=auth.uid() and a.session_id::text=auth.jwt()->>'session_id'
 and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function maps_private.fieldmaps_session_current() from public,anon;
grant execute on function maps_private.fieldmaps_session_current() to authenticated;
create function public.fieldmaps_session_current() returns boolean language sql stable security invoker set search_path='' as $$select maps_private.fieldmaps_session_current()$$;
revoke all on function public.fieldmaps_session_current() from public,anon;
grant execute on function public.fieldmaps_session_current() to authenticated;
-- Only FieldMaps is gated; other DrillOps products retain their existing access rules.
create or replace function maps_private.drillops_has_app(app text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (app<>'fieldmaps' or maps_private.fieldmaps_session_current())
 and exists(select 1 from maps_private.drillops_access a join auth.users u on u.id=a.user_id
 where a.user_id=auth.uid() and a.active and app=any(a.apps) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()));
$$;
