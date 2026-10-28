create function maps_private.guard_project_settings() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.name is distinct from old.name or new.default_crs is distinct from old.default_crs or new.default_crs_label is distinct from old.default_crs_label)
 and not maps_private.ws_manage(old.workspace_id) then
  raise exception 'Workspace admin access required for project settings' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function maps_private.guard_project_settings() from public,anon,authenticated;
create trigger admin_project_settings before update on public.maps for each row execute function maps_private.guard_project_settings();
