create or replace function maps_private.complete_fieldmaps_signup(p_name text,p_phone text,p_terms_version text,p_marketing boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verify your email before continuing' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Enter your full name';end if;
 if p_phone is null or length(p_phone)>50 or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15 then raise exception 'Enter a valid phone number';end if;
 if p_terms_version is distinct from '2026-11-12' then raise exception 'Agree to the current Terms of Service';end if;
 if p_marketing is null then raise exception 'Choose a marketing preference';end if;
 insert into maps_private.fieldmaps_account_consent(user_id,terms_version,marketing_opt_in) values(uid,p_terms_version,p_marketing)
 on conflict(user_id) do update set terms_version=excluded.terms_version,accepted_at=now(),marketing_opt_in=excluded.marketing_opt_in,updated_at=now();
 insert into maps_private.fieldmaps_consent_events(user_id,event,terms_version,consent_text,value) values
 (uid,'terms',p_terms_version,'I agree to the FieldMaps Terms of Service.',true),
 (uid,'marketing',null,'I consent to DrillOps using my contact details to send me marketing communications.',p_marketing);
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('full_name',trim(p_name),'contact_phone',trim(p_phone),'marketing_opt_in',p_marketing) where id=uid;
 return maps_private.fieldmaps_signup_status();
end $$;
create or replace function maps_private.set_fieldmaps_marketing(p_opt_in boolean,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();begin
 if uid is null or not exists(select 1 from auth.users where id=uid and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Sign in to continue' using errcode='42501';end if;
 if p_opt_in is null or p_enabled is null then raise exception 'Choose a marketing preference';end if;
 update maps_private.fieldmaps_account_consent set marketing_opt_in=p_opt_in,marketing_enabled=p_enabled,updated_at=now() where user_id=uid;
 if not found then raise exception 'Complete your account details first';end if;
 insert into maps_private.fieldmaps_consent_events(user_id,event,consent_text,value) values(uid,'marketing', 'I consent to DrillOps using my contact details to send me marketing communications.',p_opt_in),(uid,'workspace_marketing', 'Allow marketing communications in my workspace.',p_enabled);
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('marketing_opt_in',p_opt_in,'marketing_enabled',p_enabled) where id=uid;
 return maps_private.fieldmaps_signup_status();
end $$;
