-- Private personal photos, available to every authenticated account regardless of workspace role.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,1048576,array['image/jpeg']);
create policy profile_photos_read on storage.objects for select to authenticated
using(bucket_id='profile-photos' and split_part(name,'/',1)=(select auth.uid())::text);
create policy profile_photos_insert on storage.objects for insert to authenticated
with check(bucket_id='profile-photos' and split_part(name,'/',1)=(select auth.uid())::text);
create policy profile_photos_delete on storage.objects for delete to authenticated
using(bucket_id='profile-photos' and split_part(name,'/',1)=(select auth.uid())::text);
-- Marketing preferences default to false in the client. Existing accounts are not opted in.
-- Stored with consent wording, source and timestamp in the account's own auth metadata.
