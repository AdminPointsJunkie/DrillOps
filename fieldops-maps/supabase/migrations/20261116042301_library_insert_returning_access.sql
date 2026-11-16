-- INSERT ... RETURNING must evaluate the new row, not look it up through a
-- STABLE helper whose snapshot predates the insert. Keep the existing account,
-- sharing, archive and write restrictions; only the creator read path changes.
create function maps_private.library_creator_access(creator uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select creator=auth.uid() and maps_private.drillops_has_app('fieldmaps')
 and exists(select 1 from auth.users u where u.id=auth.uid()
  and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()));
$$;
revoke all on function maps_private.library_creator_access(uuid) from public,anon;
grant execute on function maps_private.library_creator_access(uuid) to authenticated;
alter policy library_read on public.workspace_layer_library using (
 maps_private.library_creator_access(created_by)
 or (maps_private.library_access(id) and (not archived or maps_private.library_access(id,true)))
);
