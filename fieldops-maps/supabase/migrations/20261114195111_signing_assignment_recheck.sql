-- The broader map reader also supports workspace-wide and individually shared maps.
-- An operator's signing grant additionally requires their explicit assignment to remain active.
create or replace function maps_private.can_sign_document(p_map uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and maps_private.ws_project(p_map,true)
 and (maps_private.ws_project(p_map) or exists(
   select 1 from maps_private.document_signers s join public.project_members p on p.map_id=s.map_id and p.user_id=s.user_id
   where s.map_id=p_map and s.user_id=auth.uid()))
 and not exists(select 1 from maps_private.map_deletions where map_id=p_map);
$$;
