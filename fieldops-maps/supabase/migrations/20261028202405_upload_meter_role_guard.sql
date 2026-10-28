create or replace function maps_private.ws_file(path text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare w uuid;role text;begin
 select workspace_id into w from maps_private.file_accounts where file_accounts.path=ws_file.path;
 if w is not null then
  role:=maps_private.ws_role(w);
  if role is null or (writing and role not in ('owner','admin','editor')) then return false;end if;
 end if;
 return maps_private.ws_file_before_meter(path,writing);
end $$;
