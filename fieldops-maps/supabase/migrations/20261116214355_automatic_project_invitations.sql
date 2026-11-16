-- Internal trigger-only enrollment. The grant comes from an admin-created,
-- successfully sent invitation; user-editable metadata never supplies access.
create function maps_private.enroll_project_invitation(invitation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i public.workspace_invitations; recipient uuid; inserted boolean;
begin
 select * into i from public.workspace_invitations where id=invitation_id for update;
 if not found or i.status<>'pending' or i.delivery<>'sent' or i.expires_at<=now()
    or i.role not in ('admin','editor','operator') then return;end if;
 if not exists(select 1 from public.workspaces where id=i.workspace_id and status='active') then return;end if;
 select u.id into recipient from auth.users u where lower(u.email)=i.email
   and u.email_confirmed_at is not null and u.deleted_at is null
   and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now());
 if recipient is null then return;end if;
 -- Never reactivate or change permissions for an existing member.
 insert into public.workspace_members(workspace_id,user_id,role,display_name)
 values(i.workspace_id,recipient,i.role,i.name) on conflict do nothing;
 inserted:=found;
 if not exists(select 1 from public.workspace_members where workspace_id=i.workspace_id and user_id=recipient and status='active') then return;end if;
 if inserted then
  insert into public.project_members(map_id,user_id)
  select id,recipient from public.maps where workspace_id=i.workspace_id and id=any(i.projects) on conflict do nothing;
 end if;
 update public.workspace_invitations set status='accepted',accepted_by=recipient where id=i.id;
 insert into public.workspace_events(workspace_id,actor_id,action,detail)
 values(i.workspace_id,i.created_by,'invitation.auto_join',jsonb_build_object('invitation_id',i.id,'user_id',recipient,'membership_created',inserted));
end $$;
revoke all on function maps_private.enroll_project_invitation(uuid) from public,anon,authenticated;

create function maps_private.enroll_delivered_project_invitation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.delivery='sent' and new.status='pending' then
  perform maps_private.enroll_project_invitation(new.id);
 end if;
 return new;
end $$;
revoke all on function maps_private.enroll_delivered_project_invitation() from public,anon,authenticated;
create trigger enroll_delivered_project_invitation after insert or update of delivery on public.workspace_invitations
 for each row execute function maps_private.enroll_delivered_project_invitation();

create function maps_private.enroll_verified_project_invitations() returns trigger
language plpgsql security definer set search_path='' as $$
declare invitation_id uuid;
begin
 if new.email_confirmed_at is null or new.deleted_at is not null or coalesce(new.is_anonymous,false)
    or (new.banned_until is not null and new.banned_until>now()) then return new;end if;
 for invitation_id in select id from public.workspace_invitations
  where email=lower(new.email) and status='pending' and delivery='sent' and expires_at>now() order by id
 loop perform maps_private.enroll_project_invitation(invitation_id);end loop;
 return new;
end $$;
revoke all on function maps_private.enroll_verified_project_invitations() from public,anon,authenticated;
create trigger zz_enroll_verified_project_invitations after insert or update of email_confirmed_at,last_sign_in_at,email on auth.users
 for each row execute function maps_private.enroll_verified_project_invitations();
