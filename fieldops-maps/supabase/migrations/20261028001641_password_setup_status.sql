-- Only exposes whether the current invited user still needs a password, never credentials.
create function maps_private.needs_password() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select invited_at is not null and coalesce(encrypted_password,'')='' from auth.users where id=auth.uid()),false);
$$;
revoke all on function maps_private.needs_password() from public,anon;
grant execute on function maps_private.needs_password() to authenticated;
create function public.maps_needs_password() returns boolean language sql stable security invoker set search_path='' as $$ select maps_private.needs_password(); $$;
revoke all on function public.maps_needs_password() from public,anon;
grant execute on function public.maps_needs_password() to authenticated;
