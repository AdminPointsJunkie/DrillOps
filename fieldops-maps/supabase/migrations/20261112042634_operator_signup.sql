-- The public signup marker can only restrict a newly created account.
-- Persist it in administrator-controlled app metadata; never authorize from user metadata.
create function maps_private.mark_field_operator() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.raw_user_meta_data->>'fieldmaps_signup'='operator' then
  new.raw_app_meta_data=coalesce(new.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('fieldmaps_account_type','operator');
 end if;
 return new;
end $$;
revoke all on function maps_private.mark_field_operator() from public,anon,authenticated;
create trigger mark_field_operator before insert on auth.users for each row execute function maps_private.mark_field_operator();
create function maps_private.is_field_operator() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select raw_app_meta_data->>'fieldmaps_account_type'='operator' from auth.users where id=auth.uid()),false);
$$;
revoke all on function maps_private.is_field_operator() from public,anon;
grant execute on function maps_private.is_field_operator() to authenticated;
create or replace function maps_private.ws_role(w uuid) returns text language sql stable security definer set search_path='' as $$
 select case when not maps_private.drillops_has_app('fieldmaps') then null
 when maps_private.ws_platform() and not maps_private.is_field_operator() then 'owner'
 else (select case when maps_private.is_field_operator() then 'operator' else m.role end
 from public.workspace_members m join public.workspaces c on c.id=m.workspace_id join auth.users u on u.id=m.user_id
 where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and c.status='active' and (u.banned_until is null or u.banned_until<=now())) end;
$$;
-- Protect every project-creation path, including legacy registration RPCs.
create function maps_private.prevent_operator_project() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if maps_private.is_field_operator() then raise exception 'Operator accounts cannot create projects' using errcode='42501';end if;
 return new;
end $$;
revoke all on function maps_private.prevent_operator_project() from public,anon,authenticated;
create trigger prevent_operator_project before insert on public.workspaces for each row execute function maps_private.prevent_operator_project();
-- Existing map/layer/storage policies use ws_role/ws_project and therefore remain view-only.
create function maps_private.record_operator_signup() returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb:=new.raw_user_meta_data;begin
 if new.raw_app_meta_data->>'fieldmaps_account_type'='operator' then
  if coalesce(length(trim(m->>'full_name')),0) not between 1 and 120
   or coalesce(length(m->>'contact_phone'),0)>50
   or coalesce(length(regexp_replace(m->>'contact_phone','[^0-9]','','g')),0) not between 7 and 15
   or m->>'terms_version' is distinct from '2026-11-12'
   or jsonb_typeof(m->'marketing_opt_in') is distinct from 'boolean' then
   raise exception 'Complete your name, phone number and Terms of Service agreement';
  end if;
  insert into maps_private.fieldmaps_account_consent(user_id,terms_version,marketing_opt_in)
  values(new.id,'2026-11-12',(m->>'marketing_opt_in')::boolean);
  insert into maps_private.fieldmaps_consent_events(user_id,event,terms_version,consent_text,value) values
  (new.id,'terms','2026-11-12','I agree to the FieldMaps Terms of Service.',true),
  (new.id,'marketing',null,'I consent to DrillOps using my contact details to send me marketing communications.',(m->>'marketing_opt_in')::boolean);
 end if;
 return new;
end $$;
revoke all on function maps_private.record_operator_signup() from public,anon,authenticated;
create trigger record_operator_signup after insert on auth.users for each row execute function maps_private.record_operator_signup();
