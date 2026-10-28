-- One self-service company per verified account. This registry survives membership removal.
create table maps_private.company_registrations(user_id uuid primary key references auth.users(id) on delete restrict,workspace_id uuid not null references public.workspaces(id) on delete restrict,created_at timestamptz not null default now());
alter table maps_private.company_registrations enable row level security;
revoke all on maps_private.company_registrations from public,anon,authenticated;
create policy internal_only on maps_private.company_registrations for all to authenticated using(false) with check(false);

create function maps_private.can_start_company() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()) and u.invited_at is null)
 and not exists(select 1 from public.workspace_members where user_id=auth.uid())
 and not exists(select 1 from maps_private.company_registrations where user_id=auth.uid());
$$;
create function maps_private.start_company(company_name text,person_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 -- Shares the lock with invitations/membership mutations to avoid concurrent acceptance races.
 perform pg_advisory_xact_lock(76283942);
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=now())) then raise exception 'Verify your email before creating a company' using errcode='42501';end if;
 select workspace_id into w from maps_private.company_registrations where user_id=auth.uid();
 if w is not null then
  if maps_private.ws_role(w)='owner' then return w;end if;
  raise exception 'Your company access is unavailable. Contact its administrator.' using errcode='42501';
 end if;
 if not maps_private.can_start_company() then raise exception 'Use your existing company or accept your invitation.' using errcode='42501';end if;
 if exists(select 1 from public.workspace_invitations i join auth.users u on lower(u.email)=i.email where u.id=auth.uid() and i.status='pending' and i.delivery='sent' and i.expires_at>now()) then raise exception 'Accept your company invitation before creating another workspace.' using errcode='42501';end if;
 if company_name is null or length(trim(company_name)) not between 1 and 120 or person_name is null or length(trim(person_name)) not between 1 and 160 then raise exception 'Enter your name and a company name.';end if;
 -- Names are input only: never match an existing company or grant rights from user metadata.
 insert into public.workspaces(name) values(trim(company_name)) returning id into w;
 insert into public.workspace_members(workspace_id,user_id,role,status,display_name) values(w,auth.uid(),'owner','active',trim(person_name));
 insert into maps_private.company_registrations(user_id,workspace_id) values(auth.uid(),w);
 insert into public.workspace_events(workspace_id,actor_id,action,detail) values(w,auth.uid(),'company.self_registered',jsonb_build_object('name',trim(company_name)));
 return w;
end $$;
create function public.start_company(p_company_name text,p_person_name text) returns uuid language sql security invoker set search_path='' as $$ select maps_private.start_company(p_company_name,p_person_name); $$;
revoke all on function maps_private.can_start_company(),maps_private.start_company(text,text),public.start_company(text,text) from public,anon,authenticated;
grant execute on function maps_private.can_start_company(),maps_private.start_company(text,text),public.start_company(text,text) to authenticated;
-- Keep the existing context contract and add eligibility computed from protected records.
create or replace function public.workspace_context() returns jsonb language sql security invoker set search_path='' as $$ select maps_private.ws_context() || jsonb_build_object('can_create_company',maps_private.can_start_company()); $$;
