-- Consent is recorded with server timestamps, independently of editable auth metadata.
create table maps_private.fieldmaps_account_consent (
 user_id uuid primary key references auth.users(id) on delete cascade,
 terms_version text not null, accepted_at timestamptz not null default now(),
 marketing_opt_in boolean not null default false,
 marketing_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create table maps_private.fieldmaps_consent_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 event text not null, terms_version text, consent_text text,
 value boolean, recorded_at timestamptz not null default now()
);
alter table maps_private.fieldmaps_account_consent enable row level security;
alter table maps_private.fieldmaps_consent_events enable row level security;
revoke all on maps_private.fieldmaps_account_consent,maps_private.fieldmaps_consent_events from public,anon,authenticated;
create function maps_private.fieldmaps_signup_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c maps_private.fieldmaps_account_consent; u auth.users;begin
 select * into u from auth.users where id=auth.uid() and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now());
 if u.id is null then raise exception 'Sign in to continue' using errcode='42501';end if;
 select * into c from maps_private.fieldmaps_account_consent where user_id=u.id;
 return jsonb_build_object('complete',coalesce(c.terms_version='2026-11-12' and length(trim(u.raw_user_meta_data->>'full_name'))>0 and length(regexp_replace(u.raw_user_meta_data->>'contact_phone','[^0-9]','','g')) between 7 and 15,false),'marketing_opt_in',coalesce(c.marketing_opt_in,false),'marketing_enabled',coalesce(c.marketing_enabled,true),'terms_version',c.terms_version);
end $$;
create function maps_private.complete_fieldmaps_signup(p_name text,p_phone text,p_terms_version text,p_marketing boolean) returns jsonb language plpgsql security definer set search_path='' as $$
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
 (uid,'marketing',null,'Email me DrillOps product news, updates and offers.',p_marketing);
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('full_name',trim(p_name),'contact_phone',trim(p_phone),'marketing_opt_in',p_marketing) where id=uid;
 return maps_private.fieldmaps_signup_status();
end $$;
create function maps_private.set_fieldmaps_marketing(p_opt_in boolean,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();begin
 if uid is null or not exists(select 1 from auth.users where id=uid and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Sign in to continue' using errcode='42501';end if;
 if p_opt_in is null or p_enabled is null then raise exception 'Choose a marketing preference';end if;
 update maps_private.fieldmaps_account_consent set marketing_opt_in=p_opt_in,marketing_enabled=p_enabled,updated_at=now() where user_id=uid;
 if not found then raise exception 'Complete your account details first';end if;
 insert into maps_private.fieldmaps_consent_events(user_id,event,consent_text,value) values(uid,'marketing', 'Email me DrillOps product news, updates and offers.',p_opt_in),(uid,'workspace_marketing', 'Allow marketing communications in my workspace.',p_enabled);
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('marketing_opt_in',p_opt_in,'marketing_enabled',p_enabled) where id=uid;
 return maps_private.fieldmaps_signup_status();
end $$;
-- Future campaign senders must use this eligibility view, never auth metadata alone.
create view maps_private.fieldmaps_marketing_recipients as select u.id,u.email from auth.users u join maps_private.fieldmaps_account_consent c on c.user_id=u.id where c.marketing_opt_in and c.marketing_enabled and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
revoke all on maps_private.fieldmaps_marketing_recipients from public,anon,authenticated;
create function public.fieldmaps_signup_status() returns jsonb language sql security invoker set search_path='' as $$select maps_private.fieldmaps_signup_status()$$;
create function public.complete_fieldmaps_signup(p_name text,p_phone text,p_terms_version text,p_marketing boolean) returns jsonb language sql security invoker set search_path='' as $$select maps_private.complete_fieldmaps_signup(p_name,p_phone,p_terms_version,p_marketing)$$;
create function public.set_fieldmaps_marketing(p_opt_in boolean,p_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$select maps_private.set_fieldmaps_marketing(p_opt_in,p_enabled)$$;
revoke all on function maps_private.fieldmaps_signup_status(),maps_private.complete_fieldmaps_signup(text,text,text,boolean),maps_private.set_fieldmaps_marketing(boolean,boolean),public.fieldmaps_signup_status(),public.complete_fieldmaps_signup(text,text,text,boolean),public.set_fieldmaps_marketing(boolean,boolean) from public,anon;
grant execute on function maps_private.fieldmaps_signup_status(),maps_private.complete_fieldmaps_signup(text,text,text,boolean),maps_private.set_fieldmaps_marketing(boolean,boolean),public.fieldmaps_signup_status(),public.complete_fieldmaps_signup(text,text,text,boolean),public.set_fieldmaps_marketing(boolean,boolean) to authenticated;
